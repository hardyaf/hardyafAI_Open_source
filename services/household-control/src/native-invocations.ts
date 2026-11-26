import type { DatabaseSync } from "node:sqlite";

function normalizedSessionKey(agentId: string, value: string) {
  const prefix = `agent:${agentId}:hardy-home:`;
  return value.startsWith(prefix) ? value.slice(`agent:${agentId}:`.length) : value;
}

export type NativeInvocationIdentity = {
  agentId: string; sessionKey: string; sessionId: string; toolCallId: string; toolName: string; argumentHash: string;
};
type PendingInvocation = NativeInvocationIdentity & { runId: string; sourceId: string; at: number };
type GrantRow = { native_session_key: string; agent_id: string; native_session_id: string | null;
  native_run_id: string | null; root_submission_id: string; invocations_json: string };

/** Exact-call projection of the existing native execution grant; never an admission authority. */
export class NativeInvocationProjection {
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  constructor(db: DatabaseSync, now: () => number = Date.now) { this.db = db; this.now = now; }
  private refusal(): never { throw Object.assign(Error("trusted_native_invocation_required"), { code: "trusted_native_invocation_required", httpStatus: 403 }); }
  private row(identity: NativeInvocationIdentity): GrantRow {
    for (const value of [identity.agentId, identity.sessionKey, identity.sessionId, identity.toolCallId, identity.toolName])
      if (typeof value !== "string" || !value || value.length > 2048 || /[\x00-\x1f\x7f]/.test(value)) this.refusal();
    if (!/^[a-f0-9]{64}$/.test(identity.argumentHash)) this.refusal();
    const row = this.db.prepare("SELECT native_session_key,agent_id,native_session_id,native_run_id,root_submission_id,invocations_json FROM native_execution_grants WHERE native_session_key=?")
      .get(normalizedSessionKey(identity.agentId, identity.sessionKey)) as GrantRow | undefined;
    if (!row || row.agent_id !== identity.agentId || row.native_session_id !== identity.sessionId || !row.native_run_id) this.refusal();
    return row;
  }
  private pending(row: GrantRow): PendingInvocation[] {
    let values: unknown;
    try { values = JSON.parse(row.invocations_json); } catch { this.refusal(); }
    if (!Array.isArray(values) || values.length > 256) this.refusal();
    const now = this.now();
    return values.filter((value): value is PendingInvocation => value && typeof value === "object" &&
      value.runId === row.native_run_id && value.sourceId === row.root_submission_id && value.sessionId === row.native_session_id &&
      Number.isSafeInteger(value.at) && value.at <= now && now - value.at < 600_000);
  }
  private save(row: GrantRow, values: PendingInvocation[]) {
    const result = this.db.prepare("UPDATE native_execution_grants SET invocations_json=? WHERE native_session_key=? AND agent_id=? AND native_session_id=? AND native_run_id=? AND root_submission_id=? AND invocations_json=?")
      .run(JSON.stringify(values), row.native_session_key, row.agent_id, row.native_session_id, row.native_run_id, row.root_submission_id, row.invocations_json);
    if (result.changes !== 1) this.refusal();
  }
  bind(identity: NativeInvocationIdentity, runId: string, assertCurrent: () => void): void {
    assertCurrent(); const row = this.row(identity);
    if (row.native_run_id !== runId) this.refusal();
    const pending = this.pending(row), previous = pending.find(value => value.toolCallId === identity.toolCallId);
    if (previous && (previous.toolName !== identity.toolName || previous.argumentHash !== identity.argumentHash)) this.refusal();
    if (!previous) {
      if (pending.length >= 256) this.refusal();
      pending.push({ ...identity, sessionKey: row.native_session_key, runId, sourceId: row.root_submission_id, at: this.now() });
    }
    assertCurrent(); this.save(row, pending); assertCurrent();
  }
  inspect(identity: NativeInvocationIdentity, assertCurrent: () => void): Readonly<{ runId: string; sourceId: string }> {
    assertCurrent(); const row = this.row(identity), receipt = this.pending(row).find(value => value.toolCallId === identity.toolCallId);
    if (!receipt || receipt.agentId !== identity.agentId || receipt.toolName !== identity.toolName || receipt.argumentHash !== identity.argumentHash) this.refusal();
    assertCurrent(); return { runId: receipt.runId, sourceId: receipt.sourceId };
  }
  claim(identity: NativeInvocationIdentity, expected: Readonly<{ runId: string; sourceId: string }>, assertCurrent: () => void): void {
    assertCurrent(); const row = this.row(identity), pending = this.pending(row);
    const index = pending.findIndex(value => value.toolCallId === identity.toolCallId && value.agentId === identity.agentId &&
      value.toolName === identity.toolName && value.argumentHash === identity.argumentHash);
    if (index < 0 || row.native_run_id !== expected.runId || row.root_submission_id !== expected.sourceId) this.refusal();
    pending.splice(index, 1); assertCurrent(); this.save(row, pending); assertCurrent();
  }
}
