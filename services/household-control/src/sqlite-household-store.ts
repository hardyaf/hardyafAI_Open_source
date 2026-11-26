import { createHash, randomUUID } from "node:crypto";
import {ConversationOrganizationRepository,ConversationOrganizationError} from "./conversation-organization.ts";
import type {
  ChatMessage, Conversation, ConversationActivity, FamilyProfile, HouseholdAgentAdapter, HouseholdAgentEvent,
  HouseholdConversationContext, HouseholdGoalMutation, HouseholdGoalMutationResult,
  HouseholdCheckpoint, HouseholdCheckpointUpdate,
  HouseholdSnapshot, PromptPreset, SubmissionReceipt,
} from "./domain.ts";
import type { HouseholdStoreApi, HouseholdSubmissionArgs } from "./household-store.ts";
import type { HouseholdDatabase } from "./database.ts";
import type { StoredSubmission, SubmissionPayload } from "./submission-repository.ts";
import { settleResolvedWaitingSources } from "./task-flow/source-settlement.ts";
import type { SourceSettlementInput,SourceQuestionSettlement } from "./task-flow/source-settlement.ts";
import { ExecutionAuthorityRepository } from "./request-context.ts";
import type { MessageTaskContext } from "./request-context.ts";

type CancelOperation={operationId:string;issuedAtMs:number;goalId?:string;runId?:string};
function admissionError(code:string,statusCode=409):Error{return Object.assign(new Error(code),{code,statusCode,deliveryOutcome:"not_sent",retryable:false});}

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([,item]) => item !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export type DeliveryOptions = {
  dispatcherEnabled?: boolean; maxActiveRuns?: number; pollIntervalMs?: number;
  dispatchLeaseMs?: number; maxDispatchAttempts?: number;
  sourceCapture?: (submissionId:string,text:string)=>Promise<void>;
  sourceSettlement?: (input:SourceSettlementInput)=>Promise<SourceQuestionSettlement|null>;
};

export class SqliteHouseholdStore implements HouseholdStoreApi {
  readonly maxActiveRuns: number;
  readonly adapterMode: HouseholdAgentAdapter["mode"];
  private readonly database: HouseholdDatabase;
  private readonly adapter: HouseholdAgentAdapter;
  private readonly options: Required<DeliveryOptions>;
  private readonly submissionListeners = new Set<(receipt: SubmissionReceipt) => void>();
  private readonly agentListeners = new Set<(event: HouseholdAgentEvent) => void>();
  private readonly unsubscribeAdapter: () => void;
  private timer: ReturnType<typeof setInterval> | undefined;
  private maintenance: Promise<void> | undefined;
  private started = false;
  private closed = false;
  private lastCycleAt: string | null = null;
  private lastCycleError: string | null = null;
  private readonly controls: ExecutionAuthorityRepository;
  private readonly organization:ConversationOrganizationRepository;
  private readonly probeBackoff = new Map<string,{ failures:number; nextAt:number }>();

  constructor(database: HouseholdDatabase, adapter: HouseholdAgentAdapter, options: DeliveryOptions = {}) {
    this.database = database;
    this.organization=new ConversationOrganizationRepository(database.domainConnection());
    this.controls = new ExecutionAuthorityRepository(database.domainConnection());
    this.adapter = adapter;
    this.adapterMode = adapter.mode;
    this.options = {
      dispatcherEnabled: options.dispatcherEnabled ?? true,
      maxActiveRuns: Math.max(1, Math.min(options.maxActiveRuns ?? 2, 16)),
      pollIntervalMs: Math.max(500, options.pollIntervalMs ?? 2_000),
      dispatchLeaseMs: Math.max(60_000, options.dispatchLeaseMs ?? 120_000),
      maxDispatchAttempts: Math.max(1, Math.min(options.maxDispatchAttempts ?? 6, 20)),
      sourceCapture: options.sourceCapture ?? (async()=>{}),
      sourceSettlement: options.sourceSettlement ?? (async()=>null),
    };
    this.maxActiveRuns = this.options.maxActiveRuns;
    this.unsubscribeAdapter = adapter.onEvent(event => this.handleAgentEvent(event));
  }

  /** The composition root owns lifecycle; construction never dispatches work. */
  async start(): Promise<void> {
    if (this.started || this.closed) return;
    this.started = true;
    if (!this.options.dispatcherEnabled) return;
    this.timer = setInterval(() => this.wake(), this.options.pollIntervalMs);
    this.timer.unref();
    this.wake();
  }

  private wake(): void {
    if (!this.started || this.closed || !this.options.dispatcherEnabled) return;
    void this.reconcileRuns().catch(() => { this.lastCycleError = "delivery_cycle_failed"; });
  }

  private publish(receipt: SubmissionReceipt): void {
    for (const listener of this.submissionListeners) {
      try { listener(receipt); } catch { /* A projection failure cannot roll back durable delivery. */ }
    }
  }

  private refreshProfile(profileId: string): void {
    const profile = this.database.getProfile(profileId);
    if (!profile) return;
    if (profile.status === "offline" || (profile.status === "paused" && profile.statusDetail !== "Delivery outcome unknown; recovery required")) return;
    const activity = this.database.submissions.profileActivity(profileId);
    if (activity.recoveryRequired > 0) this.database.setProfileStatus(profileId,"paused","Delivery outcome unknown; recovery required");
    else if (activity.active > 0) this.database.setProfileStatus(profileId,"working","Responding");
    else if (activity.queued > 0 && profile.status !== "offline" && profile.status !== "paused") this.database.setProfileStatus(profileId,"queued","Waiting for execution capacity");
    else if (profile.status === "working" || profile.status === "queued" ||
      (profile.status === "paused" && profile.statusDetail === "Delivery outcome unknown; recovery required")) {
      this.database.setProfileStatus(profileId,"available","Ready");
    }
  }

  getProfile(profileId: string): FamilyProfile | undefined { return this.database.getProfile(profileId); }

