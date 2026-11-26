import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { DomainError, fingerprint, safeOperationId } from "./common.ts";
import type { DomainPrincipal } from "./common.ts";

// An effect receipt registry, not a job queue or an alternative task authority.
export const domainEffectMigrationSql = `
CREATE TABLE IF NOT EXISTS domain_effects (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  source_prompt_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('started','committed','failed','unknown')),
  owner_token TEXT,
  expires_at TEXT,
  result_json TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(profile_id,operation_id)
);
CREATE INDEX IF NOT EXISTS domain_effects_conversation ON domain_effects(conversation_id,created_at);
`;

type Row = { id: string; tool_name: string; request_hash: string; conversation_id: string; state: string;
  result_json: string | null; expires_at: string | null; error_code: string | null };
export class DomainEffectStore {
  private readonly database: DatabaseSync;
  constructor(database: DatabaseSync) { this.database=database; }
  private transaction<T>(fn: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try { const result = fn(); this.database.exec("COMMIT"); return result; }
    catch (error) { try { this.database.exec("ROLLBACK"); } catch {} throw error; }
  }
  begin(principal: DomainPrincipal, tool: string, operationId: string, args: unknown, options: {resumable?:boolean} = {}): { id: string; token: string } | { replayed: true } {
    if (!safeOperationId(operationId)) throw new DomainError("operation_id_required");
    principal.assertCurrent();
    return this.transaction(() => {
      principal.assertCurrent();
      const requestHash = fingerprint({ tool, conversationId: principal.conversationId, authorization:principal.authorizationFingerprint, args });
      const row = this.database.prepare("SELECT * FROM domain_effects WHERE profile_id=? AND operation_id=?")
        .get(principal.profileId, operationId) as Row | undefined;
      if (row) {
        if (row.request_hash !== requestHash || row.tool_name !== tool || row.conversation_id !== principal.conversationId)
          throw new DomainError("operation_conflict", { httpStatus: 409 });
        if (row.state === "committed") return { replayed: true };
        if(options.resumable===true && ["household_memory_source_forget","household_memory_source_supersede","household_memory_remember"].includes(tool) &&
          (row.state === "unknown" && row.error_code === "memory_projection_refresh_required" || row.state === "started" && row.expires_at && Date.parse(row.expires_at)<=Date.now())){
          const token=randomUUID();this.database.prepare("UPDATE domain_effects SET state='started',owner_token=?,expires_at=?,error_code=NULL,updated_at=? WHERE id=?").run(token,new Date(Date.now()+600_000).toISOString(),new Date().toISOString(),row.id);return {id:row.id,token};
        }
        if (row.state === "failed") throw new DomainError(row.error_code ?? "operation_previously_failed", { httpStatus: 409 });
        // No automatic replay of an externally consequential operation after interruption.
        throw new DomainError(row.state === "started" && row.expires_at && Date.parse(row.expires_at) > Date.now()
          ? "operation_in_progress" : "operation_outcome_unknown", { outcome: "unknown", httpStatus: 409 });
      }
      const id = randomUUID(), token = randomUUID(), now = new Date().toISOString();
      this.database.prepare(`INSERT INTO domain_effects(id,operation_id,profile_id,conversation_id,source_prompt_id,
        tool_name,request_hash,state,owner_token,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'started',?,?,?,?)`)
        .run(id,operationId,principal.profileId,principal.conversationId,principal.sourcePromptId,tool,requestHash,token,
          new Date(Date.now()+600_000).toISOString(),now,now);
      return { id, token };
    });
  }
  commit(id: string, token: string, result: unknown): void {
    let value:string;
    try{const encoded=JSON.stringify(result);if(typeof encoded!=="string")throw Error();value=encoded;}
    catch{throw new DomainError("effect_receipt_serialization_unknown",{outcome:"unknown"});}
    if (Buffer.byteLength(value) > 512 * 1024) throw new DomainError("effect_receipt_too_large", { outcome: "unknown" });
    const changed = this.database.prepare(`UPDATE domain_effects SET state='committed',result_json=?,owner_token=NULL,
      expires_at=NULL,error_code=NULL,updated_at=? WHERE id=? AND owner_token=? AND state='started'`)
      .run(value,new Date().toISOString(),id,token).changes;
    if (Number(changed)!==1) throw new DomainError("effect_receipt_commit_unknown", { outcome: "unknown" });
  }
  fail(id: string, token: string, code: string, outcome: "not_sent" | "unknown"): void {
    this.database.prepare(`UPDATE domain_effects SET state=?,error_code=?,owner_token=NULL,expires_at=NULL,
      updated_at=? WHERE id=? AND owner_token=? AND state='started'`)
      .run(outcome === "not_sent" ? "failed" : "unknown",code,new Date().toISOString(),id,token);
  }
  inspect(principal: DomainPrincipal, operationId: string): unknown {
    principal.assertCurrent();
    const row = this.database.prepare(`SELECT operation_id AS operationId,tool_name AS tool,state,error_code AS errorCode,
      expires_at AS expiresAt,created_at AS createdAt,updated_at AS updatedAt,result_json AS resultJson
      FROM domain_effects WHERE profile_id=? AND conversation_id=? AND operation_id=?`)
      .get(principal.profileId,principal.conversationId,operationId) as Record<string,unknown> | undefined;
    if (!row) return null;
    const { resultJson, ...safe } = row;
    if (safe.state === "started" && typeof safe.expiresAt === "string" && Date.parse(safe.expiresAt) <= Date.now()) {
      safe.state="unknown"; safe.errorCode="operation_outcome_unknown";
    }
    // A status lookup never republishes cached domain content after a resource grant changes.
    return { ...safe, resultRecorded:typeof resultJson === "string" };
  }
  summary(conversationId:string): unknown {
    const now=new Date().toISOString();return this.database.prepare(`SELECT CASE WHEN state='started' AND expires_at<=? THEN 'unknown' ELSE state END AS state,
      count(*) AS count FROM domain_effects WHERE conversation_id=? GROUP BY CASE WHEN state='started' AND expires_at<=? THEN 'unknown' ELSE state END`)
      .all(now,conversationId,now);
  }
}
