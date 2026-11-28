import { projectNativeDiagnosticObservation } from "./platform/diagnostic-native.ts";
import type { NativeDiagnosticObservation } from "./platform/diagnostic-native.ts";
import { HOUSEHOLD_VERSION } from "./version.ts";
import { createHash } from "node:crypto";
import { GatewayClient, GatewayClientRequestError } from "@openclaw/gateway-client";
import { PROTOCOL_VERSION } from "@openclaw/gateway-protocol/version";
import type {
  ChatMessage, Conversation, FamilyProfile, HouseholdAgentAdapter,
  HouseholdAgentEvent, HouseholdAgentRunState, SubmissionReceipt,
} from "./domain.ts";
import { HouseholdDispatchError } from "./gateway-errors.ts";
import {
  contextFromRow, matchesNativeSession, record, stateFromRow, stateFromExactObservation,
} from "./native-session-state.ts";
import type { JsonRecord, NativeConversationContext, NativeGoalMutation } from "./native-session-state.ts";
import { restrictedPermission, validateRestrictedAttachments, validateRestrictedKey } from "./restricted-native-session.ts";
import type { RestrictedAttachment, RestrictedSession } from "./restricted-native-session.ts";
import { nativeProgressFromResult } from "./native-progress.ts";
import type { NativeProgress } from "./native-progress.ts";
import type { MessageTaskContext } from "./request-context.ts";
import type { NativeAnalysisChild, NativeAnalysisObservation } from "./analysis-flow/types.ts";
import { cancelNativeLineage } from "./native-cancel-lineage.ts";
import type { NativeCancellationLineage } from "./native-cancel-lineage.ts";

type NativeContext = { page: string; title?: string; selection?: string };
type ConnectionWaiter = { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
type ProbeResult = { status: "connected"; gatewayVersion?: string };

function textFromContent(content: unknown, role: ChatMessage["role"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    const block = record(part);
    if (role === "assistant" && block?.type !== undefined && block.type !== "text") return "";
    return typeof block?.text === "string" ? block.text : "";
  }).filter(Boolean).join("\n");
}

function normalizeHistory(conversationId: string, result: unknown): ChatMessage[] {
  const root = record(result);
  const values = Array.isArray(root?.messages) ? root.messages : [];
  return values.flatMap((value, index) => {
    const item = record(value);
    if (!item || !["user", "assistant", "system"].includes(String(item.role))) return [];
    const role = item.role as ChatMessage["role"];
    // A tool turn can carry preamble text alongside a call. The chat history
    // also contains the actual reply that follows the tool results.
    if (role === "assistant" && (item.stopReason === "toolUse" ||
      Array.isArray(item.content) && item.content.some(part => record(part)?.type === "toolCall"))) return [];
    const text = textFromContent(item.content ?? item.text ?? item.message, role).trim();
    if (!text) return [];
    const metadata = record(item.__openclaw);
    const rawTimestamp = item.createdAt ?? item.timestamp ?? item.ts;
    const createdAt = typeof rawTimestamp === "number" && Number.isFinite(rawTimestamp)
      ? new Date(rawTimestamp).toISOString() : typeof rawTimestamp === "string" ? rawTimestamp : new Date(0).toISOString();
    return [{
      id: typeof metadata?.id === "string" ? metadata.id :
        createHash("sha256").update(`${conversationId}\n${role}\n${createdAt}\n${text}\n${index}`).digest("hex").slice(0, 24),
      conversationId, role, text, createdAt,
    }];
  });
}

function validateNativeContext(context: NativeContext | undefined): void {
  if (!context) return;
  if (typeof context.page !== "string" || !context.page.trim() || context.page.length > 128 ||
    context.title !== undefined && (typeof context.title !== "string" || context.title.length > 200) ||
    context.selection !== undefined && (typeof context.selection !== "string" || context.selection.length > 12_000)) {
    throw new HouseholdDispatchError("native_context_invalid", "not_sent");
  }
}

function assertAdmission(check: (() => void) | undefined): void {
  try { check?.(); } catch (error) {
    if (error instanceof HouseholdDispatchError) throw error;
    throw new HouseholdDispatchError("admission_revoked", "not_sent");
  }
}