  getSnapshot(): HouseholdSnapshot {
    const counts = this.database.submissions.counts();
    return {
      maxActiveRuns: this.maxActiveRuns, activeRuns: counts.active, queuedRuns: counts.queued,
      recoveryRequiredRuns: counts.recoveryRequired,
      profiles: this.database.listProfiles().map(({ id,displayName,initials,color,status,statusDetail }) => ({ id,displayName,initials,color,status,statusDetail })),
    };
  }

  async reconcileRuns(): Promise<void> {
    if (this.closed || !this.options.dispatcherEnabled) return;
    if (this.maintenance) return this.maintenance;
    const cycle = Promise.resolve().then(() => this.runMaintenance());
    this.maintenance = cycle;
    try { await cycle; } finally { if (this.maintenance === cycle) this.maintenance = undefined; }
  }

  private deferProbe(id: string): void {
    const failures = Math.min((this.probeBackoff.get(id)?.failures ?? 0)+1,8);
    this.probeBackoff.set(id,{ failures,nextAt:Date.now()+Math.min(300_000,2_000*2**failures) });
  }

  private async runMaintenance(): Promise<void> {
    this.lastCycleError = null;
    try {
      for (const receipt of this.database.submissions.recoverExpiredClaims()) {
        this.refreshProfile(receipt.profileId); this.publish(receipt);
      }
      for (const active of this.database.submissions.listActive(32)) {
        if (this.closed) return;
        // A live lease belongs to its sender. Other processes may only inspect it after expiry.
        if (active.receipt.status === "dispatching" && active.leaseExpiresAt && Date.parse(active.leaseExpiresAt) > Date.now()) continue;
        if ((this.probeBackoff.get(active.receipt.submissionId)?.nextAt ?? 0) > Date.now()) continue;
        const conversation = this.database.getConversation(active.receipt.conversationId);
        if (!conversation) continue;
        try {
          const state = active.taskContext?.independentTopicOf&&this.adapter.getExactRunState
            ? await this.adapter.getExactRunState(conversation,active.receipt.runId??active.receipt.submissionId)
            : await this.adapter.getRunState(conversation,active.receipt.runId ?? active.receipt.submissionId,active.taskContext?.independentTopicOf?undefined:active.receipt.goalId ?? undefined);
          if (state.status === "unknown") { this.deferProbe(active.receipt.submissionId); continue; }
          this.probeBackoff.delete(active.receipt.submissionId);
          let current=this.database.submissions.get(active.receipt.submissionId);
          if(!current||!["running","dispatching"].includes(current.receipt.status)&&!current.recoveryRequired)continue;
          if (state.runId && current.receipt.runId && state.runId !== current.receipt.runId && (current.taskContext?.independentTopicOf || !current.receipt.goalId || state.goalId!==current.receipt.goalId)) continue;
          if (state.updatedAt && Date.parse(state.updatedAt) < Date.parse(current.dispatchStartedAt ?? current.createdAt)) continue;
          let status: SubmissionReceipt["status"] = state.status === "queued" ? "running" : state.status;
          let failureCode:string|undefined;
          let settlement:SourceQuestionSettlement|null=null;
          const goalExpected=!current.taskContext?.independentTopicOf&&(Boolean(current.receipt.goalId)||this.database.getSubmissionDomainBinding(current.receipt.submissionId)?.goalBound===true);
          if(status==="complete"&&goalExpected&&!this.adapter.getContext){status="failed";failureCode="native_goal_context_unavailable";}
          if(this.adapter.getContext && (status==="complete"||!current.taskContext?.independentTopicOf&&current.receipt.goalId)){
            const native=await this.adapter.getContext(conversation);
            // A tool/native end callback may have changed this exact source while
            // the observation was in flight. Never overwrite its newer terminal state.
            current=this.database.submissions.get(active.receipt.submissionId);
            if(!current||!["running","dispatching"].includes(current.receipt.status)&&!current.recoveryRequired)continue;
            // The receipt may also have moved to a newer run while native
            // context was awaited. An older observation cannot settle it.
            if(state.runId&&current.receipt.runId&&state.runId!==current.receipt.runId&&(current.taskContext?.independentTopicOf||!current.receipt.goalId||state.goalId!==current.receipt.goalId))continue;
            if(state.updatedAt&&Date.parse(state.updatedAt)<Date.parse(current.dispatchStartedAt??current.createdAt))continue;
            const boundGoal=current.receipt.goalId,goal=native.goal;
            const checkpoint=native.sessionId?this.database.getCheckpoint(conversation.id,native.sessionId,goal?.id??null):null;
            const immutable={id:current.receipt.submissionId,runId:current.receipt.runId,profileId:current.receipt.profileId,textHash:current.textHash,control:this.database.getGoalControlIssuedAt(conversation.id)};
            const assertSettlementCurrent=()=>{
              if(this.closed)throw Error("store_closed");const fresh=this.database.submissions.get(immutable.id);
              if(!fresh||!["running","dispatching"].includes(fresh.receipt.status)&&!fresh.recoveryRequired||fresh.receipt.runId!==immutable.runId||fresh.receipt.profileId!==immutable.profileId||fresh.textHash!==immutable.textHash||this.database.getGoalControlIssuedAt(conversation.id)!==immutable.control)throw Error("source_settlement_changed");
            };
            if(status==="complete"&&(current.taskContext?.independentTopicOf||!goalExpected&&(!goal||goal.status==="complete")||goalExpected&&boundGoal===goal?.id&&goal?.status==="complete"&&!native.continuationPending&&!state.continuationPending)){
              if(current.taskContext?.independentTopicOf&&state.runId!==current.receipt.runId){this.deferProbe(current.receipt.submissionId);continue;}
              if(!native.sessionId){status="failed";failureCode="native_source_context_unavailable";}
              else{
                settlement=await this.options.sourceSettlement({sourceId:current.receipt.submissionId,conversationId:conversation.id,sessionId:native.sessionId,goalId:current.taskContext?.independentTopicOf||goalExpected?boundGoal:null,goalComplete:!current.taskContext?.independentTopicOf&&Boolean(boundGoal&&boundGoal===goal?.id&&goal.status==="complete"),assertCurrent:assertSettlementCurrent});
                assertSettlementCurrent();current=this.database.submissions.get(immutable.id)!;
              }
            }
            if(current.taskContext?.independentTopicOf&&status==="complete"){
              if(!settlement){status="failed";failureCode="source_question_context_unavailable";}
              else if(settlement.continuationPending)status="running";
              else if(settlement.waiting)status="waiting_for_user";
            // No-goal sources cannot adopt later/unproven native goals. The
            // trusted independent marker isolates only its own observed turn.
            }else if(!boundGoal&&status==="complete"&&goal&&goal.status!=="complete"){
              status="failed";failureCode="native_goal_binding_missing";
            }else if(!boundGoal&&this.database.getSubmissionDomainBinding(current.receipt.submissionId)?.goalBound===true&&status==="complete"&&!native.continuationPending&&!state.continuationPending){
              status="failed";failureCode="native_goal_binding_missing";
            }else if(boundGoal&&goal?.id!==boundGoal){
              status="cancelled";failureCode="native_goal_binding_changed";
            }else if(boundGoal&&goal){
              if(goal.status==="paused"){status="cancelled";failureCode="native_goal_paused";}
              else if(goal.status==="blocked"){status="failed";failureCode="native_goal_blocked";}
              else if(goal.status==="budget_limited"){status="failed";failureCode="native_goal_budget_limited";}
              else if(goal.status==="usage_limited"){status="failed";failureCode="native_goal_usage_limited";}
              else if(status==="complete"){
                if(native.continuationPending||state.continuationPending)status="running";
                // Explicit native operator completion is authority to close the
                // goal. It is never a claim that private provider work succeeded.
                else if(goal.status==="complete")status="complete";
                else if(checkpoint?.phase==="waiting_for_user"&&checkpoint.questionArtifactId)status="waiting_for_user";
                else {status="failed";failureCode=checkpoint?.phase==="complete"?"native_goal_completion_missing":"task_incomplete_after_native_run";}
              }
            }else if(status==="complete"){
              if(native.continuationPending||state.continuationPending)status="running";
              else if(settlement?.continuationPending)status="running";
              else if(settlement?.waiting||!settlement&&!goal&&checkpoint?.phase==="waiting_for_user"&&checkpoint.questionArtifactId)status="waiting_for_user";
            }
          }
          if (status === "running" && current.receipt.status === "running" && !current.recoveryRequired) continue;
          const observedRun=current.receipt.runId??state.runId;
          let receipt:SubmissionReceipt|undefined;
          const resolved:SubmissionReceipt[]=[];
          const sql=this.database.domainConnection();sql.exec("BEGIN IMMEDIATE");
          try{
            if(status==="complete"&&settlement)resolved.push(...settleResolvedWaitingSources(this.database,settlement));
            receipt=failureCode?this.database.submissions.failWithCode(current.receipt.submissionId,observedRun,failureCode,status as "failed"|"cancelled"):
              this.database.submissions.reconcile(current.receipt.submissionId,status,observedRun);
            sql.exec("COMMIT");
          }catch(error){sql.exec("ROLLBACK");throw error;}
          for(const done of resolved){this.refreshProfile(done.profileId);this.publish(done);}
          if (receipt) { this.refreshProfile(receipt.profileId); this.publish(receipt); }
        } catch { this.lastCycleError = "gateway_reconciliation_unavailable"; this.deferProbe(active.receipt.submissionId); }
      }
      // Bounded maintenance batch. Remaining due work is picked up by the next clock tick.
      for (let index=0; index<this.maxActiveRuns && !this.closed; index++) {
        const claim = this.database.submissions.claimNext(this.maxActiveRuns,this.options.dispatchLeaseMs);
        if (!claim) break;
        this.refreshProfile(claim.receipt.profileId); this.publish(claim.receipt);
        await this.dispatchClaim(claim);
      }
      this.lastCycleAt = new Date().toISOString();
    } finally {
      // Native mirrors and task.stop can settle the existing ledger directly.
      // Recompute every profile so absence from listActive cannot leave it working.
      for(const profile of this.database.listProfiles())this.refreshProfile(profile.id);
    }
  }

