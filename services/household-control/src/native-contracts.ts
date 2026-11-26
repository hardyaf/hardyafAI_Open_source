import type { DatabaseSync } from "node:sqlite";

/** Content-free context-loading evidence; never capability or effect authority. */
export type LoadedNativeContract = { domainId: string; contractDigest: string };
export type NativeLoadedContractIdentity = {
  sessionKey: string; rootSessionKey: string; sourceId: string; parentSessionKey: string | null;
  agentId: string; sessionId: string | null; goalId: string | null; runId?: string | null;
  mode: "normal" | "brain_dump" | "diagnostic";
};
type GrantRow = {
  native_session_key: string; root_session_key: string; root_submission_id: string; parent_session_key: string | null;
  agent_id: string; native_session_id: string | null; native_goal_id: string | null; native_run_id: string | null;
  mode: string; loaded_contracts_json: string;
};

export class NativeLoadedContractProjection {
  private readonly db: DatabaseSync;
  constructor(db: DatabaseSync) { this.db = db; }
  private refusal(): never {
    throw Object.assign(Error("loaded_contract_required"), { code: "loaded_contract_required", httpStatus: 403 });
  }
  private metadata(value: LoadedNativeContract): void {
    if (!value || Object.keys(value).length !== 2 || typeof value.domainId !== "string" || typeof value.contractDigest !== "string" ||
      !/^[a-z][a-z0-9_-]{0,63}$/.test(value.domainId) || !/^[a-f0-9]{64}$/.test(value.contractDigest)) this.refusal();
  }
  private row(identity: NativeLoadedContractIdentity): GrantRow {
    for (const value of [identity.sessionKey, identity.rootSessionKey, identity.sourceId, identity.agentId])
      if (typeof value !== "string" || !value || value.length > 2048 || /[\x00-\x1f\x7f]/.test(value)) this.refusal();
    for (const value of [identity.parentSessionKey, identity.sessionId, identity.goalId, identity.runId ?? null])
      if (value !== null && (typeof value !== "string" || !value || value.length > 2048 || /[\x00-\x1f\x7f]/.test(value))) this.refusal();
    if (!["normal", "brain_dump", "diagnostic"].includes(identity.mode)) this.refusal();
    const row = this.db.prepare("SELECT native_session_key,root_session_key,root_submission_id,parent_session_key,agent_id,native_session_id,native_goal_id,native_run_id,mode,loaded_contracts_json FROM native_execution_grants WHERE native_session_key=?")
      .get(identity.sessionKey) as GrantRow | undefined;
    if (!row || row.root_session_key !== identity.rootSessionKey || row.root_submission_id !== identity.sourceId ||
      row.parent_session_key !== identity.parentSessionKey || row.agent_id !== identity.agentId ||
      row.native_session_id !== identity.sessionId || row.native_goal_id !== identity.goalId ||
      row.native_run_id !== (identity.runId ?? null) || row.mode !== identity.mode) this.refusal();
    return row;
  }
  private entries(row: GrantRow): LoadedNativeContract[] {
    if (typeof row.loaded_contracts_json !== "string" || Buffer.byteLength(row.loaded_contracts_json) > 8192) this.refusal();
    let parsed: unknown;
    try { parsed = JSON.parse(row.loaded_contracts_json); } catch { this.refusal(); }
    if (!Array.isArray(parsed) || parsed.length > 16) this.refusal();
    const seen = new Set<string>();
    for (const value of parsed) {
      if (!value || typeof value !== "object" || Array.isArray(value)) this.refusal();
      this.metadata(value);
      if (seen.has(value.domainId)) this.refusal();
      seen.add(value.domainId);
    }
    return parsed as LoadedNativeContract[];
  }
  private save(row: GrantRow, values: LoadedNativeContract[]): void {
    const result = this.db.prepare(`UPDATE native_execution_grants SET loaded_contracts_json=?
      WHERE native_session_key=? AND root_session_key=? AND root_submission_id=? AND parent_session_key IS ?
      AND agent_id=? AND native_session_id IS ? AND native_goal_id IS ? AND native_run_id IS ? AND mode=? AND loaded_contracts_json=?`)
      .run(JSON.stringify(values), row.native_session_key, row.root_session_key, row.root_submission_id, row.parent_session_key,
        row.agent_id, row.native_session_id, row.native_goal_id, row.native_run_id, row.mode, row.loaded_contracts_json);
    if (result.changes !== 1) this.refusal();
  }
  record(identity: NativeLoadedContractIdentity, metadata: LoadedNativeContract, assertCurrent: () => void): void {
    assertCurrent(); this.metadata(metadata); const row = this.row(identity), entries = this.entries(row);
    const index = entries.findIndex(value => value.domainId === metadata.domainId);
    if (index < 0) { if (entries.length >= 16) this.refusal(); entries.push({ ...metadata }); }
    else entries[index] = { ...metadata };
    entries.sort((a, b) => a.domainId.localeCompare(b.domainId));
    assertCurrent(); this.save(row, entries); assertCurrent(); this.row(identity);
  }
  assertLoaded(identity: NativeLoadedContractIdentity, metadata: LoadedNativeContract, assertCurrent: () => void): void {
    assertCurrent(); this.metadata(metadata); const row = this.row(identity);
    if (!this.entries(row).some(value => value.domainId === metadata.domainId && value.contractDigest === metadata.contractDigest)) this.refusal();
    assertCurrent(); if (this.row(identity).loaded_contracts_json !== row.loaded_contracts_json) this.refusal();
  }
  list(identity: NativeLoadedContractIdentity, assertCurrent: () => void): ReadonlyArray<LoadedNativeContract> {
    assertCurrent(); const row = this.row(identity), entries = this.entries(row);
    assertCurrent(); if (this.row(identity).loaded_contracts_json !== row.loaded_contracts_json) this.refusal();
    return entries.map(value => ({ ...value }));
  }
}
