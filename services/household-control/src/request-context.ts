import {NativeInvocationProjection} from "./native-invocations.ts";
import {NativeLoadedContractProjection} from "./native-contracts.ts";
import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";

/** Immutable admission metadata. Native sessions/goals remain execution authority. */
export type MessageTaskContext = {
  mode: "conversation" | "task" | "brain_dump" | "diagnostic";
  artifactIds: string[];
  replyToQuestionId?: string;
  expectedGoalId?: string|null;
  expectedSessionId?: string;
  admittedAtMs?: number;
  goalStartDispatchAtMs?: number;
  sourceArtifactId?: string;
  sourceReferenceId?: string;
  /** Trusted native job snapshot only; HTTP parsing never accepts these grants. */
  scheduledTools?: string[];
  scheduledRevision?: string;
  /** Trusted owner-assigned lineage/routes. The HTTP parser never copies these fields. */
  independentTopicOf?:string;
  independentSourcePromptId?:string;
  questionRootSourceId?:string;
  scheduledScope?:"personal"|"household";
  scheduledDelivery?:{mode:"none"}|({mode:"announce"}&import("./domains/native-contracts.ts").NativeDeliveryTarget);
  focus?: { kind: "contact" | "receipt" | "wiki" | "list_item"; id: string; revision?: number; scope?: "personal" | "household" };
  approval?: { questionId: string; decision: "approve" | "reject" };
  origin?: { kind: "discord" | "scheduled"; externalUserId?: string; channelId?: string; jobId?: string; sourceId: string; shared: boolean; confirmedHuman?:boolean };
};
export function parseMessageTaskContext(body: Record<string, unknown>): MessageTaskContext {
  const mode = body.mode ?? "conversation";
  if (!["conversation", "task", "brain_dump", "diagnostic"].includes(String(mode))) throw Error("invalid_task_mode");
  const artifactIds = body.artifactIds ?? [];
  if (!Array.isArray(artifactIds) || artifactIds.length > 12 || artifactIds.some(id => typeof id !== "string" || !/^artifact-[a-f0-9]{64}$/.test(id)) || new Set(artifactIds).size !== artifactIds.length) throw Error("invalid_artifact_references");
  const result: MessageTaskContext = { mode: mode as MessageTaskContext["mode"], artifactIds };
  if (body.replyToQuestionId !== undefined) {
    if (typeof body.replyToQuestionId !== "string" || !/^artifact-[a-f0-9]{64}$/.test(body.replyToQuestionId)) throw Error("invalid_question_reference");
    result.replyToQuestionId = body.replyToQuestionId;
  }
  if (body.focus !== undefined) {
    const focus = body.focus as Record<string,unknown>;
    if (!focus || typeof focus !== "object" || Array.isArray(focus) || Object.keys(focus).some(k => !["kind","id","revision","scope"].includes(k)) ||
      !["contact","receipt","wiki","list_item"].includes(String(focus.kind)) || typeof focus.id !== "string" || !focus.id || focus.id.length > 256 || /[\x00-\x1f\x7f]/.test(focus.id) ||
      focus.revision !== undefined && (!Number.isSafeInteger(focus.revision) || Number(focus.revision) < 1) || focus.scope !== undefined && !["personal","household"].includes(String(focus.scope))) throw Error("invalid_focus");
    result.focus = focus as MessageTaskContext["focus"];
  }
  if (body.approval !== undefined) {
    const approval = body.approval as Record<string,unknown>;
    if (!approval || typeof approval !== "object" || Array.isArray(approval) || Object.keys(approval).some(k => !["questionId","decision"].includes(k)) ||
      typeof approval.questionId !== "string" || !/^artifact-[a-f0-9]{64}$/.test(approval.questionId) || !["approve","reject"].includes(String(approval.decision)) ||
      result.replyToQuestionId !== approval.questionId) throw Error("invalid_approval");
    result.approval = approval as MessageTaskContext["approval"];
  }
  return result;
}

