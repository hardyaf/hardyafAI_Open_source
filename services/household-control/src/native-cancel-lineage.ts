import type { ExecutionGrant } from "./request-context.ts";
import type { Conversation } from "./domain.ts";
import type { JsonRecord, NativeConversationContext } from "./native-session-state.ts";

export type NativeCancellationLineage = {
  rootSessionKey: string; rootSessionId: string; rootRunId: string;
  children: Array<{sessionKey:string;agentId:string;sessionId:string|null;runId:string}>;
};
const helper = (agent: string) => agent === "household-analysis" || agent === "household-workshop";
const refuse = () => { throw Object.assign(Error("cancel_target_conflict"), {code:"cancel_target_conflict",outcome:"not_sent"}); };
const sameKey = (key: unknown, expected: string, agent: string) => {
  const prefix=`agent:${agent}:`, normalize=(value:string)=>value.startsWith(prefix)?value.slice(prefix.length):value;
  return typeof key==="string"&&normalize(key)===normalize(expected);
};

/** Missing native lastRunId cannot erase a still-owned no-goal analysis child.
 * The existing source/grant authorities supply the exact generation and runs.
 */
export function buildCancellationLineage(conversation: Pick<Conversation,"sessionKey"|"agentId">,
  native: NativeConversationContext, source: {id:string;runId:string|null;status:string}|undefined,
  parent: ExecutionGrant|null, children: ExecutionGrant[], requestedRunId: string|undefined): NativeCancellationLineage|null {
  if (!requestedRunId || native.goal && native.goal.status !== "complete" || !native.sessionId || native.runId !== null && native.runId !== requestedRunId ||
    !source || source.runId !== requestedRunId || !["running","dispatching"].includes(source.status) ||
    !parent || parent.parentSessionKey || parent.sessionKey !== conversation.sessionKey || parent.rootSessionKey !== conversation.sessionKey ||
    parent.agentId !== conversation.agentId || parent.sessionId !== native.sessionId || parent.sourceId !== source.id ||
    parent.runId !== requestedRunId || parent.goalId !== null || parent.mode === "diagnostic" || !children.length) return null;
  if (children.some(child => child.rootSessionKey !== parent.rootSessionKey || child.parentSessionKey !== parent.sessionKey ||
    child.sourceId !== source.id || child.goalId !== null || child.mode !== parent.mode || !(helper(child.agentId) || child.agentId === parent.agentId) || !child.runId)) return null;
  return {rootSessionKey:native.sessionKey,rootSessionId:native.sessionId,rootRunId:requestedRunId,
    children:children.map(child=>({sessionKey:child.sessionKey,agentId:child.agentId,sessionId:child.sessionId,runId:child.runId!}))};
}

/** Only exact native runs are aborted; never an unqualified delayed session abort. */
export async function cancelNativeLineage(conversation: Pick<Conversation,"sessionKey"|"agentId">,
  lineage: NativeCancellationLineage, ports: {
    describe(target:{sessionKey:string;agentId:string}):Promise<JsonRecord>;
    abort(target:{sessionKey:string;agentId:string},runId:string):Promise<void>;
    assertCurrent():void;
  }):Promise<void> {
  const validateRoot=(row:JsonRecord)=>{
    if (!sameKey(row.key,conversation.sessionKey,conversation.agentId) || row.sessionId !== lineage.rootSessionId ||
      row.goal != null && (typeof row.goal!=="object" || (row.goal as JsonRecord).status!=="complete") ||
      typeof row.lastRunId === "string" && row.lastRunId !== lineage.rootRunId ||
      Array.isArray(row.activeRunIds) && row.activeRunIds.some(id=>id!==lineage.rootRunId)) refuse();
  };
  const validateChild=(row:JsonRecord,child:NativeCancellationLineage["children"][number])=>{
    if (!(helper(child.agentId) || child.agentId === conversation.agentId) || !sameKey(row.key,child.sessionKey,child.agentId) || row.agentId !== child.agentId ||
      !sameKey(row.parentSessionKey,lineage.rootSessionKey,conversation.agentId) || child.sessionId !== null && row.sessionId !== child.sessionId ||
      typeof row.lastRunId === "string" && row.lastRunId !== child.runId ||
      Array.isArray(row.activeRunIds) && row.activeRunIds.some(id=>id!==child.runId)) refuse();
  };
  let sent=false;
  try {
  ports.assertCurrent();validateRoot(await ports.describe(conversation));ports.assertCurrent();
  // Validate the whole proposed set before the first externally consequential call.
  for(const child of lineage.children){validateChild(await ports.describe(child),child);ports.assertCurrent();}
  for(const child of lineage.children){ports.assertCurrent();sent=true;await ports.abort(child,child.runId);ports.assertCurrent();}
  validateRoot(await ports.describe(conversation));ports.assertCurrent();
  await ports.abort(conversation,lineage.rootRunId);ports.assertCurrent();
  for(const child of lineage.children){
    const row=await ports.describe(child);validateChild(row,child);ports.assertCurrent();
    if(row.hasActiveRun===true||row.status==="running"||row.status==="queued"||Array.isArray(row.activeRunIds)&&row.activeRunIds.length)
      throw Object.assign(Error("gateway_cancel_unconfirmed"),{code:"gateway_cancel_unconfirmed",outcome:"unknown"});
  }
  const root=await ports.describe(conversation);validateRoot(root);ports.assertCurrent();
  if(root.hasActiveRun===true||Array.isArray(root.activeRunIds)&&root.activeRunIds.length)
    throw Object.assign(Error("gateway_cancel_unconfirmed"),{code:"gateway_cancel_unconfirmed",outcome:"unknown"});
  } catch(error) {
    if(sent)throw Object.assign(Error("gateway_cancel_unconfirmed"),{code:"gateway_cancel_unconfirmed",outcome:"unknown"});
    throw error;
  }
}