  private currentGrant(claim: StoredSubmission): { conversation: Conversation; profile: FamilyProfile } | undefined {
    const profile = this.database.getProfile(claim.receipt.profileId);
    const conversation = this.database.getConversation(claim.receipt.conversationId);
    if (!profile || !conversation || conversation.deletedAt || conversation.ownerProfileId !== profile.id ||
      conversation.agentId !== profile.agentId || claim.receipt.agentId !== profile.agentId ||
      !profile.capabilities.includes("chat")) return undefined;
    if(profile.role === "child" && (claim.payload?.kind === "goal_resume" || (claim.payload?.kind === "message" && Boolean(claim.payload.goalStart)) || claim.taskContext && (claim.taskContext.mode !== "conversation" || claim.taskContext.replyToQuestionId || claim.taskContext.focus || claim.taskContext.approval))) return undefined;
    if(claim.taskContext?.mode === "diagnostic" && (profile.role !== "admin" || !profile.capabilities.includes("viewDiagnostics"))) return undefined;
    if (claim.originDeviceId) {
      const device = this.database.getDevice(claim.originDeviceId);
      if (!device || device.status !== "active" || device.profileId !== profile.id) return undefined;
    }
    return { conversation, profile };
  }

  private async dispatchClaim(claim: StoredSubmission): Promise<void> {
    const token = claim.leaseToken!;
    const grant = this.currentGrant(claim);
    if (!grant || !claim.payload) {
      this.database.submissions.failClaim(claim.receipt.submissionId,token,grant ? "queued_payload_unavailable" : "delivery_authorization_revoked");
      this.refreshProfile(claim.receipt.profileId);
      this.publish(this.database.submissions.get(claim.receipt.submissionId)!.receipt);
      return;
    }
    const assertAdmission = () => {
      const binding=this.database.getSubmissionDomainBinding(claim.receipt.submissionId);
      if(!binding || binding.controlWatermark!==this.database.getGoalControlIssuedAt(claim.receipt.conversationId))throw admissionError("delivery_control_superseded_conflict");
      const reply=claim.taskContext;
      if(reply?.replyToQuestionId){
        const checkpoint=reply.expectedSessionId&&reply.expectedGoalId!==undefined?this.database.getCheckpoint(claim.receipt.conversationId,reply.expectedSessionId,reply.expectedGoalId):null;
        if(!checkpoint || checkpoint.phase!=="waiting_for_user" || checkpoint.questionArtifactId!==reply.replyToQuestionId)throw admissionError("question_binding_conflict");
      }
      const staleResume = claim.payload?.kind === "goal_resume" &&
        this.database.getGoalControlIssuedAt(claim.receipt.conversationId) > claim.payload.operation.issuedAtMs;
      if (staleResume || this.closed || !this.database.submissions.isClaimCurrent(claim.receipt.submissionId,token) || !this.currentGrant(claim)) {
        throw Object.assign(new Error("delivery_admission_revoked"), { code:"delivery_admission_revoked",deliveryOutcome:"not_sent",retryable:false });
      }
    };
    const renewal = setInterval(() => {
      try { this.database.submissions.renew(claim.receipt.submissionId,token,this.options.dispatchLeaseMs); }
      catch { this.lastCycleError = "dispatch_lease_renewal_failed"; }
    },Math.floor(this.options.dispatchLeaseMs/3));
    renewal.unref();
    try {
      assertAdmission();
      let dispatchedTaskContext=claim.taskContext??undefined;
      if(claim.payload.kind==="message" && claim.payload.goalStart){
        const timestamp=this.database.submissions.goalStartDispatchTime(claim.receipt.submissionId,token,this.database.getGoalControlIssuedAt(claim.receipt.conversationId)+1);
        dispatchedTaskContext={...(claim.taskContext??claim.payload.taskContext??{mode:"task",artifactIds:[]}),goalStartDispatchAtMs:timestamp};
      }
      let receipt: SubmissionReceipt;
      if (claim.payload.kind === "goal_resume") {
        if (!this.adapter.mutateGoal) {
          this.database.submissions.failClaim(claim.receipt.submissionId,token,"native_goal_unavailable");
          return;
        }
        const result = await this.adapter.mutateGoal(grant.conversation,claim.payload.operation,assertAdmission);
        receipt = { ...claim.receipt,status:"running",queuePosition:null,runId:result.runId,goalId:result.goalId };
      } else if (claim.payload.kind === "message" && typeof claim.payload.text === "string") {
        assertAdmission();
        try{await this.options.sourceCapture(claim.receipt.submissionId,claim.payload.text);}
        catch{throw Object.assign(new Error("source_capture_unavailable"),{code:"source_capture_unavailable",deliveryOutcome:"not_sent",retryable:true});}
        assertAdmission();
        receipt = await this.adapter.submitMessage({
          conversation:grant.conversation,profile:grant.profile,text:claim.payload.text,
          submissionId:claim.receipt.submissionId,shouldQueue:false,queuePosition:null,assertAdmission,
          ...(claim.payload.nativeContext ? { nativeContext:claim.payload.nativeContext } : {}),
          ...(claim.payload.goalStart ? { goalStart:claim.payload.goalStart } : {}),
          ...(dispatchedTaskContext ? { taskContext:dispatchedTaskContext } : {}),
        });
      } else {
        this.database.submissions.failClaim(claim.receipt.submissionId,token,"queued_payload_invalid");
        return;
      }
      if (receipt.submissionId !== claim.receipt.submissionId || receipt.conversationId !== grant.conversation.id ||
        receipt.profileId !== grant.profile.id || receipt.agentId !== grant.profile.agentId ||
        !["running","complete","failed","cancelled"].includes(receipt.status)) {
        this.database.submissions.markUnknown(claim.receipt.submissionId,token,"gateway_receipt_invalid");
      } else {
        const persisted=this.database.submissions.get(claim.receipt.submissionId);
        const goalBound=Boolean(receipt.goalId??persisted?.receipt.goalId??claim.receipt.goalId)||claim.payload.kind==="message"&&Boolean(claim.payload.goalStart);
        // A transport's completed turn acknowledgement cannot certify the
        // original goal. Maintenance reads the current native authority first.
        this.database.submissions.accepted(claim.receipt.submissionId,token,receipt.status==="complete"&&goalBound?{...receipt,status:"running"}:receipt);
      }
      this.database.touchConversation(grant.conversation.id);
    } catch (error) {
      const typed = error as { deliveryOutcome?: unknown; retryable?: unknown; code?: unknown };
      if (typed?.deliveryOutcome === "not_sent") {
        const retry = typed.retryable === true && claim.attemptCount < this.options.maxDispatchAttempts;
        const backoff = Math.min(60_000,1_000*2**Math.min(claim.attemptCount-1,6));
        this.database.submissions.retryNotSent(claim.receipt.submissionId,token,
          claim.payload?.kind === "goal_resume" && this.database.getGoalControlIssuedAt(claim.receipt.conversationId) > claim.payload.operation.issuedAtMs ? "goal_resume_superseded" :
          typed.code === "admission_revoked" || typed.code === "delivery_admission_revoked" ? "delivery_authorization_revoked" :
            retry ? "gateway_unavailable_retrying" : typeof typed.code === "string" && /^[a-z][a-z0-9_]{0,80}$/.test(typed.code) ? typed.code : "gateway_unavailable_attempts_exhausted",
          retry ? new Date(Date.now()+backoff).toISOString() : null);
      } else {
        // Generic chat.send dedupe is not guaranteed durable across Gateway restart.
        // Preserve the reservation and payload for inspection; never blind-replay an unknown effect.
        this.database.submissions.markUnknown(claim.receipt.submissionId,token,"gateway_send_outcome_unknown");
      }
    } finally {
      clearInterval(renewal);
      this.refreshProfile(claim.receipt.profileId);
      const current = this.database.submissions.get(claim.receipt.submissionId);
      if (current) this.publish(current.receipt);
    }
  }

