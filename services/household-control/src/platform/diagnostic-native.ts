/** Projection at the provider adapter boundary. Never return transcript prose/errors. */
export type NativeDiagnosticObservation = {
  available: boolean;
  runMatched: boolean;
  sessionId: string | null;
  runId: string | null;
  status?: string;
  context: { promptTokens?: number; contextWindowTokens?: number; headroomTokens?: number; estimatedPromptTokens?: number; reserveTokens?: number; overflowTokens?: number; budgetRoute?: string; compactions?: number; finishReason?: string };
  events: Array<{ component: string; code: string; at: string }>;
  unavailable: string[];
};
function object(value: unknown): Record<string,unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string,unknown> : {};
}
function integer(value:unknown): value is number {return Number.isSafeInteger(value) && Number(value)>=0;}
const reasons=new Set(["stop","end_turn","max_tokens","length","tool_calls","tool_use","error","aborted","timeout","content_filter"]);
const states=new Set(["queued","running","done","failed","interrupted","killed","timeout"]);
export function projectNativeDiagnosticObservation(row: Record<string,unknown>, history: unknown, targetRunId: string | null,
  observedAt = new Date().toISOString()): NativeDiagnosticObservation {
  const runId=typeof row.lastRunId==="string"?row.lastRunId:null;
  const exact=Boolean(targetRunId && runId===targetRunId);
  const result:NativeDiagnosticObservation={available:true,runMatched:exact,sessionId:typeof row.sessionId==="string"?row.sessionId:null,
    runId,context:{},events:[],unavailable:[]};
  // A later turn's session-level counters cannot diagnose a different historical run.
  if(exact){
    if(states.has(String(row.status)))result.status=String(row.status);
    if(integer(row.contextTokens)&&row.contextTokens>0)result.context.contextWindowTokens=row.contextTokens;
    if(integer(row.compactionCount))result.context.compactions=row.compactionCount;
    const budget=object(row.contextBudgetStatus);
    if(budget.schemaVersion===1&&budget.source==="pre-prompt-estimate"&&(!budget.sessionId||budget.sessionId===row.sessionId)){
      if(integer(budget.estimatedPromptTokens))result.context.estimatedPromptTokens=budget.estimatedPromptTokens;
      if(integer(budget.contextTokenBudget)&&budget.contextTokenBudget>0)result.context.contextWindowTokens=budget.contextTokenBudget;
      if(integer(budget.remainingPromptBudgetTokens))result.context.headroomTokens=budget.remainingPromptBudgetTokens;
      if(integer(budget.effectiveReserveTokens))result.context.reserveTokens=budget.effectiveReserveTokens;
      if(integer(budget.overflowTokens))result.context.overflowTokens=budget.overflowTokens;
      if(["fits","compact_only","truncate_tool_results_only","compact_then_truncate"].includes(String(budget.route)))result.context.budgetRoute=String(budget.route);
    }
    if(row.lastRunError)result.events.push({component:"native",code:"provider_or_runtime_error_recorded",at:observedAt});
  }
  const messages=object(history).messages;
  const selected=(Array.isArray(messages)?messages:[]).map(object).filter(message=>{
    const metadata=object(message.__openclaw);
    return Boolean(targetRunId && (message.runId===targetRunId || metadata.runId===targetRunId));
  });
  for(const message of selected){
    if(message.role!=="assistant")continue;
    const reason=message.stopReason??message.finishReason;
    if(typeof reason==="string"&&reasons.has(reason))result.context.finishReason=reason;
    const usage=object(message.usage),input=usage.input??usage.inputTokens;
    if(integer(input)){
      const read=usage.cacheRead??usage.cacheReadTokens,write=usage.cacheWrite??usage.cacheWriteTokens;
      result.context.promptTokens=input+(integer(read)?read:0)+(integer(write)?write:0);
    }
    if(reason==="error"||message.errorMessage)result.events.push({component:"native",code:"model_turn_error_recorded",at:observedAt});
  }
  const observation=object(object(history).runObservation);
  const terminalReason=observation.stopReason??observation.finishReason;
  if(typeof terminalReason==="string"&&reasons.has(terminalReason))result.context.finishReason=terminalReason;
  if(result.context.headroomTokens===undefined&&result.context.promptTokens!==undefined&&result.context.contextWindowTokens!==undefined)
    result.context.headroomTokens=Math.max(0,result.context.contextWindowTokens-result.context.promptTokens);
  for(const key of ["promptTokens","contextWindowTokens","headroomTokens","compactions","finishReason"] as const)
    if(result.context[key]===undefined)result.unavailable.push(key);
  if(!exact)result.unavailable.push("historical_session_snapshot");
  return result;
}
