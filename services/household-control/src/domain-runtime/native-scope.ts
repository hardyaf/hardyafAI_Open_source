import { createHash } from "node:crypto";
import { independentTopicTaskId } from "./topic-scope.ts";
import type { HouseholdDatabase } from "../database.ts";
import type { Conversation } from "../domain.ts";
import { ExecutionAuthorityRepository } from "../request-context.ts";
import type { ExecutionGrant, MessageTaskContext } from "../request-context.ts";
import { DomainError, fingerprint } from "./common.ts";
import type { DomainPrincipal } from "./common.ts";

export type NativeToolContext = {
  agentId?:string;sessionKey?:string;sessionId?:string;runId?:string;
  nativeRunId?:string|null;nativeGoalId?:string|null;nativeGoalStatus?:string|null;nativeSessionId?:string|null;
  assertInvocationCurrent?:()=>void;workspaceDir?:string;sandboxed?:boolean;completionRecovery?:boolean;
};
export type ProfileDomainGrant = {
  enabled:boolean;domains:string[];scopes:Array<"personal"|"household">;contactEditing:boolean;
  projectCodes:string[];canManageProjects:boolean;canReviewReceipts:boolean;allowedAttendees:string[];sharedDomains:string[];
};
export type AuthorizedScope={principal:DomainPrincipal;grant:ProfileDomainGrant;conversation:Conversation;sourceHash:string;packet:MessageTaskContext|null;mode:"normal"|"brain_dump"|"diagnostic";rootSessionId:string|null;rootGoalId:string|null};
export function normalizedSessionKey(agentId:string,key:string){return key.startsWith(`agent:${agentId}:hardy-home:`)?key.slice(`agent:${agentId}:`.length):key;}