  listPresets(profile: FamilyProfile): PromptPreset[] { return this.database.listPresets().filter(preset => preset.allowedRoles.includes(profile.role)); }
  listConversations(profile: FamilyProfile): Conversation[] { return this.database.listConversations(profile.id); }
  getConversation(profile: FamilyProfile, conversationId: string): Conversation | undefined {
    const conversation = this.database.getConversation(conversationId);
    return conversation && !conversation.deletedAt && (conversation.ownerProfileId === profile.id || conversation.audience === "household") ? {...conversation,folderId:this.organization.placement(profile.id,conversation.id)} : undefined;
  }
  private ownedConversation(profile: FamilyProfile, conversationId: string): Conversation | undefined {
    const current = this.database.getProfile(profile.id);
    const conversation = this.database.getConversation(conversationId);
    return current?.capabilities.includes("chat") && !conversation?.deletedAt && conversation?.ownerProfileId === current.id && conversation.agentId === current.agentId ? conversation : undefined;
  }

  async createConversation(profile: FamilyProfile, title: string, presetId: string | null, audience: "private" | "household" = "private"): Promise<Conversation> {
    const current = this.database.getProfile(profile.id);
    if (!current?.capabilities.includes("chat")) throw new Error("conversation_not_allowed");
    if (presetId !== null && !this.listPresets(current).some(preset => preset.id === presetId)) throw new Error("preset_not_allowed");
    const id = `conv-${randomUUID()}`;
    const conversation: Conversation = {
      id,ownerProfileId:current.id,agentId:current.agentId,folderId:null,deletedAt:null,sessionKey:`hardy-home:${id}`,title,tags:[],presetId,
      audience,updatedAt:new Date().toISOString(),
    };
    await this.adapter.ensureConversation(conversation);
    this.database.insertConversation(conversation);
    return conversation;
  }