/** Native mutation envelopes report updated/started; their exact goal carries business status. */
function goalMutationResult(value: unknown, conversation: Conversation, operation: NativeGoalMutation, expectedSessionId?: string) {
  const unknown = (): never => { throw new HouseholdDispatchError("gateway_goal_outcome_unknown", "unknown"); };
  const result = record(value);
  if (!result || typeof result.status !== "string" || result.goalId !== operation.goalId ||
    result.operationId !== undefined && result.operationId !== operation.operationId ||
    result.action !== undefined && result.action !== operation.action ||
    result.agentId !== undefined && result.agentId !== conversation.agentId ||
    result.sessionKey !== undefined && !matchesNativeSession({ key: result.sessionKey, agentId: result.agentId }, conversation) ||
    result.sessionId !== undefined && (typeof result.sessionId !== "string" || !result.sessionId || expectedSessionId !== undefined && result.sessionId !== expectedSessionId) ||
    result.runId !== undefined && result.runId !== null && (typeof result.runId !== "string" || !result.runId) ||
    result.replayed !== undefined && typeof result.replayed !== "boolean") return unknown();
  const states = new Set(["active", "paused", "blocked", "usage_limited", "budget_limited", "complete"]);
  const envelope = result.status;
  let status: string;
  if (Object.hasOwn(result, "goal")) {
    const goal = record(result.goal);
    if (operation.action === "clear" || !goal || goal.id !== operation.goalId || typeof goal.status !== "string" || !states.has(goal.status) ||
      !["updated", "started", goal.status].includes(String(envelope))) return unknown();
    if (["updated", "started"].includes(String(envelope)) &&
      (result.operationId !== operation.operationId || result.action !== operation.action || typeof result.sessionId !== "string" || !result.sessionId)) return unknown();
    status = goal.status;
  } else {
    // Retain truthful legacy status responses; an envelope alone never proves the requested transition.
    if (typeof envelope !== "string" || (operation.action === "clear" ? envelope !== "cleared" : !states.has(envelope))) return unknown();
    status = envelope;
  }
  return { goalId: operation.goalId, runId: typeof result.runId === "string" ? result.runId : null,
    status, replayed: result.replayed === true };
}

export class OpenClawAgentAdapter implements HouseholdAgentAdapter {
  readonly mode = "openclaw" as const;
  private readonly client: GatewayClient;
  private readonly listeners = new Set<(event: HouseholdAgentEvent) => void>();
  private readonly conversations = new Map<string, Conversation>();
  private readonly waiters = new Set<ConnectionWaiter>();
  private readonly connectTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly restrictedRuntimeCheck?: (agentId: string) => Promise<void>;
  private readonly requireHouseholdBoundary: boolean;
  private readonly restrictedSessionCheck?: (sessionKey:string,agentId:string) => Promise<void>;
  private ready = false;
  private started = false;
  private closed = false;
  private lastError: string | undefined;
  private connectionGeneration = 0;
  private probedGeneration = -1;
  private lastProbeSuccessAt = 0;
  private probeFailures = 0;
  private probeTimer: ReturnType<typeof setTimeout> | undefined;
  private probeInFlight: { generation: number; promise: Promise<ProbeResult> } | undefined;
  private readonly probeRefreshMs = 30_000;

  constructor(options: {
    url: string; token: string; connectTimeoutMs?: number; requestTimeoutMs?: number;
    restrictedRuntimeCheck?: (agentId: string) => Promise<void>;
    requireHouseholdBoundary?: boolean;
    restrictedSessionCheck?: (sessionKey:string,agentId:string) => Promise<void>;
  }) {
    this.connectTimeoutMs = Math.max(1_000, Math.min(options.connectTimeoutMs ?? 15_000, 60_000));
    this.requestTimeoutMs = Math.max(1_000, Math.min(options.requestTimeoutMs ?? 15_000, 60_000));
    this.restrictedRuntimeCheck = options.restrictedRuntimeCheck;
    this.requireHouseholdBoundary = options.requireHouseholdBoundary === true;
    this.restrictedSessionCheck = options.restrictedSessionCheck;
    this.client = new GatewayClient({
      url: options.url, token: options.token, minProtocol: PROTOCOL_VERSION, maxProtocol: PROTOCOL_VERSION,
      clientName: "gateway-client", clientDisplayName: "Hardy Home control service", clientVersion: "0.3.0",
      platform: process.platform, mode: "backend", role: "operator", scopes: ["operator.read", "operator.write"],
      onHelloOk: () => {
        this.ready = true;
        this.connectionGeneration += 1;
        this.resetProbe();
        this.lastError = "gateway_probe_pending";
        this.settleWaiters();
        this.scheduleProbe(0);
      },
      onConnectError: () => {
        this.lastError = "gateway_unavailable";
        if (!this.ready) this.settleWaiters(new HouseholdDispatchError("gateway_unavailable", "not_sent", true));
      },
      onClose: () => {
        this.ready = false;
        this.connectionGeneration += 1;
        this.resetProbe();
        this.lastError = this.closed ? "gateway_closed" : "gateway_reconnecting";
        this.settleWaiters(new HouseholdDispatchError(this.lastError, "not_sent", !this.closed));
      },
      onEvent: (event) => this.handleEvent(event.event, event.payload),
    });
  }

  private resetProbe(): void {
    if (this.probeTimer) clearTimeout(this.probeTimer);
    this.probeTimer = undefined;
    this.probeInFlight = undefined;
    this.probedGeneration = -1;
    this.lastProbeSuccessAt = 0;
    this.probeFailures = 0;
  }