/** Admission and native lineage are independent of model-selected tools or identities. */
export class NativeDomainAuthorization {
  private readonly authority:ExecutionAuthorityRepository;
  private readonly database:HouseholdDatabase;
  private readonly grants:Record<string,ProfileDomainGrant>;
  private readonly externalCurrent?: (packet:MessageTaskContext,profileId:string)=>boolean;
  constructor(database:HouseholdDatabase,grants:Record<string,ProfileDomainGrant>,externalCurrent?:(packet:MessageTaskContext,profileId:string)=>boolean){this.database=database;this.grants=grants;this.externalCurrent=externalCurrent;this.authority=new ExecutionAuthorityRepository(database.domainConnection());}
  root(context:NativeToolContext):Conversation|undefined {
    if(!context.agentId||!context.sessionKey)return;
    const projection=this.authority.get(normalizedSessionKey(context.agentId,context.sessionKey));
    const source=projection&&this.database.submissions.get(projection.sourceId);
    const conversation=source?this.database.getConversation(source.receipt.conversationId):this.database.findConversationBySessionKey(context.sessionKey);
    return conversation?.deletedAt?undefined:conversation;
  }
  /** Content-free discovery precedes admitted execution in the stock V2 factory. */
  catalogGrant(context:NativeToolContext):ProfileDomainGrant|null {
    if(!context.agentId||!context.sessionKey)return null;
    const key=normalizedSessionKey(context.agentId,context.sessionKey),projection=this.authority.get(key);
    const source=projection&&this.database.submissions.get(projection.sourceId);
    if(projection&&!source)return null;
    const conversation=this.root(context);
    if(!conversation)return null;
    if(projection?.sessionId&&context.sessionId&&projection.sessionId!==context.sessionId)return null;
    if(projection?.parentSessionKey){
      if(projection.agentId!==context.agentId||projection.rootSessionKey!==conversation.sessionKey)return null;
    }else if(context.agentId!==conversation.agentId||key!==conversation.sessionKey)return null;
    const profile=this.database.getProfile(source?.receipt.profileId??conversation.ownerProfileId),grant=profile&&this.grants[profile.id];
    if(!profile||profile.role==="child"||!profile.capabilities.includes("chat")||["paused","offline"].includes(profile.status)||!grant?.enabled)return null;
    const shared=conversation.audience==="household"&&source?.taskContext?.origin?.shared===true;
    if(!shared&&(conversation.ownerProfileId!==profile.id||conversation.agentId!==profile.agentId))return null;
    if(conversation.audience==="household")return grant.scopes.includes("household")?{...grant,domains:grant.domains.filter(domain=>grant.sharedDomains.includes(domain))}:null;
    return grant.scopes.includes("personal")?grant:null;
  }
  resolve(context:NativeToolContext,signal?:AbortSignal):AuthorizedScope {
    if(!context.agentId||!context.sessionKey||!context.sessionId||!context.runId||typeof context.assertInvocationCurrent!=="function")throw new DomainError("trusted_native_context_required",{httpStatus:403});
    context.assertInvocationCurrent();
    const key=normalizedSessionKey(context.agentId,context.sessionKey),projection=this.authority.get(key),conversation=this.root(context);
    if(!conversation)throw new DomainError("native_conversation_not_authorized",{httpStatus:403});
    if(projection&&!projection.parentSessionKey&&projection.runId&&projection.runId!==context.runId)throw new DomainError("native_run_authority_changed",{httpStatus:403});
    const candidates=this.database.submissions.listForConversation(conversation.id).filter(item=>["running","dispatching"].includes(item.receipt.status)&&!item.recoveryRequired);
    const source=projection?this.database.submissions.get(projection.sourceId):candidates.length===1?candidates[0]:undefined;
    if(!source||source.recoveryRequired)throw new DomainError("admitted_household_request_required",{httpStatus:403});
    const profile=this.database.getProfile(source.receipt.profileId),grant=profile&&this.grants[profile.id],packet=source.taskContext;
    if(!profile||profile.role==="child"||!profile.capabilities.includes("chat")||!grant?.enabled)throw new DomainError("domain_profile_not_authorized",{httpStatus:403});
    if(packet?.origin?.kind==="discord"&&packet.origin.confirmedHuman!==true)throw new DomainError("verified_native_human_source_required",{httpStatus:403});
    const shared=conversation.audience==="household"&&packet?.origin?.shared===true;
    if(!shared&&(conversation.ownerProfileId!==profile.id||conversation.agentId!==profile.agentId))throw new DomainError("native_principal_mismatch",{httpStatus:403});
    if(projection?.parentSessionKey){if(projection.agentId!==context.agentId||projection.rootSessionKey!==conversation.sessionKey)throw new DomainError("native_child_not_authorized",{httpStatus:403});}
    else if(context.agentId!==conversation.agentId||normalizedSessionKey(context.agentId,context.sessionKey)!==conversation.sessionKey)throw new DomainError("native_session_not_authorized",{httpStatus:403});
    const admission=this.database.getSubmissionDomainBinding(source.receipt.submissionId),watermark=this.database.getGoalControlIssuedAt(conversation.id);
    if(!admission||admission.controlWatermark!==watermark||admission.audience!==conversation.audience)throw new DomainError("household_request_context_changed",{httpStatus:409});
    const rootGoal=context.nativeGoalId??null;
    const boundGoal=source.receipt.goalId??projection?.goalId??null;
    const completionProjectionFingerprint=projection?fingerprint(projection):null;
    let completionControlIssuedAt:number|undefined;
    const completedControlCurrent=(execution:ExecutionGrant|null|undefined)=>{
      if(context.completionRecovery!==true||context.nativeGoalStatus!=="complete"||context.nativeGoalId!==rootGoal||!admission.goalBound||!boundGoal||boundGoal!==rootGoal||
        !execution||execution.parentSessionKey!==null||execution.sessionKey!==key||execution.rootSessionKey!==conversation.sessionKey||
        execution.agentId!==context.agentId||execution.sourceId!==source.receipt.submissionId||execution.runId!==context.runId||
        execution.sessionId!==context.sessionId||execution.goalId!==boundGoal||context.nativeSessionId!==context.sessionId||
        context.nativeRunId!=null&&context.nativeRunId!==context.runId||fingerprint(execution)!==completionProjectionFingerprint)return false;
      const sourceId=packet?.sourceReferenceId??source.receipt.submissionId;
      const operationId="task-complete:"+fingerprint([sourceId,context.sessionId,boundGoal]).slice(0,64);
      const control=this.authority.control(operationId,conversation.id,{kind:"verified_task_completion",sourceId,goalId:boundGoal,sessionId:context.sessionId}) as {issuedAtMs?:unknown;phase?:unknown}|null;
      if(!control||!Number.isSafeInteger(control.issuedAtMs)||Number(control.issuedAtMs)<=0||!["prepared","complete"].includes(String(control.phase)))return false;
      completionControlIssuedAt??=Number(control.issuedAtMs);
      return control.issuedAtMs===completionControlIssuedAt;
    };
    // A projected complete source is never general business authority. Only the
    // derived completion route can reconcile its exact already-prepared control.
    const completedOwnerControl=completedControlCurrent(projection);
    if(!["running","dispatching"].includes(source.receipt.status)&&!(source.receipt.status==="complete"&&completedOwnerControl))throw new DomainError("admitted_household_request_required",{httpStatus:403});
    if(admission.goalBound&&(boundGoal!==rootGoal||context.nativeGoalStatus!=="active"&&!completedOwnerControl))throw new DomainError("source_goal_not_active",{httpStatus:409});
    const exact=source.receipt.runId===context.runId||source.receipt.submissionId===context.runId;
    // Native announce/yield continuations can reach prompt construction before
    // sessions.describe projects an active run. Admission already owns the exact
    // trusted hook run, original source, session generation and active goal.
    const ownedContinuation=Boolean(projection?.agentId===context.agentId&&projection?.rootSessionKey===conversation.sessionKey&&
      projection?.runId===context.runId&&projection?.sourceId===source.receipt.submissionId&&
      projection?.sessionId===context.sessionId&&projection?.goalId&&projection.goalId===rootGoal&&boundGoal===rootGoal&&context.nativeGoalStatus==="active");
    if(!projection?.parentSessionKey&&!exact&&!ownedContinuation&&!completedOwnerControl&&!(boundGoal&&boundGoal===rootGoal&&context.nativeRunId===context.runId))throw new DomainError("native_request_lineage_not_authorized",{httpStatus:403});
    if(!projection?.parentSessionKey&&context.nativeSessionId!==context.sessionId)throw new DomainError("native_session_generation_changed",{httpStatus:409});
    const completionGrantFingerprint=fingerprint(grant),completionProfileFingerprint=fingerprint({agentId:profile.agentId,role:profile.role,status:profile.status,capabilities:profile.capabilities});
    const completionAdmissionFingerprint=fingerprint(admission),completionDeviceFingerprint=fingerprint(source.originDeviceId?this.database.getDevice(source.originDeviceId)??null:null);
    const completionConversationFingerprint=fingerprint({id:conversation.id,ownerProfileId:conversation.ownerProfileId,agentId:conversation.agentId,sessionKey:conversation.sessionKey,audience:conversation.audience});
    const completionSourceFingerprint=fingerprint({profileId:source.receipt.profileId,conversationId:source.receipt.conversationId,runId:source.receipt.runId,goalId:source.receipt.goalId,textHash:source.textHash,packet});
    const current=()=>{
      if(signal?.aborted)throw new DomainError("operation_cancelled");context.assertInvocationCurrent!();
      const latestProfile=this.database.getProfile(profile.id),latest=this.database.submissions.get(source.receipt.submissionId),binding=this.database.getConversation(conversation.id);
      const device=source.originDeviceId?this.database.getDevice(source.originDeviceId):null;
      const execution=this.authority.get(key);
      if(projection&&!projection.parentSessionKey&&(execution?.runId!==context.runId||execution?.sourceId!==source.receipt.submissionId))throw new DomainError("native_run_authority_changed",{httpStatus:403});
      if(completedOwnerControl&&(!completedControlCurrent(execution)||!latest||!latestProfile||!binding||
        fingerprint(this.grants[profile.id]??null)!==completionGrantFingerprint||
        fingerprint({agentId:latestProfile.agentId,role:latestProfile.role,status:latestProfile.status,capabilities:latestProfile.capabilities})!==completionProfileFingerprint||
        fingerprint(this.database.getSubmissionDomainBinding(source.receipt.submissionId)??null)!==completionAdmissionFingerprint||
        fingerprint(device??null)!==completionDeviceFingerprint||
        fingerprint({id:binding.id,ownerProfileId:binding.ownerProfileId,agentId:binding.agentId,sessionKey:binding.sessionKey,audience:binding.audience})!==completionConversationFingerprint||
        fingerprint({profileId:latest.receipt.profileId,conversationId:latest.receipt.conversationId,runId:latest.receipt.runId,goalId:latest.receipt.goalId,textHash:latest.textHash,packet:latest.taskContext})!==completionSourceFingerprint))
        throw new DomainError("domain_authority_revoked",{httpStatus:403});
      if(!latestProfile||latestProfile.role==="child"||!latestProfile.capabilities.includes("chat")||latestProfile.agentId!==profile.agentId||
        ["paused","offline"].includes(latestProfile.status)||fingerprint(latestProfile.capabilities)!==fingerprint(profile.capabilities)||
        !latest||binding?.deletedAt||!["dispatching","running"].includes(latest.receipt.status)&&!(latest.receipt.status==="complete"&&completedOwnerControl)||latest.recoveryRequired||binding?.audience!==conversation.audience||
        this.database.getGoalControlIssuedAt(conversation.id)!==watermark||
        (source.originDeviceId?(!device||device.status!=="active"||device.deviceKind!=="personal"||device.profileId!==profile.id):(!packet?.origin||!this.externalCurrent?.(packet,profile.id))))throw new DomainError("domain_authority_revoked",{httpStatus:403});
    };
    const original=packet?.sourceReferenceId?this.database.submissions.get(packet.sourceReferenceId):source;
    if(!original||original.receipt.conversationId!==conversation.id||original.recoveryRequired||original.receipt.profileId!==profile.id&&conversation.audience!=="household")throw new DomainError("source_reference_not_authorized");
    const principal:DomainPrincipal={profileId:profile.id,agentId:profile.agentId,sessionKey:conversation.sessionKey,conversationId:conversation.id,
      taskId:(packet as any)?.independentTopicOf?independentTopicTaskId(String((packet as any).independentSourcePromptId??source.receipt.submissionId)):boundGoal??"conversation:"+conversation.id,audience:conversation.audience,sourcePromptId:original.receipt.submissionId,sourcePromptCreatedAt:original.createdAt,
      originDeviceId:source.originDeviceId,authorizationFingerprint:fingerprint({profileId:profile.id,agentId:profile.agentId,role:profile.role,capabilities:profile.capabilities,grant}),
      canReadHousehold:grant.scopes.includes("household"),canWriteHousehold:grant.scopes.includes("household"),canEditContacts:grant.contactEditing,assertCurrent:current,signal};
    current();return {principal,grant,conversation,sourceHash:original.textHash,packet,mode:projection?.mode??(packet?.mode==="diagnostic"?"diagnostic":packet?.mode==="brain_dump"?"brain_dump":"normal"),rootSessionId:context.nativeSessionId??null,rootGoalId:rootGoal};
  }
  async userInput(scope:AuthorizedScope,history:(conversation:Conversation)=>Promise<Array<{role:string;text:string;id:string}>>){
    scope.principal.assertCurrent();const values=await history(scope.conversation);
    const message=values.findLast(value=>value.role==="user"&&createHash("sha256").update(value.text).digest("hex")===scope.sourceHash);
    scope.principal.assertCurrent();if(!message)throw new DomainError("current_user_source_unavailable",{httpStatus:409});
    return {id:"user:"+scope.principal.sourcePromptId,text:message.text,sha256:scope.sourceHash};
  }
}
