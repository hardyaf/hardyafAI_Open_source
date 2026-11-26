import type { ArtifactStore } from "../platform/artifacts.ts";
import { readNativeDiagnosticEvents } from "./native-diagnostic-events.ts";
import type { HouseholdDatabase } from "../database.ts";
import type { Conversation } from "../domain.ts";
import { buildDiagnosticEvidence } from "../platform/diagnostic-evidence.ts";
import type { NativeDiagnosticObservation } from "../platform/diagnostic-native.ts";
import { DomainError } from "./common.ts";

type Row=Record<string,unknown>;
export type DiagnosticReaderOptions={
  database:HouseholdDatabase; artifacts?:ArtifactStore;
  native:{readDiagnosticObservation(conversation:Conversation,runId:string|null,assertCurrent:()=>void):Promise<NativeDiagnosticObservation>};
  profileId:string; currentConversationId:string; currentSubmissionId:string;
  currentSessionId:string|null; currentGoalId:string|null;
  targetSubmissionId?:string; targetRunId?:string;
  assertCurrent:()=>void; versions:Record<string,string>;
};
function code(value:unknown,fallback="redacted_error"):string {
  return typeof value==="string"&&/^[a-zA-Z][a-zA-Z0-9_.:-]{0,63}$/.test(value)?value:fallback;
}
/** Existing receipt/checkpoint authorities supply evidence; no log or transcript store is added. */
export async function readTaskDiagnosticEvidence(options:DiagnosticReaderOptions):Promise<unknown>{
  const {database,profileId,assertCurrent}=options,db=database.domainConnection();
  assertCurrent();
  if(!database.getProfile(profileId)?.capabilities.includes("viewDiagnostics"))throw new DomainError("diagnostic_operator_required",{httpStatus:403});
  const normalize=(value:string)=>value.startsWith("user:")?value.slice(5):value;
  let id=normalize(options.targetSubmissionId??options.currentSubmissionId);
  let selectedGrant:Row|undefined;
  if(options.targetRunId&&!options.targetSubmissionId){
    const rows=db.prepare("SELECT id FROM submissions WHERE profile_id=? AND run_id=? ORDER BY created_at DESC LIMIT 2").all(profileId,options.targetRunId) as Row[];
    if(rows.length>1)throw new DomainError("diagnostic_target_ambiguous",{httpStatus:409});
    if(rows.length)id=String(rows[0].id);
    else {
      const grants=db.prepare(`SELECT g.* FROM native_execution_grants g JOIN submissions s ON s.id=g.root_submission_id
        WHERE s.profile_id=? AND g.native_run_id=? LIMIT 2`).all(profileId,options.targetRunId) as Row[];
      if(grants.length!==1)throw new DomainError(grants.length?"diagnostic_target_ambiguous":"diagnostic_target_not_found",{httpStatus:404});
      selectedGrant=grants[0];id=String(selectedGrant.root_submission_id);
    }
  }
  const selected=database.submissions.get(id);
  const conversation=selected&&database.getConversation(selected.receipt.conversationId);
  // Operator status does not authorize another adult's receipts or native session.
  if(!selected||selected.receipt.profileId!==profileId||!conversation||conversation.ownerProfileId!==profileId)
    throw new DomainError("diagnostic_target_not_found",{httpStatus:404});
  if(options.targetRunId&&selected.receipt.runId!==options.targetRunId&&!selectedGrant){
    selectedGrant=db.prepare("SELECT * FROM native_execution_grants WHERE root_submission_id=? AND native_run_id=? LIMIT 1").get(id,options.targetRunId) as Row|undefined;
    if(!selectedGrant)throw new DomainError("diagnostic_target_binding_mismatch",{httpStatus:409});
  }
  const runId=options.targetRunId??selected.receipt.runId,goalId=selected.receipt.goalId??null;
  const observedConversation=selectedGrant?{...conversation,agentId:String(selectedGrant.agent_id),sessionKey:String(selectedGrant.native_session_key)}:conversation;
  let native:NativeDiagnosticObservation;
  try{native=await options.native.readDiagnosticObservation(observedConversation,runId,assertCurrent);}
  catch{assertCurrent();native={available:false,runMatched:false,sessionId:null,runId:null,context:{},events:[],unavailable:["native_observation"]};}
  assertCurrent();
  const expectedSession=selected.taskContext?.expectedSessionId;
  const sessionId=typeof expectedSession==="string"?expectedSession:
    native.runMatched?native.sessionId:selected.receipt.conversationId===options.currentConversationId&&goalId===options.currentGoalId?options.currentSessionId:null;
  // Historical goals remain addressable after the diagnosis has started a different goal/session.
  const checkpointSession=goalId?(db.prepare("SELECT native_session_id FROM conversation_checkpoints WHERE conversation_id=? AND native_goal_id=? ORDER BY updated_at DESC LIMIT 1").get(conversation.id,goalId) as Row|undefined)?.native_session_id:sessionId;
  const checkpoint=typeof checkpointSession==="string"?database.getCheckpoint(conversation.id,checkpointSession,goalId):null;
  const sourceIds=goalId?(db.prepare("SELECT id FROM submissions WHERE profile_id=? AND conversation_id=? AND goal_id=? ORDER BY created_at DESC LIMIT 100").all(profileId,conversation.id,goalId) as Row[]).map(row=>String(row.id)):[id];
  const originalId=selected.taskContext?.sourceReferenceId;
  if(originalId){
    const original=database.submissions.get(normalize(originalId));
    if(original?.receipt.profileId===profileId&&original.receipt.conversationId===conversation.id&&!sourceIds.includes(original.receipt.submissionId))sourceIds.push(original.receipt.submissionId);
  }
  const captured=options.artifacts&&runId?await readNativeDiagnosticEvents({artifacts:options.artifacts,scope:{ownerProfileId:profileId,conversationId:conversation.id},sourceId:id,runId,assertCurrent}):{records:[],truncated:false};
  const context={...native.context};
  const ordered=[...captured.records].sort((left,right)=>left.at.localeCompare(right.at));
  for(const record of ordered){
    if(record.metrics.contextWindowTokens!==undefined)context.contextWindowTokens=record.metrics.contextWindowTokens;
    if(record.kind==="llm_output"&&record.metrics.inputTokens!==undefined){
      const count=record.metrics.inputTokens+(record.metrics.cacheReadTokens??0)+(record.metrics.cacheWriteTokens??0);
      if(Number.isSafeInteger(count))context.promptTokens=count;
    }
    if(record.finishReason)context.finishReason=record.finishReason;
  }
  const compactionsObserved=ordered.filter(record=>record.kind==="after_compaction").length;
  if(compactionsObserved>0)context.compactions=compactionsObserved;
  if(context.estimatedPromptTokens===undefined&&context.promptTokens!==undefined&&context.contextWindowTokens!==undefined)
    context.headroomTokens=Math.max(0,context.contextWindowTokens-context.promptTokens);
  const unavailable=native.unavailable.filter(name=>context[name as keyof typeof context]===undefined);
  const projectedNativeEvents=ordered.map(record=>({component:record.kind==="after_compaction"?"native_context":"native_model",
    code:record.kind==="after_compaction"?"compaction_completed":record.failureKind??record.errorCategory??(record.finishReason?"finish_"+record.finishReason:record.outcome==="completed"?"model_call_completed":"model_observation"),at:record.at}));
  const placeholders=sourceIds.map(()=>"?").join(",");
  const effects=sourceIds.length?db.prepare(`SELECT operation_id AS operationId,tool_name AS tool,state,error_code AS errorCode,updated_at AS updatedAt
    FROM domain_effects WHERE profile_id=? AND conversation_id=? AND source_prompt_id IN (${placeholders}) ORDER BY updated_at DESC LIMIT 100`).all(profileId,conversation.id,...sourceIds) as Row[]:[];
  const recentEffects=effects.map(row=>({operationId:row.operationId,tool:row.tool,state:code(row.state,"unknown"),errorCode:row.errorCode?code(row.errorCode):null,updatedAt:row.updatedAt}));
  const events=[{component:"delivery",code:code(selected.receipt.status,"unknown"),at:selected.updatedAt},
    ...(selected.receipt.failureCode?[{component:"delivery",code:code(selected.receipt.failureCode),at:selected.updatedAt}]:[]),
    ...recentEffects.map(row=>({component:"effect",code:row.errorCode??row.state,at:String(row.updatedAt)})),...native.events,...projectedNativeEvents].slice(-200);
  const evidence=buildDiagnosticEvidence({taskId:goalId??id,phase:code(checkpoint?.phase,"unrecorded"),outcome:code(selected.receipt.status,"unknown"),
    events,...context,unavailable,versions:options.versions});
  const recentRequests=(db.prepare("SELECT id,conversation_id AS conversationId,run_id AS runId,goal_id AS goalId,status,last_error AS errorCode,attempt_count AS attempts,recovery_required AS recoveryRequired,updated_at AS updatedAt FROM submissions WHERE profile_id=? ORDER BY updated_at DESC LIMIT 20").all(profileId) as Row[])
    .map(row=>({...row,errorCode:row.errorCode?code(row.errorCode):null}));
  assertCurrent();
  return {evidence,target:{submissionId:id,conversationId:conversation.id,runId,goalId,sessionId},
    nativeObservation:{available:native.available||ordered.length>0,runMatched:native.runMatched,metricScope:"current_session_snapshot_and_exact_run_usage",headroomBasis:context.estimatedPromptTokens!==undefined?"native_pre_prompt_estimate_after_reserve":"last_reported_prompt_including_cache",
      compactionsBasis:compactionsObserved>0?"observed_native_hook_events_for_exact_run":"native_session_counter_when_available"},
    nativeEvidence:{source:"native_hook_artifact_projection",records:ordered,captureTruncated:captured.truncated,compactionEventsObserved:compactionsObserved},
    recentEffects,recentRequests,policy:"diagnosis_only_no_repair",rawContentIncluded:false};
}