  private scheduleProbe(delayMs: number): void {
    if (this.closed || !this.ready) return;
    if (this.probeTimer) clearTimeout(this.probeTimer);
    this.probeTimer = setTimeout(() => {
      this.probeTimer = undefined;
      void this.probe().catch(() => { /* Readiness failures are projected by diagnostics. */ });
    }, delayMs);
    this.probeTimer.unref?.();
  }

  private async executeProbe(generation: number): Promise<ProbeResult> {
    try {
      if (this.closed || !this.ready || generation !== this.connectionGeneration) throw new Error("gateway_probe_stale");
      const result = record(await this.client.request("status", {}, { timeoutMs: this.requestTimeoutMs }));
      if (this.closed || !this.ready || generation !== this.connectionGeneration) throw new Error("gateway_probe_stale");
      if (!result) throw new Error("gateway_probe_invalid");
      if(this.requireHouseholdBoundary)await this.assertHouseholdBoundary();
      this.probedGeneration = generation;
      this.lastProbeSuccessAt = Date.now();
      this.probeFailures = 0;
      this.lastError = undefined;
      const version = typeof result.version === "string" ? result.version : record(result.server)?.version;
      return { status: "connected", ...(typeof version === "string" ? { gatewayVersion: version } : {}) };
    } catch {
      if (!this.closed && this.ready && generation === this.connectionGeneration) {
        this.probedGeneration = -1;
        this.lastError = "gateway_probe_failed";
        this.probeFailures = Math.min(this.probeFailures + 1, 6);
      }
      throw new HouseholdDispatchError("gateway_probe_failed", "not_sent", !this.closed);
    }
  }

