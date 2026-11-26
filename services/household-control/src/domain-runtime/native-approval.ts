import type { HouseholdDatabase } from "../database.ts";
import type { ExecutionAuthorityRepository, MessageTaskContext } from "../request-context.ts";
import type { TaskApplicationBinding } from "./task-application.ts";
import type { TaskQuestion, TaskSnapshot } from "../task-flow/types.ts";
import type { NativeEntryRule } from "./native-admission.ts";
import type { NativeDeliveryTarget } from "../domains/native-contracts.ts";
import { DomainError, fingerprint } from "./common.ts";

type Json=Record<string,unknown>;
export type NativeApprovalBridgeOptions={database:HouseholdDatabase;authority:ExecutionAuthorityRepository;
  snapshot(binding:TaskApplicationBinding):Promise<TaskSnapshot>;
  /** Composition proves protected native reviewer/routing policy for this profile. Absent proof refuses. */
  routeAuthorized(binding:TaskApplicationBinding):Promise<boolean>|boolean;
  validateQuestion(binding:TaskApplicationBinding,question:TaskQuestion):Promise<void>;
};
/** Installed 2026.9.8: Discord plugin decisions use execApprovals.approvers even with native exec delivery disabled.
 * Generic plugin forwarding is independently configured. Do not infer reviewer identity from display-only approval scope.
 */