  updateConversationMetadata(profile: FamilyProfile, id: string, title: string, tags?: string[]): Conversation | undefined {
    const conversation = this.ownedConversation(profile, id);
    if(!conversation||!this.database.updateConversationMetadata(conversation,title,tags))return;
    return this.getConversation(profile,id);
  }

  private organizationProfile(profile:FamilyProfile):FamilyProfile{
    const current=this.database.getProfile(profile.id);
    if(!current?.capabilities.includes("chat"))throw new ConversationOrganizationError("conversation_not_allowed",403);
    return current;
  }
  listConversationFolders(profile:FamilyProfile){return this.organization.list(this.organizationProfile(profile).id);}
  createConversationFolder(profile:FamilyProfile,id:string,name:string){return this.organization.create(this.organizationProfile(profile).id,id,name);}
  renameConversationFolder(profile:FamilyProfile,id:string,name:string){return this.organization.rename(this.organizationProfile(profile).id,id,name);}
  deleteConversationFolder(profile:FamilyProfile,id:string){return this.organization.remove(this.organizationProfile(profile).id,id);}
  moveConversationToFolder(profile:FamilyProfile,id:string,folderId:string|null):Conversation|undefined{
    const current=this.organizationProfile(profile),conversation=this.getConversation(current,id);
    if(!conversation)return;
    this.organization.place(current.id,id,folderId);
    return this.getConversation(current,id);
  }
  async deleteConversation(profile:FamilyProfile,id:string,originDeviceId?:string):Promise<boolean>{
    const current=this.organizationProfile(profile),before=this.database.getConversation(id);
    if(!before||before.ownerProfileId!==current.id||before.agentId!==current.agentId)return false;
    const assertCurrent=()=>{
      const actor=this.organizationProfile(profile),conversation=this.database.getConversation(id);
      const device=originDeviceId?this.database.getDevice(originDeviceId):null;
      if(!conversation||conversation.ownerProfileId!==actor.id||conversation.agentId!==actor.agentId||
        originDeviceId&&(!device||device.status!=="active"||device.deviceKind!=="personal"||device.profileId!==actor.id))
        throw new ConversationOrganizationError("conversation_not_allowed",403);
      return conversation;
    };
    assertCurrent();
    if(before.deletedAt)return true;
    if(this.organization.hasUnsettled(id))throw new ConversationOrganizationError("conversation_active",409);
    if(!this.adapter.getContext)throw new ConversationOrganizationError("conversation_state_unavailable",503);
    let native:HouseholdConversationContext;
    try{native=await this.adapter.getContext(before);}catch{throw new ConversationOrganizationError("conversation_state_unavailable",503);}
    const latest=assertCurrent();if(latest.deletedAt)return true;
    if(!native||typeof native.continuationPending!=="boolean"||native.goal!==null&&(!native.goal||!["active","paused","blocked","usage_limited","budget_limited","complete"].includes(native.goal.status)))
      throw new ConversationOrganizationError("conversation_state_unavailable",503);
    if(native.continuationPending||native.goal?.status==="active"||this.organization.hasUnsettled(id))
      throw new ConversationOrganizationError("conversation_active",409);
    // Canonical source insertion and this tombstone are mutually fenced in SQLite.
    if(!this.organization.tombstone(id,current.id,current.agentId))throw new ConversationOrganizationError("conversation_active",409);
    return true;
  }

