import { createHash, randomUUID } from "node:crypto";

const kinds=["model_call_ended","llm_output","after_compaction"];
const reasons=new Set(["stop","end_turn","max_tokens","length","tool_calls","tool_use","error","aborted","timeout","content_filter"]);
const categories=new Set(["rate_limit","authentication","authorization","billing","timeout","context_overflow","invalid_request","tool_schema","model_error","connection","server_error","aborted","unknown"]);
const failures=new Set(["aborted","connection_closed","connection_reset","terminated","timeout"]);
const identifier=(value,max=512)=>typeof value==="string"&&value.length>0&&value.length<=max&&/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value);
const object=value=>value&&typeof value==="object"&&!Array.isArray(value)?value:{};
function numeric(source,target,mapping){
  for(const [name,key] of Object.entries(mapping))if(Number.isSafeInteger(source[key])&&source[key]>=0)target[name]=source[key];
}
/** Read only documented metadata. Prompts, output text, paths and provider error bodies never leave this projector. */
export function projectNativeDiagnosticEvent(kind,event,context){
  if(!kinds.includes(kind))return undefined;
  const runId=context.runId??event.runId,sessionKey=context.sessionKey??event.sessionKey,sessionId=context.sessionId??event.sessionId;
  if(!identifier(runId,200)||!identifier(sessionKey)||!identifier(sessionId,200)||!identifier(context.agentId,64)||
    event.runId&&context.runId&&event.runId!==context.runId||event.sessionKey&&context.sessionKey&&event.sessionKey!==context.sessionKey||
    event.sessionId&&context.sessionId&&event.sessionId!==context.sessionId)return undefined;
  const observation={schemaVersion:1,kind,observationId:createHash("sha256").update(kind+":"+(identifier(event.callId,200)?event.callId:randomUUID())).digest("hex"),
    runId,sessionKey,sessionId,agentId:context.agentId,at:new Date().toISOString(),metrics:{}};
  numeric(event,observation.metrics,{contextWindowTokens:"contextTokenBudget"});
  if(observation.metrics.contextWindowTokens===undefined)numeric(context,observation.metrics,{contextWindowTokens:"contextTokenBudget"});
  if(kind==="model_call_ended"){
    observation.outcome=event.outcome==="completed"?"completed":"error";
    numeric(event,observation.metrics,{durationMs:"durationMs",requestPayloadBytes:"requestPayloadBytes",responseStreamBytes:"responseStreamBytes",timeToFirstByteMs:"timeToFirstByteMs"});
    if(event.outcome==="error")observation.errorCategory=categories.has(event.errorCategory)?event.errorCategory:"provider_error";
    if(failures.has(event.failureKind))observation.failureKind=event.failureKind;
  }else if(kind==="llm_output"){
    numeric(object(event.usage),observation.metrics,{inputTokens:"input",outputTokens:"output",cacheReadTokens:"cacheRead",cacheWriteTokens:"cacheWrite"});
    const assistant=object(event.lastAssistant),reason=assistant.stopReason??assistant.finishReason;
    if(reasons.has(reason))observation.finishReason=reason;
    if(assistant.errorMessage)observation.errorCategory="model_output_error";
  }else{
    numeric(event,observation.metrics,{messageCount:"messageCount",compactedMessageCount:"compactedCount",tokenCount:"tokenCount"});
    if(identifier(event.previousSessionId,200))observation.previousSessionId=event.previousSessionId;
  }
  return observation;
}

/** Passive native observations never authorize tools and never block productive work on capture failure. */
export function registerNativeDiagnosticHooks(api,{isManagedAgent,observe}){
  for(const kind of kinds)api.on(kind,async(event,context)=>{
    if(!isManagedAgent(context.agentId,context.sessionKey))return;
    const observation=projectNativeDiagnosticEvent(kind,event,context);if(!observation)return;
    try{await observe(observation,context);}catch{api.logger?.warn?.("Household diagnostic metadata capture unavailable");}
  },{priority:1001,registrationId:"hardy-household-diagnostic-"+kind});
}
