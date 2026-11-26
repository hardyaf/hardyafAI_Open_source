import type { HouseholdDatabase } from "../database.ts";
import type { Conversation, SubmissionReceipt } from "../domain.ts";
import type { ArtifactStore } from "../platform/artifacts.ts";
import type { StoredSubmission } from "../submission-repository.ts";
import type { MessageTaskContext } from "../request-context.ts";
import type { TaskHandoff, TaskQuestion } from "./types.ts";
import { PlatformError } from "../platform/errors.ts";

type Packet=MessageTaskContext&{questionRootSourceId?:string};
export type SourceSettlementInput={sourceId:string;conversationId:string;sessionId:string;goalId:string|null;goalComplete?:boolean;assertCurrent():void};
export type SourceQuestionSettlement={sourceId:string;sourceRunId:string|null;questionRootSourceId:string;independent:boolean;
  waiting:boolean;continuationPending:boolean;completedGoalId?:string;resolvedWaitingSourceIds:string[]};
const sourceId=(value:string)=>value.startsWith("user:")?value.slice(5):value;
const fail=():never=>{throw new PlatformError("source_question_binding_invalid",409);};
/** Existing immutable question/handoff artifacts own topic focus; the source tag is a derived index, never authority. */
export async function readSourceQuestionSettlement(options:{database:HouseholdDatabase;artifacts:ArtifactStore;input:SourceSettlementInput;
  canReadHousehold:boolean;childPending?(sourceId:string):Promise<boolean>}):Promise<SourceQuestionSettlement>{
  const {database,artifacts,input}=options;input.assertCurrent();
  const current=database.submissions.get(input.sourceId),conversation=database.getConversation(input.conversationId);
  if(!current||!conversation||current.receipt.conversationId!==conversation.id)return fail();
  const packet=(current.taskContext??{mode:"conversation",artifactIds:[]}) as Packet;
  if(packet.expectedSessionId&&packet.expectedSessionId!==input.sessionId)return fail();
  const independent=Boolean(packet.independentTopicOf),rootGoal=independent?(packet.independentTopicOf!.startsWith("conversation:")?null:packet.independentTopicOf!):input.goalId;
  const expectedTaskId=rootGoal??"conversation:"+conversation.id;
  const checkpoint=database.getCheckpoint(conversation.id,input.sessionId,rootGoal);
  const principal={profileId:current.receipt.profileId,canReadHousehold:options.canReadHousehold};
  async function read<T>(id:string,filename:string,kind:string):Promise<T>{
    input.assertCurrent();const item=await artifacts.read(id,principal);input.assertCurrent();
    if(item.metadata.ownerProfileId!==conversation!.ownerProfileId||item.metadata.conversationId!==conversation!.id||item.metadata.taskId!==expectedTaskId||
      item.metadata.audience!==conversation!.audience||item.metadata.kind!=="evidence"||item.metadata.filename!==filename||item.metadata.mimeType!=="application/json"||item.bytes.length>128*1024)return fail();
    const value=JSON.parse(item.bytes.toString("utf8"));
    if(value.schemaVersion!==1||value.kind!==kind||value.nativeSessionId!==input.sessionId||value.nativeGoalId!==rootGoal)return fail();
    return value as T;
  }
  const handoff=checkpoint?.checkpointArtifactId?await read<TaskHandoff>(checkpoint.checkpointArtifactId,"task-handoff.json","task_handoff"):null;
  if(handoff&&(handoff.taskId!==expectedTaskId||handoff.questionArtifactId!==checkpoint!.questionArtifactId))return fail();
  let rootSourceId=independent?sourceId(packet.independentSourcePromptId??current.receipt.submissionId):handoff?sourceId(handoff.originalSourcePromptId):packet.questionRootSourceId??current.receipt.submissionId;
  const rootSource=database.submissions.get(rootSourceId);
  if(!rootSource||rootSource.receipt.conversationId!==conversation.id||conversation.audience==="private"&&rootSource.receipt.profileId!==current.receipt.profileId)return fail();
  if(!independent&&handoff&&handoff.originalSourceSha256!==rootSource.textHash)return fail();
  const ids=[...new Set([checkpoint?.questionArtifactId,...(handoff?.suspendedQuestionArtifactIds??[])].filter((id):id is string=>typeof id==="string"))];
  if(ids.length>33)return fail();
  const questions=await Promise.all(ids.map(id=>read<TaskQuestion>(id,"task-question.json","task_question")));
  const waiting=questions.some(question=>independent?question.independentTopicOf===packet.independentTopicOf&&sourceId(question.independentSourcePromptId??question.sourcePromptId)===rootSourceId:!question.independentTopicOf);
  const goalBound=Boolean(current.receipt.goalId)||database.getSubmissionDomainBinding(current.receipt.submissionId)?.goalBound===true;
  if(!independent&&!goalBound&&handoff&&packet.questionRootSourceId!==rootSourceId){
    input.assertCurrent();
    const changed=database.domainConnection().prepare("UPDATE submissions SET task_context_json=? WHERE id=? AND run_id IS ? AND task_context_json IS ? AND (status IN ('running','dispatching','waiting_for_user') OR recovery_required=1)")
      .run(JSON.stringify({...packet,questionRootSourceId:rootSourceId}),current.receipt.submissionId,current.receipt.runId,current.taskContext?JSON.stringify(current.taskContext):null);
    if(changed.changes!==1)return fail();
  }
  const completedGoalId=!independent&&goalBound&&input.goalComplete===true&&rootGoal&&questions.length===0?rootGoal:undefined;
  const rows=database.domainConnection().prepare("SELECT id FROM submissions WHERE conversation_id=? AND status='waiting_for_user' AND recovery_required=0 AND id<>?").all(conversation.id,current.receipt.submissionId) as {id:string}[];
  const candidates:StoredSubmission[]=[];
  if(!waiting&&(independent||!goalBound||completedGoalId))for(const row of rows){
    const previous=database.submissions.get(row.id)!,old=(previous.taskContext??{}) as Packet;
    if(conversation.audience==="private"&&previous.receipt.profileId!==current.receipt.profileId)continue;
    if(independent){
      if(old.independentTopicOf!==packet.independentTopicOf||sourceId(old.independentSourcePromptId??previous.receipt.submissionId)!==rootSourceId)continue;
    }else if(completedGoalId){
      if(old.independentTopicOf||previous.receipt.goalId!==completedGoalId)continue;
    }else{
      if(old.independentTopicOf||previous.receipt.goalId||database.getSubmissionDomainBinding(row.id)?.goalBound===true||
        (old.questionRootSourceId??previous.receipt.submissionId)!==rootSourceId)continue;
    }
    candidates.push(previous);
  }
  const continuationPending=options.childPending?await options.childPending(current.receipt.submissionId):false;
  const resolvedWaitingSourceIds:string[]=[];
  for(const candidate of candidates)if(!options.childPending||!await options.childPending(candidate.receipt.submissionId))resolvedWaitingSourceIds.push(candidate.receipt.submissionId);
  input.assertCurrent();return {sourceId:current.receipt.submissionId,sourceRunId:current.receipt.runId,questionRootSourceId:rootSourceId,independent,waiting,continuationPending,...(completedGoalId?{completedGoalId}:{}),resolvedWaitingSourceIds};
}
/** Called in the caller's synchronous settlement transaction; waiting-turn closure is not business delivery proof. */
export function settleResolvedWaitingSources(database:HouseholdDatabase,plan:SourceQuestionSettlement):SubmissionReceipt[]{
  if(plan.waiting||plan.continuationPending)return [];
  const current=database.submissions.get(plan.sourceId);
  if(!current||current.receipt.runId!==plan.sourceRunId||!["running","dispatching","waiting_for_user"].includes(current.receipt.status)&&!current.recoveryRequired)return fail();
  const conversation=database.getConversation(current.receipt.conversationId)!;
  const packet=(current.taskContext??{}) as Packet,result:SubmissionReceipt[]=[];
  for(const id of plan.resolvedWaitingSourceIds){
    const previous=database.submissions.get(id),old=(previous?.taskContext??{}) as Packet;
    if(!previous||previous.receipt.status!=="waiting_for_user"||previous.recoveryRequired||previous.receipt.conversationId!==conversation.id||
      conversation.audience==="private"&&previous.receipt.profileId!==current.receipt.profileId)continue;
    if(plan.independent){if(old.independentTopicOf!==packet.independentTopicOf||sourceId(old.independentSourcePromptId??id)!==plan.questionRootSourceId)continue;}
    else if(plan.completedGoalId){if(old.independentTopicOf||previous.receipt.goalId!==plan.completedGoalId||current.receipt.goalId!==plan.completedGoalId)continue;}
    else if(old.independentTopicOf||previous.receipt.goalId||database.getSubmissionDomainBinding(id)?.goalBound===true||(old.questionRootSourceId??id)!==plan.questionRootSourceId)continue;
    const updated=database.domainConnection().prepare("UPDATE submissions SET status='complete',last_error=NULL,payload_json=NULL,updated_at=? WHERE id=? AND status='waiting_for_user' AND run_id IS ? AND task_context_json IS ? AND recovery_required=0")
      .run(new Date().toISOString(),id,previous.receipt.runId,previous.taskContext?JSON.stringify(previous.taskContext):null);
    if(updated.changes===1)result.push(database.submissions.get(id)!.receipt);
  }
  return result;
}