  async listMessages(profile: FamilyProfile, conversationId: string): Promise<ChatMessage[] | undefined> {
    const conversation = this.getConversation(profile,conversationId);
    if(!conversation)return;
    const messages=await this.adapter.listMessages(conversation);
    return this.getConversation(profile,conversationId)?messages:undefined;
  }

  private enqueue(profile: FamilyProfile, conversation: Conversation, submissionId: string, payload: SubmissionPayload, originDeviceId?: string): SubmissionReceipt {
    if (originDeviceId) {
      const device = this.database.getDevice(originDeviceId);
      if (!device || device.status !== "active" || device.profileId !== profile.id) throw new Error("delivery_authorization_revoked");
    }
    const current=this.ownedConversation(profile,conversation.id);
    if(!current)throw admissionError("conversation_not_found",404);
    const canonical = canonicalJson(payload);
    const result = this.database.submissions.enqueue({
      submissionId,conversationId:conversation.id,profileId:profile.id,agentId:profile.agentId,
      textHash:hash(payload.kind === "message" ? payload.text : canonical),requestHash:hash(canonical),payload,originDeviceId,
      legacyCompatible:payload.kind === "message" && !payload.nativeContext && !payload.goalStart && !payload.taskContext,
    });
    this.refreshProfile(profile.id);
    if (!result.replayed) this.publish(result.submission.receipt);
    this.wake();
    return result.submission.receipt;
  }

  async submitMessage(args: HouseholdSubmissionArgs): Promise<SubmissionReceipt | undefined> {
    const conversation = this.ownedConversation(args.profile,args.conversationId);
    const profile = this.database.getProfile(args.profile.id);
    if (!conversation || !profile) return undefined;
    const existing=this.database.submissions.get(args.submissionId);
    let taskContext=args.taskContext?structuredClone(args.taskContext):undefined;
    let goalStart=args.goalStart;
    if(profile.role === "child" && (goalStart || taskContext && (taskContext.mode!=="conversation" || taskContext.replyToQuestionId || taskContext.focus || taskContext.approval)))throw admissionError("child_conversation_only",403);
    if(taskContext?.mode === "diagnostic" && (profile.role!=="admin" || !profile.capabilities.includes("viewDiagnostics")))throw admissionError("diagnostic_operator_required",403);
    if(taskContext){
      taskContext.admittedAtMs=existing?.taskContext?.admittedAtMs??Date.now();
      if(taskContext.replyToQuestionId){
        if(goalStart)throw admissionError("invalid_reply_goal_start",400);
        if(existing?.taskContext?.replyToQuestionId===taskContext.replyToQuestionId){
          taskContext.expectedGoalId=existing.taskContext.expectedGoalId;
          taskContext.expectedSessionId=existing.taskContext.expectedSessionId;
        }else{
          if(!this.adapter.getContext)throw admissionError("native_context_unavailable",503);
          const native=await this.adapter.getContext(conversation);
          const goal=native.goal?.status==="complete"?null:native.goal;
          const checkpoint=native.sessionId?this.database.getCheckpoint(conversation.id,native.sessionId,goal?.id??null):null;
          if(!native.sessionId || goal&&goal.status!=="active" || !checkpoint || checkpoint.phase!=="waiting_for_user" || checkpoint.questionArtifactId!==taskContext.replyToQuestionId)
            throw admissionError("question_binding_conflict");
          taskContext.expectedGoalId=goal?.id??null;taskContext.expectedSessionId=native.sessionId;
        }
      }else if(["task","brain_dump","diagnostic"].includes(taskContext.mode)){
        if(args.text.length>16_000)throw admissionError("invalid_task_message_length",400);
        goalStart??={issuedAtMs:taskContext.admittedAtMs};
      }
    }
    return this.enqueue(profile,conversation,args.submissionId,{
      kind:"message",text:args.text,
      ...(args.nativeContext?{nativeContext:args.nativeContext}:goalStart?{nativeContext:{page:"hardy-home",title:"Household task"}}:{}),
      ...(goalStart?{goalStart}:{}),...(taskContext?{taskContext}:{}),
    },args.originDeviceId);
  }

  getConversationActivity(profile: FamilyProfile, conversationId: string): ConversationActivity | undefined {
    if (!this.ownedConversation(profile, conversationId)) return undefined;
    return this.database.submissions.conversationActivity(conversationId);
  }

  async getContext(profile: FamilyProfile, conversationId: string): Promise<HouseholdConversationContext | undefined> {
    const conversation = this.ownedConversation(profile,conversationId);
    if (!conversation) return undefined;
    if (!this.adapter.getContext) throw new Error("native_context_unavailable");
    const context=await this.adapter.getContext(conversation);
    return this.ownedConversation(profile,conversationId)?context:undefined;
  }

  async getCheckpoint(profile: FamilyProfile, conversationId: string): Promise<HouseholdCheckpoint | null | undefined> {
    const context = await this.getContext(profile,conversationId);
    if (!context) return undefined;
    if (!context.sessionId) throw new Error("native_context_unavailable");
    if (!this.ownedConversation(profile,conversationId)) return undefined;
    return this.database.getCheckpoint(conversationId,context.sessionId,context.goal?.id ?? null);
  }

  async updateCheckpoint(profile: FamilyProfile, conversationId: string, update: HouseholdCheckpointUpdate, originDeviceId?: string): Promise<HouseholdCheckpoint | undefined> {
    const referenceValid = (value: unknown) => value === null || value === undefined ||
      (typeof value === "string" && value.length>0 && value.length<=256 && !/[\x00-\x1f\x7f]/.test(value));
    if (!Number.isSafeInteger(update.expectedRevision) || update.expectedRevision<0 ||
      typeof update.nativeSessionId !== "string" || update.nativeSessionId.length<1 || update.nativeSessionId.length>256 ||
      !referenceValid(update.nativeGoalId) || typeof update.phase !== "string" || update.phase.trim().length<1 || update.phase.length>80 ||
      !referenceValid(update.questionArtifactId) || !referenceValid(update.checkpointArtifactId)) throw new Error("invalid_checkpoint_update");
    const context = await this.getContext(profile,conversationId);
    if (!context) return undefined;
    if (!context.sessionId || context.sessionId !== update.nativeSessionId || (context.goal?.id ?? null) !== update.nativeGoalId) {
      throw new Error("checkpoint_native_binding_changed");
    }
    if (!this.ownedConversation(profile,conversationId)) return undefined;
    if (originDeviceId) {
      const device = this.database.getDevice(originDeviceId);
      if (!device || device.status !== "active" || device.profileId !== profile.id) throw new Error("delivery_authorization_revoked");
    }
    return this.database.updateCheckpoint(conversationId,update);
  }