  private settleWaiters(error?: Error): void {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      if (error) waiter.reject(error); else waiter.resolve();
    }
    this.waiters.clear();
  }

  private async connected(): Promise<void> {
    if (this.closed) throw new HouseholdDispatchError("gateway_closed", "not_sent");
    if (!this.started) {
      this.started = true;
      try { this.client.start(); } catch {
        this.started = false;
        this.lastError = "gateway_unavailable";
        throw new HouseholdDispatchError("gateway_unavailable", "not_sent", true);
      }
    }
    if (this.ready) return;
    await new Promise<void>((resolve, reject) => {
      const waiter: ConnectionWaiter = {
        resolve, reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          this.lastError = "gateway_connect_timeout";
          reject(new HouseholdDispatchError("gateway_connect_timeout", "not_sent", true));
        }, this.connectTimeoutMs),
      };
      waiter.timer.unref?.();
      this.waiters.add(waiter);
    });
  }

  private track(conversation: Conversation): void {
    this.conversations.set(conversation.sessionKey, conversation);
    this.conversations.set(`agent:${conversation.agentId}:${conversation.sessionKey}`, conversation);
  }

  private emit(event: HouseholdAgentEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* A subscriber cannot crash Gateway delivery. */ }
    }
  }

  private handleEvent(name: string, payload: unknown): void {
    if (name !== "chat") return;
    const data = record(payload);
    if (!data || typeof data.sessionKey !== "string") return;
    const conversation = this.conversations.get(data.sessionKey);
    if (!conversation || data.agentId !== undefined && data.agentId !== conversation.agentId) return;
    const runId = typeof data.runId === "string" ? data.runId : null;
    this.emit({ sessionKey: data.sessionKey, runId, phase: "changed" });
    if (!["final", "error", "aborted"].includes(String(data.state))) return;
    // A chat final is a turn hint, not evidence that a yielded parent task ended.
    void this.getRunState(conversation, runId ?? undefined).then((state) => {
      if (state.status === "complete" || state.status === "failed" || state.status === "cancelled") {
        this.emit({ sessionKey: conversation.sessionKey, runId: state.runId, phase: state.status });
      }
    }).catch(() => { /* Periodic durable reconciliation retries observation. */ });
  }

  private async describe(conversation: Pick<Conversation, "agentId" | "sessionKey">): Promise<JsonRecord> {
    await this.connected();
    const result = record(await this.client.request("sessions.describe", {
      key: conversation.sessionKey, agentId: conversation.agentId,
      includeDerivedTitles: false, includeLastMessage: false,
    }, { timeoutMs: this.requestTimeoutMs }));
    const row = record(result?.session);
    if (!row || !matchesNativeSession(row, conversation)) throw new Error("native_session_not_found");
    return row;
  }

  private async assertHouseholdBoundary():Promise<void>{
    if(!this.requireHouseholdBoundary)return;
    let status:JsonRecord|undefined;
    try{status=record(await this.client.request("hardy_household.status",{},{timeoutMs:this.requestTimeoutMs}));}
    catch{throw new HouseholdDispatchError("household_boundary_unavailable","not_sent",true);}
    if(status?.initialized!==true || status.taskBoundaryRegistered!==true || status.version!==HOUSEHOLD_VERSION)
      throw new HouseholdDispatchError("household_boundary_unavailable","not_sent",true);
  }

  async ensureConversation(conversation: Conversation): Promise<void> {
    await this.connected();
    await this.client.request("sessions.create", {
      key: conversation.sessionKey, agentId: conversation.agentId,
      displayName: conversation.title, titleSource: conversation.title,
    }, { timeoutMs: this.requestTimeoutMs });
    this.track(conversation);
  }

  async listMessages(conversation: Conversation): Promise<ChatMessage[]> {
    this.track(conversation);
    await this.connected();
    const pages:ChatMessage[][]=[],seen=new Set<number>();let offset:number|undefined,sessionId:string|undefined;
    while(true){
      const result=await this.client.request("chat.history",{
        sessionKey:conversation.sessionKey,agentId:conversation.agentId,limit:200,maxChars:500_000,
        ...(offset!==undefined?{offset}:{}),...(sessionId?{sessionId}:{})
      },{timeoutMs:this.requestTimeoutMs});
      const page=record(result);pages.unshift(normalizeHistory(conversation.id,result));
      if(!page?.hasMore)break;
      const next=page.nextOffset;
      if(!Number.isSafeInteger(next)||Number(next)<0||seen.has(Number(next)))throw new HouseholdDispatchError("history_pagination_invalid","not_sent");
      seen.add(Number(next));offset=Number(next);if(typeof page.sessionId==='string')sessionId=page.sessionId;
    }
    return pages.flat();
  }

  async submitMessage(args: {
    conversation: Conversation; profile: FamilyProfile; text: string; submissionId: string;
    shouldQueue: boolean; queuePosition: number | null;
    nativeContext?: NativeContext; goalStart?: { issuedAtMs: number }; taskContext?: MessageTaskContext; assertAdmission?: () => void;
  }): Promise<SubmissionReceipt> {
    const base = { submissionId: args.submissionId, conversationId: args.conversation.id,
      profileId: args.profile.id, agentId: args.conversation.agentId, queuePosition: null, runId: null };
    if (args.shouldQueue) return { ...base, status: "queued", queuePosition: args.queuePosition };
    validateNativeContext(args.nativeContext);
    if (args.goalStart && (!Number.isSafeInteger(args.goalStart.issuedAtMs) || args.goalStart.issuedAtMs < 0 ||
      !args.text.trim())) throw new HouseholdDispatchError("goal_start_invalid", "not_sent");
    this.track(args.conversation);
    await this.connected();
    await this.assertHouseholdBoundary();
    assertAdmission(args.assertAdmission);
    if(args.taskContext?.replyToQuestionId){
      const expected=args.taskContext;
      if(args.goalStart || !expected.expectedSessionId || expected.expectedGoalId===undefined)throw new HouseholdDispatchError("question_binding_conflict","not_sent");
      const native=await this.getContext(args.conversation);
      const goal=native.goal?.status==="complete"?null:native.goal;
      if(native.sessionId!==expected.expectedSessionId || (goal?.id??null)!==expected.expectedGoalId || goal&&goal.status!=="active")
        throw new HouseholdDispatchError("question_binding_conflict","not_sent");
      assertAdmission(args.assertAdmission);
    }
    let wireGoalStartAt:number|undefined;
    let goalStartSessionId:string|undefined;
    if(args.goalStart){
      const persisted=args.taskContext?.goalStartDispatchAtMs;
      if(this.requireHouseholdBoundary && (!Number.isSafeInteger(persisted)||Number(persisted)<1))throw new HouseholdDispatchError("goal_start_dispatch_time_invalid","not_sent");
      const dispatchAt=Number.isSafeInteger(persisted)?Number(persisted):Date.now();
      let native:NativeConversationContext;
      try{native=await this.getContext(args.conversation);}catch{throw new HouseholdDispatchError("goal_start_preflight_unavailable","not_sent",true);}
      assertAdmission(args.assertAdmission);
      if(!native.sessionId)throw new HouseholdDispatchError("goal_start_session_unavailable","not_sent",true);
      goalStartSessionId=native.sessionId;
      if(native.goal && native.goal.status!=="complete")throw new HouseholdDispatchError("new_task_requires_new_conversation","not_sent");
      if(native.goal){
        if(native.continuationPending)throw new HouseholdDispatchError("new_task_requires_new_conversation","not_sent");
        const clearId="start-clear:"+createHash("sha256").update(args.submissionId+"\n"+native.goal.id).digest("hex");
        try{
          await this.mutateGoal(args.conversation,{goalId:native.goal.id,operationId:clearId,issuedAtMs:dispatchAt,action:"clear"},args.assertAdmission,native.sessionId);
          const after=await this.getContext(args.conversation);
          if(after.goal || after.sessionId!==goalStartSessionId)throw new Error("goal_start_preflight_conflict");
        }catch{throw new HouseholdDispatchError("goal_start_preflight_unavailable","not_sent",true);}
        assertAdmission(args.assertAdmission);
      }
      wireGoalStartAt=dispatchAt+1;
    }
    let result: JsonRecord;
    try {
      result = await this.client.request<JsonRecord>("chat.send", {
        sessionKey: args.conversation.sessionKey, agentId: args.conversation.agentId,
        message: args.text, idempotencyKey: args.submissionId, deliver: false,
        ...(args.taskContext?.expectedSessionId || goalStartSessionId ? {sessionId:args.taskContext?.expectedSessionId??goalStartSessionId}:{}),
        ...(args.nativeContext && wireGoalStartAt === undefined ? { workContext: args.nativeContext } : {}),
        ...(wireGoalStartAt!==undefined ? { intent: { kind: "session-goal-start", version: 1, issuedAtMs: wireGoalStartAt } } : {}),
      }, { timeoutMs: 45_000 });
    } catch (error) {
      // The pinned gateway returns these exact guards before admitting work.
      // Other INVALID_REQUEST branches and transport failures remain uncertain.
      if (error instanceof GatewayClientRequestError && error.gatewayCode === "INVALID_REQUEST") {
        if (error.message === "Working context is only supported for ordinary chat messages.")
          throw new HouseholdDispatchError("gateway_request_rejected", "not_sent", false);
        const sessionKey = args.conversation.sessionKey.startsWith("agent:")
          ? args.conversation.sessionKey
          : `agent:${args.conversation.agentId}:${args.conversation.sessionKey}`;
        if (error.message === `Session "${sessionKey}" is archived. Restore it before starting new work.`)
          throw new HouseholdDispatchError("conversation_archived", "not_sent", false);
      }
      throw new HouseholdDispatchError("gateway_send_unknown", "unknown");
    }
    return { ...base, status: "running", runId: typeof result.runId === "string" ? result.runId : args.submissionId,
      ...(typeof result.goalId === "string" ? { goalId: result.goalId } : {}) };
  }

  async getContext(conversation: Conversation): Promise<NativeConversationContext> {
    this.track(conversation);
    return contextFromRow(await this.describe(conversation), conversation);
  }

  /** Trusted read-only evidence port. Transcript content is projected inside the adapter. */
  async readDiagnosticObservation(conversation: Conversation, runId: string | null, assertCurrent: () => void): Promise<NativeDiagnosticObservation> {
    assertCurrent();
    const row = await this.describe(conversation);
    assertCurrent();
    let history: unknown = undefined;
    if (runId) {
      try {
        history = await this.client.request("chat.history", {
          sessionKey: conversation.sessionKey, agentId: conversation.agentId, limit: 100, maxChars: 500_000,
        }, { timeoutMs: this.requestTimeoutMs });
      } catch { /* Session metadata remains useful; missing metrics are explicitly unavailable. */ }
    }
    if (runId) {
      try {
        const terminal = await this.client.request("agent.wait", { runId, timeoutMs: 0 }, { timeoutMs: this.requestTimeoutMs });
        history = { ...record(history), runObservation: terminal };
      } catch { /* Historical terminal observation may no longer be retained. */ }
    }
    assertCurrent();
    return projectNativeDiagnosticObservation(row, history, runId);
  }

  /** Trusted composition port; domain tools never receive this raw method or choose its method name. */
  async requestDomainCapability(method: "wiki.status" | "wiki.search" | "wiki.get" | "wiki.apply" | "wiki.compile" | "cron.list" | "cron.get" | "cron.add" | "cron.update" | "cron.remove",
    params: Record<string,unknown>, assertCurrent: () => void): Promise<unknown> {
    if (!["wiki.status","wiki.search","wiki.get","wiki.apply","wiki.compile","cron.list","cron.get","cron.add","cron.update","cron.remove"].includes(method))
      throw new HouseholdDispatchError("native_domain_method_not_allowed","not_sent");
    await this.connected();
    assertCurrent();
    try { return await this.client.request(method,params,{timeoutMs:this.requestTimeoutMs}); }
    catch { throw new HouseholdDispatchError("native_domain_outcome_unknown",["wiki.status","wiki.search","wiki.get","cron.list","cron.get"].includes(method) ? "not_sent" : "unknown"); }
  }

  async putProgress(conversation:Conversation,plan:readonly {step:string;status:"pending"|"in_progress"|"completed"}[],admission:()=>void):Promise<NativeProgress|null>{
    this.track(conversation);await this.connected();admission();
    const result=await this.client.request("progressCard.put",{sessionKey:conversation.sessionKey,agentId:conversation.agentId,plan},{timeoutMs:this.requestTimeoutMs});
    admission();return nativeProgressFromResult(result,conversation);
  }
  async getProgress(conversation: Conversation): Promise<NativeProgress | null> {
    this.track(conversation);
    await this.connected();
    const result = await this.client.request("progressCard.get", { sessionKey: conversation.sessionKey, agentId: conversation.agentId }, { timeoutMs: this.requestTimeoutMs });
    return nativeProgressFromResult(result, conversation);
  }

  async getExactRunState(conversation:Conversation,expectedRunId:string):Promise<HouseholdAgentRunState>{
    if(!expectedRunId||expectedRunId.length>200||/[\x00-\x1f\x7f]/.test(expectedRunId))throw new Error("native_run_identity_invalid");
    this.track(conversation);await this.connected();
    try{
      const observation=await this.client.request("agent.wait",{runId:expectedRunId,timeoutMs:0},{timeoutMs:this.requestTimeoutMs});
      const echoed=record(observation)?.runId;
      return {status:echoed!==undefined&&echoed!==expectedRunId?"unknown":stateFromExactObservation(observation),runId:expectedRunId,updatedAt:null};
    }catch{return {status:"unknown",runId:expectedRunId,updatedAt:null};}
  }

  async getRunState(conversation: Conversation, expectedRunId?: string, expectedGoalId?: string): Promise<HouseholdAgentRunState> {
    this.track(conversation);
    const row = await this.describe(conversation);
    const projected = stateFromRow(row, expectedRunId, expectedGoalId);
    if (projected.status !== "unknown" || !expectedRunId) return projected;
    // Exact-run observation can settle an older submission; session recency cannot.
    try {
      const observation = await this.client.request("agent.wait", { runId: expectedRunId, timeoutMs: 0 }, { timeoutMs: this.requestTimeoutMs });
      const status = stateFromExactObservation(observation);
      if (status !== "unknown") return { ...projected,
        status: status === "complete" && projected.continuationPending ? "running" : status, runId: expectedRunId,
        ...(record(observation)?.yielded === true ? { continuationPending: true } : {}) };
    } catch { /* An absent/expired observation must remain unknown. */ }
    return projected;
  }

  async mutateGoal(conversation: Conversation, operation: NativeGoalMutation, admission?: () => void, expectedSessionId?:string): Promise<{ goalId: string; runId: string | null; status: string; replayed: boolean }> {
    if (!operation.goalId || !operation.operationId || operation.operationId.length > 128 ||
      !Number.isSafeInteger(operation.issuedAtMs) || operation.issuedAtMs < 0 ||
      !["edit", "pause", "resume", "block", "complete", "clear"].includes(operation.action) ||
      operation.action === "edit" && (typeof operation.objective !== "string" || !operation.objective.trim()) ||
      operation.note !== undefined && (typeof operation.note !== "string" || operation.note.length > 2_000)) throw new Error("goal_operation_invalid");
    this.track(conversation);
    await this.connected();
    assertAdmission(admission);
    if(operation.action==="resume"){await this.assertHouseholdBoundary();assertAdmission(admission);}
    const identity = { sessionKey: conversation.sessionKey, agentId: conversation.agentId,
      goalId: operation.goalId, operationId: operation.operationId, issuedAtMs: operation.issuedAtMs,
      ...(expectedSessionId?{sessionId:expectedSessionId}:{}) };
    const result = await this.client.request<JsonRecord>(operation.action === "clear" ? "sessions.goal.clear" : "sessions.goal.update", {
      ...identity,
      ...(operation.action === "clear" ? {} : operation.action === "edit" ?
        { action: "edit", objective: operation.objective } : { action: operation.action, ...(operation.note ? { note: operation.note } : {}) }),
    }, { timeoutMs: this.requestTimeoutMs });
    return goalMutationResult(result, conversation, operation, expectedSessionId);
  }

  /** Native ownership/terminal observation only; the caller supplies a fresh root-grant fence. */
  async observeAnalysisChild(args:NativeAnalysisObservation):Promise<NativeAnalysisChild>{
    const agentId=args.expectedAgentId??"household-analysis";
    if(!["household-analysis",args.parentSessionKey?.split(":")[1]].includes(agentId))throw new HouseholdDispatchError("analysis_child_binding_invalid","not_sent");
    if(!args.childSessionKey || args.childSessionKey.length>512 || !args.runId || args.runId.length>200 || !args.parentSessionKey || !args.rootTaskId || !args.expectedSessionId ||
      args.childSessionKey===args.parentSessionKey || !this.restrictedRuntimeCheck || !this.restrictedSessionCheck)throw new HouseholdDispatchError("analysis_child_binding_invalid","not_sent");
    args.assertCurrent();await this.restrictedRuntimeCheck(agentId);args.assertCurrent();
    await this.restrictedSessionCheck(args.childSessionKey,agentId);args.assertCurrent();
    const child={agentId,sessionKey:args.childSessionKey};
    const binding=(row:JsonRecord)=>{
      // The native child projection may omit lastRunId. Callers supply a
      // trusted native admission grant binding this run to the exact session ID.
      if(row.agentId!==agentId || row.parentSessionKey!==args.parentSessionKey ||
        row.sessionId!==args.expectedSessionId || row.lastRunId!=null&&row.lastRunId!==args.runId ||
        Array.isArray(row.activeRunIds)&&row.activeRunIds.some(id=>id!==args.runId))
        throw new HouseholdDispatchError("analysis_child_binding_invalid","not_sent");
    };
    const row=await this.describe(child);binding(row);args.assertCurrent();
    const observation=await this.client.request("agent.wait",{runId:args.runId,timeoutMs:0},{timeoutMs:this.requestTimeoutMs});
    args.assertCurrent();
    const latest=await this.describe(child);binding(latest);
    if(latest.sessionId!==row.sessionId)throw new HouseholdDispatchError("analysis_child_binding_invalid","not_sent");
    await this.restrictedRuntimeCheck(agentId);
    await this.restrictedSessionCheck(args.childSessionKey,agentId);args.assertCurrent();
    const exact=stateFromExactObservation(observation),details=record(observation);
    if(details?.runId!==args.runId)throw new HouseholdDispatchError("analysis_child_binding_invalid","not_sent");
    let state:NativeAnalysisChild["state"];
    if(exact==="complete"||exact==="failed"||exact==="cancelled")state=exact;
    else if(latest.subagentRunState==="paused" || details?.yielded===true&&details.livenessState==="paused")state="paused";
    else if(latest.hasActiveRun===true || latest.status==="running" || latest.status==="queued" || exact==="queued" || exact==="running")state="running";
    else throw new HouseholdDispatchError("analysis_child_outcome_unavailable","not_sent");
    return {childSessionKey:args.childSessionKey,runId:args.runId,agentId,parentSessionKey:args.parentSessionKey,rootTaskId:args.rootTaskId,sandboxed:true,state};
  }

  async cancelTarget(conversation:Conversation,operation:{operationId:string;issuedAtMs:number;goalId?:string;runId?:string},admission:()=>void,lineage?:NativeCancellationLineage):Promise<void>{
    const current=await this.getContext(conversation);assertAdmission(admission);
    if(lineage){
      if(operation.goalId||operation.runId!==lineage.rootRunId||current.sessionId!==lineage.rootSessionId)throw new HouseholdDispatchError("cancel_target_conflict","not_sent");
      try{await cancelNativeLineage(conversation,lineage,{describe:target=>this.describe(target),assertCurrent:()=>assertAdmission(admission),
        abort:async(target,runId)=>{const result=record(await this.client.request("sessions.abort",{key:target.sessionKey,agentId:target.agentId,runId},{timeoutMs:this.requestTimeoutMs}));
          if(result?.ok!==true||!["aborted","no-active-run"].includes(String(result.status)))throw new HouseholdDispatchError("gateway_cancel_unknown","unknown");}});}
      catch(error){throw new HouseholdDispatchError((error as any)?.code==="cancel_target_conflict"?"cancel_target_conflict":"gateway_cancel_unconfirmed",(error as any)?.outcome==="unknown"?"unknown":"not_sent");}
      return;
    }
    if(operation.goalId&&current.goal?.id!==operation.goalId || operation.runId&&current.runId!==operation.runId)
      throw new HouseholdDispatchError("cancel_target_conflict","not_sent");
    if(operation.goalId){
      // sessions.goal.update has a native goal-ID/time/idempotency fence. sessions.abort does not.
      await this.mutateGoal(conversation,{goalId:operation.goalId,operationId:"cancel-pause:"+createHash("sha256").update(operation.operationId).digest("hex"),
        issuedAtMs:operation.issuedAtMs,action:"pause",note:"Stopped by the household user"},admission);
    }
    assertAdmission(admission);
    if(operation.runId)await this.cancel(conversation,operation.runId);
    // Never send an unqualified abort after a delay, even if a different run is now active.
  }

  async cancel(conversation: Conversation, runId?: string): Promise<void> {
    await this.connected();
    let result: JsonRecord | undefined;
    try {
      result = record(await this.client.request("sessions.abort", {
        key: conversation.sessionKey, agentId: conversation.agentId,
        ...(runId ? { runId } : { clearQueued: true }),
      }, { timeoutMs: this.requestTimeoutMs }));
    } catch { throw new HouseholdDispatchError("gateway_cancel_unknown", "unknown"); }
    if (result?.ok !== true || !["aborted", "no-active-run"].includes(String(result.status))) {
      throw new HouseholdDispatchError("gateway_cancel_unknown", "unknown");
    }
    let row: JsonRecord;
    try { row = await this.describe(conversation); } catch {
      throw new HouseholdDispatchError("gateway_cancel_unconfirmed", "unknown");
    }
    const current = contextFromRow(row, conversation);
    if (current.continuationPending || row.hasActiveRun === true || row.status === "running" || row.status === "queued") {
      throw new HouseholdDispatchError("gateway_cancel_unconfirmed", "unknown");
    }
  }

  private async restrictedReady(session: Pick<RestrictedSession, "sessionKey" | "agentId">): Promise<RestrictedSession["permissionMode"]> {
    const permission = restrictedPermission(session.agentId);
    validateRestrictedKey(session.sessionKey, session.agentId);
    if (!this.restrictedRuntimeCheck) throw new Error("restricted_runtime_unavailable");
    await this.restrictedRuntimeCheck(session.agentId);
    return permission;
  }

  async createRestrictedSession(session: RestrictedSession): Promise<{ sessionKey: string; sessionId: string | null }> {
    const permission = await this.restrictedReady(session);
    if (permission !== session.permissionMode) throw new Error("restricted_permission_invalid");
    await this.connected();
    await this.client.request("sessions.create", { key: session.sessionKey, agentId: session.agentId,
      permissionMode: permission, visibility: "draft", toolOverrides: { webSearch: false },
      displayName: permission === "read-only" ? "Household diagnostic task" : "Household analysis task",
    }, { timeoutMs: this.requestTimeoutMs });
    const row = await this.describe(session);
    if (row.permissionMode !== permission) throw new Error("restricted_runtime_unavailable");
    return { sessionKey: row.key as string, sessionId: typeof row.sessionId === "string" ? row.sessionId : null };
  }

  async submitRestricted(args: { sessionKey: string; agentId: string; message: string; submissionId: string; attachments?: RestrictedAttachment[]; assertAdmission?: () => void }): Promise<{ sessionKey: string; runId: string | null; status: "running" | "queued" }> {
    const permission = await this.restrictedReady(args);
    validateRestrictedAttachments(args.attachments, args.agentId);
    if (!args.message.trim() || args.message.length > 32_000 || !args.submissionId || args.submissionId.length > 128) throw new Error("restricted_request_invalid");
    const row = await this.describe(args);
    if (row.permissionMode !== permission) throw new Error("restricted_runtime_unavailable");
    assertAdmission(args.assertAdmission);
    let result: JsonRecord;
    try {
      result = await this.client.request<JsonRecord>("chat.send", {
        sessionKey: args.sessionKey, agentId: args.agentId, message: args.message, idempotencyKey: args.submissionId,
        deliver: false, suppressCommandInterpretation: true, expectedPermissionMode: permission,
        ...(args.attachments?.length ? { attachments: args.attachments } : {}),
      }, { timeoutMs: 45_000 });
    } catch { throw new HouseholdDispatchError("gateway_send_unknown", "unknown"); }
    return { sessionKey: row.key as string, runId: typeof result.runId === "string" ? result.runId : args.submissionId,
      status: result.status === "queued" ? "queued" : "running" };
  }

  onEvent(listener: (event: HouseholdAgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async diagnostics(): Promise<{ status: string; detail?: string }> {
    if (this.closed) return { status: "closed" };
    if (!this.started) return { status: "not-started" };
    if (this.ready) {
      const fresh = this.probedGeneration === this.connectionGeneration &&
        Date.now() - this.lastProbeSuccessAt <= this.probeRefreshMs + this.requestTimeoutMs;
      if (fresh) return { status: "connected" };
      return { status: "probing", detail: this.lastError ?? "gateway_probe_stale" };
    }
    return { status: "reconnecting", ...(this.lastError ? { detail: this.lastError } : {}) };
  }

  async probe(): Promise<ProbeResult> {
    await this.connected();
    const generation = this.connectionGeneration;
    if (this.probeInFlight?.generation === generation) return this.probeInFlight.promise;
    if (this.probeTimer) clearTimeout(this.probeTimer);
    this.probeTimer = undefined;
    const pending = Promise.resolve().then(() => this.executeProbe(generation));
    this.probeInFlight = { generation, promise: pending };
    const finished = () => {
      if (this.probeInFlight?.promise !== pending) return;
      this.probeInFlight = undefined;
      if (!this.closed && this.ready && generation === this.connectionGeneration) {
        const delay = this.probedGeneration === generation ? this.probeRefreshMs :
          Math.min(30_000, 1_000 * 2 ** Math.max(0, this.probeFailures - 1));
        this.scheduleProbe(delay);
      }
    };
    // Attach both handlers immediately; timer-triggered/replaced probes never leak rejections.
    void pending.then(finished, finished);
    return pending;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    this.connectionGeneration += 1;
    this.resetProbe();
    this.settleWaiters(new HouseholdDispatchError("gateway_closed", "not_sent"));
    if (this.started) await this.client.stopAndWait();
    this.listeners.clear();
    this.conversations.clear();
  }
}