export const executionAuthorityMigration = `
CREATE TABLE IF NOT EXISTS native_execution_grants (
 native_session_key TEXT PRIMARY KEY, root_session_key TEXT NOT NULL,
 root_submission_id TEXT NOT NULL REFERENCES submissions(id), parent_session_key TEXT,
 agent_id TEXT NOT NULL, native_session_id TEXT, native_goal_id TEXT, native_run_id TEXT,
 mode TEXT NOT NULL CHECK(mode IN ('normal','brain_dump','diagnostic')), invocations_json TEXT NOT NULL DEFAULT '[]', loaded_contracts_json TEXT NOT NULL DEFAULT '[]',
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS native_execution_grants_root ON native_execution_grants(root_submission_id);
CREATE TABLE IF NOT EXISTS display_publications (
 id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL, owner_profile_id TEXT NOT NULL REFERENCES profiles(id),
 source_prompt_id TEXT NOT NULL REFERENCES submissions(id), title TEXT NOT NULL,
 expires_at TEXT NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL, manifest_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS control_receipts (
 operation_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id),
 request_hash TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL
);`;
export type ExecutionGrant = { sessionKey:string;rootSessionKey:string;sourceId:string;parentSessionKey:string|null;agentId:string;sessionId:string|null;goalId:string|null;runId?:string|null;mode:"normal"|"brain_dump"|"diagnostic" };
export class ExecutionAuthorityRepository {
  private readonly db: DatabaseSync;
  readonly invocations:NativeInvocationProjection;
  readonly contracts:NativeLoadedContractProjection;
  constructor(db: DatabaseSync) {this.db=db;this.invocations=new NativeInvocationProjection(db);this.contracts=new NativeLoadedContractProjection(db);}
  packet(sourceId:string): MessageTaskContext | null {
    const row = this.db.prepare("SELECT task_context_json FROM submissions WHERE id=?").get(sourceId) as {task_context_json:string|null}|undefined;
    return row?.task_context_json ? JSON.parse(row.task_context_json) : null;
  }
  get(sessionKey:string): ExecutionGrant | null {
    const row = this.db.prepare("SELECT * FROM native_execution_grants WHERE native_session_key=?").get(sessionKey) as Record<string,unknown>|undefined;
    return row ? {sessionKey:String(row.native_session_key),rootSessionKey:String(row.root_session_key),sourceId:String(row.root_submission_id),parentSessionKey:row.parent_session_key as string|null,agentId:String(row.agent_id),sessionId:row.native_session_id as string|null,goalId:row.native_goal_id as string|null,runId:row.native_run_id as string|null,mode:row.mode as ExecutionGrant["mode"]} : null;
  }
  childrenForSource(rootSessionKey:string,sourceId:string):ExecutionGrant[]{
    const rows=this.db.prepare("SELECT native_session_key FROM native_execution_grants WHERE root_session_key=? AND root_submission_id=? AND parent_session_key IS NOT NULL ORDER BY native_session_key").all(rootSessionKey,sourceId) as Array<{native_session_key:string}>;
    return rows.map(row=>this.get(row.native_session_key)).filter((value):value is ExecutionGrant=>value!==null);
  }
  bind(value:ExecutionGrant) {
    const previous=this.get(value.sessionKey);
    // A diagnostic goal is sticky across answers, native continuations and children.
    if(previous&&["diagnostic","brain_dump"].includes(previous.mode)&&previous.goalId&&previous.goalId===value.goalId&&value.mode==="normal")value={...value,mode:previous.mode};
    const now=new Date().toISOString();
    this.db.prepare(`INSERT INTO native_execution_grants(native_session_key,root_session_key,root_submission_id,parent_session_key,agent_id,native_session_id,native_goal_id,native_run_id,mode,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(native_session_key) DO UPDATE SET root_session_key=excluded.root_session_key,root_submission_id=excluded.root_submission_id,parent_session_key=excluded.parent_session_key,agent_id=excluded.agent_id,native_session_id=excluded.native_session_id,native_goal_id=excluded.native_goal_id,native_run_id=excluded.native_run_id,mode=excluded.mode,
      invocations_json=CASE WHEN native_execution_grants.root_submission_id=excluded.root_submission_id
        AND native_execution_grants.agent_id=excluded.agent_id AND native_execution_grants.native_session_id IS excluded.native_session_id
        AND native_execution_grants.native_run_id IS excluded.native_run_id AND native_execution_grants.native_goal_id IS excluded.native_goal_id
        AND native_execution_grants.root_session_key=excluded.root_session_key AND native_execution_grants.parent_session_key IS excluded.parent_session_key
        AND native_execution_grants.mode=excluded.mode THEN native_execution_grants.invocations_json ELSE '[]' END,
      loaded_contracts_json=CASE WHEN native_execution_grants.root_submission_id=excluded.root_submission_id
        AND native_execution_grants.agent_id=excluded.agent_id AND native_execution_grants.native_session_id IS excluded.native_session_id
        AND native_execution_grants.native_run_id IS excluded.native_run_id AND native_execution_grants.native_goal_id IS excluded.native_goal_id
        AND native_execution_grants.root_session_key=excluded.root_session_key AND native_execution_grants.parent_session_key IS excluded.parent_session_key
        AND native_execution_grants.mode=excluded.mode THEN native_execution_grants.loaded_contracts_json ELSE '[]' END,
      updated_at=excluded.updated_at`)
      .run(value.sessionKey,value.rootSessionKey,value.sourceId,value.parentSessionKey,value.agentId,value.sessionId,value.goalId,value.runId??null,value.mode,now,now);
  }
  bindChildSessionId(sessionKey:string,agentId:string,sessionId:string,runId:string,assertCurrent:()=>void):void {
    assertCurrent();const grant=this.get(sessionKey);
    const refuse=()=>{throw Object.assign(Error("trusted_native_invocation_required"),{code:"trusted_native_invocation_required",httpStatus:403});};
    if(!grant||grant.agentId!==agentId||grant.runId!==runId||!sessionId)refuse();
    if(grant!.sessionId!==null){if(grant!.sessionId!==sessionId)refuse();return;}
    if(!grant!.parentSessionKey)refuse();
    assertCurrent();const result=this.db.prepare(`UPDATE native_execution_grants SET native_session_id=?,invocations_json='[]',loaded_contracts_json='[]',updated_at=?
      WHERE native_session_key=? AND agent_id=? AND native_session_id IS NULL AND native_run_id=? AND root_submission_id=?
      AND root_session_key=? AND parent_session_key=? AND native_goal_id IS ? AND mode=?`)
      .run(sessionId,new Date().toISOString(),sessionKey,agentId,runId,grant!.sourceId,grant!.rootSessionKey,grant!.parentSessionKey,grant!.goalId,grant!.mode);
    if(result.changes!==1)refuse();assertCurrent();
  }
  control(operationId:string,conversationId:string,request:unknown):unknown|null {
    const row=this.db.prepare("SELECT * FROM control_receipts WHERE operation_id=?").get(operationId) as Record<string,unknown>|undefined;
    if(!row)return null;
    if(row.conversation_id!==conversationId || row.request_hash!==this.hash(request))throw Error("control_operation_conflict");
    return JSON.parse(String(row.result_json));
  }
  prepareControl(operationId:string,conversationId:string,request:unknown):{issuedAtMs:number;phase:string}{
    const prior=this.control(operationId,conversationId,request) as {issuedAtMs?:number;phase?:string}|null;
    if(prior){if(!Number.isSafeInteger(prior.issuedAtMs))throw Error("control_operation_conflict");return prior as {issuedAtMs:number;phase:string};}
    const value={issuedAtMs:Date.now(),phase:"prepared"};this.recordControl(operationId,conversationId,request,value);return value;
  }
  finishControl(operationId:string,conversationId:string,request:unknown,result:unknown){
    if(!this.control(operationId,conversationId,request))throw Error("control_operation_conflict");
    this.db.prepare("UPDATE control_receipts SET result_json=? WHERE operation_id=? AND conversation_id=? AND request_hash=?").run(JSON.stringify(result),operationId,conversationId,this.hash(request));
  }
  recordControl(operationId:string,conversationId:string,request:unknown,result:unknown){
    this.db.prepare("INSERT INTO control_receipts(operation_id,conversation_id,request_hash,result_json,created_at) VALUES (?,?,?,?,?)").run(operationId,conversationId,this.hash(request),JSON.stringify(result),new Date().toISOString());
  }
  private hash(value:unknown){return createHash("sha256").update(JSON.stringify(value)).digest("hex");}
}