  async updateGoal(profile: FamilyProfile, conversationId: string, operation: HouseholdGoalMutation, originDeviceId?: string): Promise<HouseholdGoalMutationResult | undefined> {
    const conversation = this.ownedConversation(profile,conversationId);
    const current = this.database.getProfile(profile.id);
    if (!conversation || !current) return undefined;
    if (!this.adapter.mutateGoal) throw new Error("native_goal_unavailable");
    if(current.role === "child")throw admissionError("goal_control_not_allowed",403);
    if (operation.action === "resume") {
      const existing = this.database.submissions.get(operation.operationId);
      const prior=existing??this.database.submissions.latestGoalSource(conversationId,current.id,operation.goalId);
      let source=prior;
      const reference=prior?.taskContext?.sourceReferenceId;
      if(reference!==undefined){
        if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(reference))throw admissionError("goal_source_unavailable");
        source=this.database.submissions.get(reference);
      }
      const original=source?.taskContext;
      if(!source || !original || source.receipt.profileId!==current.id || source.receipt.conversationId!==conversationId ||
        source.receipt.goalId!==operation.goalId || original.sourceReferenceId || !original.sourceArtifactId || !/^artifact-[a-f0-9]{64}$/.test(original.sourceArtifactId) ||
        !["conversation","task","brain_dump","diagnostic"].includes(original.mode) || !Array.isArray(original.artifactIds) || original.artifactIds.length>12 ||
        original.artifactIds.some(id=>!/^artifact-[a-f0-9]{64}$/.test(id)) || reference && prior?.taskContext?.sourceArtifactId!==original.sourceArtifactId)
        throw admissionError("goal_source_unavailable");
      const taskContext:MessageTaskContext={mode:original.mode,artifactIds:[...original.artifactIds],sourceReferenceId:source.receipt.submissionId,
        sourceArtifactId:original.sourceArtifactId,expectedGoalId:operation.goalId};
      if(!existing){
        if(this.database.getGoalControlIssuedAt(conversationId)>operation.issuedAtMs)throw admissionError("goal_resume_superseded_conflict");
        this.database.recordGoalControl(conversationId,operation.issuedAtMs);
      }
      const receipt = this.enqueue(current,conversation,operation.operationId,{ kind:"goal_resume",operation,taskContext },originDeviceId);
      return { goalId:operation.goalId,runId:receipt.runId,status:receipt.status,replayed:!!existing,receipt };
    }
    if (originDeviceId) {
      const device = this.database.getDevice(originDeviceId);
      if (!device || device.status !== "active" || device.profileId !== current.id) throw new Error("delivery_authorization_revoked");
    }
    const assertAdmission = () => {
      if (!this.ownedConversation(profile,conversationId)) throw new Error("delivery_authorization_revoked");
      if (originDeviceId) {
        const device = this.database.getDevice(originDeviceId);
        if (!device || device.status !== "active" || device.profileId !== current.id) throw new Error("delivery_authorization_revoked");
      }
    };
    this.database.recordGoalControl(conversationId,operation.issuedAtMs);
    // Persist the user's superseding intent before the native metadata effect so a crash
    // after a successful pause/edit cannot later dispatch an older queued resume.
    for (const receipt of this.database.submissions.cancelQueuedGoalOperations(conversationId,operation.goalId,operation.issuedAtMs)) this.publish(receipt);
    this.refreshProfile(profile.id);
    return this.adapter.mutateGoal(conversation,operation,assertAdmission);
  }

  /** Cancellation addresses an immutable observed target. Late retries never retarget a newer goal/run. */
  async cancelTarget(profile:FamilyProfile,conversationId:string,operation:CancelOperation,originDeviceId?:string):Promise<{cancelled:boolean;replayed:boolean;goalId?:string;runId?:string}|undefined>{
    const conversation=this.ownedConversation(profile,conversationId),current=this.database.getProfile(profile.id);
    if(!conversation || !current)return undefined;
    if(current.role==="child")throw admissionError("goal_control_not_allowed",403);
    const assertCurrent=()=>{
      const fresh=this.database.getProfile(profile.id);
      if(!this.ownedConversation(profile,conversationId)||!fresh||fresh.role==="child")throw admissionError("delivery_authorization_revoked",403);
      if(originDeviceId){const device=this.database.getDevice(originDeviceId);if(!device||device.status!=="active"||device.profileId!==profile.id)throw admissionError("delivery_authorization_revoked",403);}
    };
    assertCurrent();
    const request={profileId:profile.id,operationId:operation.operationId,issuedAtMs:operation.issuedAtMs,
      ...(operation.goalId?{goalId:operation.goalId}:{}),...(operation.runId?{runId:operation.runId}:{})};
    const replay=this.controls.control(operation.operationId,conversationId,request) as {cancelled:boolean;goalId?:string;runId?:string}|null;
    if(replay)return {...replay,replayed:true};
    if(!Number.isSafeInteger(operation.issuedAtMs)||operation.issuedAtMs<1||operation.issuedAtMs>Date.now()+5*60_000||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(operation.operationId)||!operation.goalId&&!operation.runId)throw admissionError("invalid_cancel_operation",400);
    if(this.database.getGoalControlIssuedAt(conversationId)>operation.issuedAtMs)throw admissionError("cancel_superseded_conflict");
    const adapter=this.adapter as HouseholdAgentAdapter&{cancelTarget?:(conversation:Conversation,operation:CancelOperation,assertCurrent:()=>void)=>Promise<void>};
    if(!adapter.cancelTarget || !this.adapter.getContext)throw admissionError("targeted_cancel_unavailable",503);
    const native=await this.adapter.getContext(conversation);assertCurrent();
    if(operation.goalId&&native.goal?.id!==operation.goalId || operation.runId&&native.runId!==operation.runId)throw admissionError("cancel_target_conflict");
    this.database.recordGoalControl(conversationId,operation.issuedAtMs);
    const admission=()=>{assertCurrent();if(this.database.getGoalControlIssuedAt(conversationId)>operation.issuedAtMs)throw admissionError("cancel_superseded_conflict");};
    const target={...operation,...(!operation.runId&&native.runId?{runId:native.runId}:{})};
    await adapter.cancelTarget(conversation,target,admission);admission();
    for(const receipt of this.database.submissions.cancelTargeted(conversationId,profile.id,operation))this.publish(receipt);
    const result={cancelled:true,...(operation.goalId?{goalId:operation.goalId}:{}),...(target.runId?{runId:target.runId}:{})};
    try{this.controls.recordControl(operation.operationId,conversationId,request,result);}
    catch(error){const committed=this.controls.control(operation.operationId,conversationId,request) as typeof result|null;if(!committed)throw error;this.refreshProfile(profile.id);return {...committed,replayed:true};}
    this.refreshProfile(profile.id);this.wake();return {...result,replayed:false};
  }

  async cancel(profile: FamilyProfile, conversationId: string, runId?: string): Promise<boolean> {
    const conversation = this.ownedConversation(profile,conversationId);
    if (!conversation) return false;
    const active = this.database.submissions.listForConversation(conversationId);
    if (runId && !active.some(item => item.receipt.runId === runId)) throw new Error("run_not_found");
    if (!runId) for (const receipt of this.database.submissions.cancelQueued(conversationId,profile.id)) this.publish(receipt);
    const running = active.filter(item => item.receipt.status !== "queued" && (!runId || item.receipt.runId === runId));
    if (running.length) {
      // Omit runId for whole-conversation cancellation so native continuation/descendants stop too.
      await this.adapter.cancel(conversation,runId);
      for (const item of running) {
        let status: "complete" | "cancelled" = "cancelled";
        const currentTarget=()=>{
          const current=this.database.submissions.get(item.receipt.submissionId);
          if(!current||!["running","dispatching"].includes(current.receipt.status)&&!current.recoveryRequired)return undefined;
          if(current.receipt.runId!==item.receipt.runId&&(!current.receipt.goalId||current.receipt.goalId!==item.receipt.goalId))return undefined;
          return current;
        };
        if(!currentTarget())continue;
        try {
          const observed = await this.adapter.getRunState(conversation,item.receipt.runId ?? item.receipt.submissionId,item.receipt.goalId ?? undefined);
          const current=currentTarget();if(!current)continue;
          const sameObservedRun=!observed.runId||!current.receipt.runId||observed.runId===current.receipt.runId||Boolean(current.receipt.goalId&&observed.goalId===current.receipt.goalId);
          if (observed.status === "complete"&&!observed.continuationPending&&sameObservedRun&&this.adapter.getContext) {
            const native=await this.adapter.getContext(conversation);
            const latest=currentTarget();if(!latest)continue;
            if(!native.continuationPending){
              if(latest.receipt.goalId&&latest.receipt.goalId===native.goal?.id&&native.goal.status==="complete")status="complete";
              else if(!latest.receipt.goalId&&this.database.getSubmissionDomainBinding(latest.receipt.submissionId)?.goalBound!==true&&(!native.goal||native.goal.status==="complete"))status="complete";
            }
          }
        } catch { /* Definitive native cancellation already acknowledged; do not claim rollback. */ }
        // A later terminal/control decision or replacement run wins across both awaits.
        if(!currentTarget())continue;
        const receipt = this.database.submissions.reconcile(item.receipt.submissionId,status,item.receipt.runId);
        this.probeBackoff.delete(item.receipt.submissionId);
        if (receipt) this.publish(receipt);
      }
    }
    this.refreshProfile(profile.id); this.wake();
    return true;
  }

  findBySessionKey(sessionKey: string): Conversation | undefined { return this.database.findConversationBySessionKey(sessionKey); }
  onSubmissionEvent(listener: (receipt: SubmissionReceipt) => void): () => void {
    this.submissionListeners.add(listener); return () => this.submissionListeners.delete(listener);
  }
  onAgentEvent(listener: (event: HouseholdAgentEvent) => void): () => void {
    this.agentListeners.add(listener); return () => this.agentListeners.delete(listener);
  }
  private handleAgentEvent(event: HouseholdAgentEvent): void {
    if (this.closed) return;
    const conversation = this.database.findConversationBySessionKey(event.sessionKey);
    if (conversation && event.phase !== "changed") {
      const status = event.phase === "complete" ? "complete" : event.phase === "failed" ? "failed" : "cancelled";
      if(status !== "complete")for (const receipt of this.database.submissions.applyTerminal(conversation.id,event.runId,status)) this.publish(receipt);
      this.refreshProfile(conversation.ownerProfileId);
    }
    for (const listener of this.agentListeners) { try { listener(event); } catch {} }
    this.wake();
  }

  async diagnostics() {
    const adapter = await this.adapter.diagnostics();
    return { ...adapter,delivery:{
      enabled:this.options.dispatcherEnabled,started:this.started,lastCycleAt:this.lastCycleAt,
      lastError:this.lastCycleError,...this.database.submissions.counts(),
    } };
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.unsubscribeAdapter();
    if (this.maintenance) { try { await this.maintenance; } catch {} }
    await this.adapter.close();
    this.database.close();
  }
}