export function nativeApprovalRouteAuthorized(config:unknown,binding:TaskApplicationBinding,entryRules:readonly NativeEntryRule[],protectedTarget?:NativeDeliveryTarget):boolean {
  const obj=(value:unknown):Json=>value&&typeof value==="object"&&!Array.isArray(value)?value as Json:{};
  const cfg=obj(config),plugin=obj(obj(cfg.approvals).plugin),discord=obj(obj(cfg.channels).discord);
  const rules=entryRules.filter(rule=>rule.profileId===binding.task.principal.profileId&&rule.agentId===binding.execution.agentId&&rule.audience==="private");
  const identities=[...new Set(rules.map(rule=>rule.externalUserId))];
  if(binding.task.scope.audience!=="private"||identities.length!==1||plugin.enabled!==true||plugin.mode!=="targets"||
    !Array.isArray(plugin.agentFilter)||!plugin.agentFilter.includes(binding.execution.agentId)||!Array.isArray(plugin.targets)||!plugin.targets.length)return false;
  if(protectedTarget&&(protectedTarget.channel!=="discord"||protectedTarget.audience!=="private"))return false;
  for(const raw of plugin.targets){
    const target=obj(raw);
    if(target.channel!=="discord"||typeof target.to!=="string")return false;
    if(protectedTarget){
      if(["channel","to","accountId","threadId"].some(key=>String(target[key]??"")!==String((protectedTarget as unknown as Json)[key]??"")))return false;
    }else if(!rules.some(rule=>target.to==="channel:"+rule.channelId))return false;
  }
  const reviewerPolicy=(channel:Json)=>{
    const approvals=obj(channel.execApprovals);
    // Explicit singleton reviewers prevent fallback to broader owner/allowFrom lists.
    // Keep native DM/origin fanout disabled; the protected plugin target owns delivery.
    return approvals.enabled!==true&&approvals.enabled!=="auto"&&Array.isArray(approvals.approvers)&&
      approvals.approvers.length===1&&approvals.approvers[0]===identities[0];
  };
  if(!reviewerPolicy(discord))return false;
  const accounts=obj(discord.accounts);
  for(const account of Object.values(accounts)){
    const own=obj(account);
    if(own.execApprovals!==undefined&&!reviewerPolicy({...discord,...own}))return false;
  }
  return true;
}
/** Adapts a native allow-once decision into the existing question/source authority; no second approval ledger. */
export class NativeApprovalBridge {
  private readonly options:NativeApprovalBridgeOptions;
  constructor(options:NativeApprovalBridgeOptions){this.options=options;}
  private async target(binding:TaskApplicationBinding,event:Json,context:Json){
    if(event.toolName!=="household_task_bind_reply")return null;
    const params=event.params&&typeof event.params==="object"?event.params as Json:{};
    if(params.decision!=="approve")return null;
    const task=binding.task;task.assertCurrent();
    if(task.source.human!==true||task.mode==="diagnostic"||binding.execution.runId!==(context.runId??event.runId))throw new DomainError("fresh_human_response_required");
    const sourceId=task.source.id.startsWith("user:")?task.source.id.slice(5):task.source.id;
    const source=this.options.database.submissions.get(sourceId);
    const profile=this.options.database.getProfile(task.principal.profileId);
    if(source?.taskContext?.approval)return null; // existing signed/native decision is independently checked by the owner
    // Native callback does not expose reviewer identity. V1 therefore requires the
    // private operator profile and an explicitly verified protected reviewer route.
    if(!source||source.receipt.profileId!==task.principal.profileId||source.receipt.conversationId!==task.scope.conversationId||
      profile?.role!=="admin"||task.scope.audience!=="private"||!await this.options.routeAuthorized(binding))throw new DomainError("native_approval_route_not_authorized",{httpStatus:403});
    const snapshot=await this.options.snapshot(binding),id=params.questionArtifactId??snapshot.checkpoint?.questionArtifactId;
    const question=id===snapshot.checkpoint?.questionArtifactId?snapshot.question:snapshot.suspendedQuestions?.find(row=>row.artifactId===id)?.question;
    if(typeof id!=="string"||!question||question.questionType!=="approval"||!question.approval||question.sourcePromptId===task.source.id||snapshot.handoff?.originalSourcePromptId===task.source.id||
      params.relation!=="answer"&&params.relation!=="steer")throw new DomainError("approval_target_invalid");
    await this.options.validateQuestion(binding,question);task.assertCurrent();
    const packet=source.taskContext;
    if(!packet||packet.origin?.kind==="scheduled")throw new DomainError("fresh_human_response_required");
    const toolCallId=event.toolCallId??context.toolCallId;
    if(typeof toolCallId!=="string"||!toolCallId)throw new DomainError("trusted_native_invocation_required");
    const proof={kind:"native_plugin_approval",sourceId,questionId:id,profileId:task.principal.profileId,runId:binding.execution.runId,
      sessionId:task.native.sessionId,goalId:task.native.goalId,toolCallId,approval:question.approval};
    return {sourceId,source,packet,question,id,proof,operationId:"native-approval:"+fingerprint(proof).slice(0,64)};
  }
  async isPending(binding:TaskApplicationBinding,event:Json,context:Json):Promise<boolean>{
    const target=await this.target(binding,event,context);if(!target)return false;
    const receipt=this.options.authority.control(target.operationId,binding.task.scope.conversationId,target.proof) as {phase?:string;state?:string}|null;
    return receipt?.phase==="prepared"&&receipt.state===undefined;
  }
  async request(binding:TaskApplicationBinding,event:Json,context:Json){
    const target=await this.target(binding,event,context);if(!target)return undefined;
    if(target.packet.approval?.questionId===target.id&&target.packet.approval.decision==="approve")return undefined; // signed app or exact prior native decision
    this.options.authority.prepareControl(target.operationId,binding.task.scope.conversationId,target.proof);
    return {title:"Approve household action",description:target.question.text.slice(0,512),severity:"warning" as const,
      allowedDecisions:["allow-once","deny"] as const,timeoutMs:120_000};
  }
  async resolved(binding:TaskApplicationBinding,event:Json,context:Json,decision:string):Promise<void>{
    const target=await this.target(binding,event,context);if(!target)return;
    const receipt=this.options.authority.control(target.operationId,binding.task.scope.conversationId,target.proof) as {issuedAtMs?:number;phase?:string;state?:string}|null;
    if(!receipt||!Number.isSafeInteger(receipt.issuedAtMs))throw new DomainError("native_approval_request_not_prepared");
    if(decision!=="allow-once"){
      this.options.authority.finishControl(target.operationId,binding.task.scope.conversationId,target.proof,{issuedAtMs:receipt.issuedAtMs,phase:"settled",state:"denied"});return;
    }
    if(receipt.state==="approved"&&target.packet.approval?.questionId===target.id&&target.packet.approval.decision==="approve")return;
    if(receipt.state)throw new DomainError("native_approval_already_resolved");
    const packet:MessageTaskContext={...target.packet,replyToQuestionId:target.id,approval:{questionId:target.id,decision:"approve"}};
    const db=this.options.database.domainConnection();binding.task.assertCurrent();db.exec("BEGIN IMMEDIATE");
    try{
      const result=db.prepare("UPDATE submissions SET task_context_json=? WHERE id=? AND task_context_json=? AND status IN ('running','dispatching')").run(JSON.stringify(packet),target.sourceId,JSON.stringify(target.packet));
      if(result.changes!==1)throw new DomainError("native_approval_source_changed");
      this.options.authority.finishControl(target.operationId,binding.task.scope.conversationId,target.proof,{issuedAtMs:receipt.issuedAtMs,phase:"settled",state:"approved"});db.exec("COMMIT");
    }catch(error){db.exec("ROLLBACK");throw error;}
  }
}
