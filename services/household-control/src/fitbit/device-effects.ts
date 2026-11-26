import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { fitbitError } from "./contracts.ts";

// Device-control receipts in the existing application database, never a job queue.
export const deviceEffectsMigrationSql = `
CREATE TABLE IF NOT EXISTS device_effects (
 profile_id TEXT NOT NULL REFERENCES profiles(id),
 operation_id TEXT NOT NULL,
 device_id TEXT NOT NULL REFERENCES devices(id),
 operation TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('started','committed','failed','unknown')),
 result_json TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(profile_id,operation_id)
);`;
type ReceiptRow = { device_id: string; request_hash: string; state: string; result_json: string | null };
export class DeviceEffectStore {
  private readonly database: DatabaseSync;
  constructor(database: DatabaseSync) { this.database = database; }
  begin(profileId: string, deviceId: string, operationId: string, operation: string, binding: unknown) {
    const hash = createHash("sha256").update(JSON.stringify({ operation, binding })).digest("hex");
    const row = this.database.prepare("SELECT device_id,request_hash,state,result_json FROM device_effects WHERE profile_id=? AND operation_id=?")
      .get(profileId, operationId) as ReceiptRow | undefined;
    if (row) {
      if (row.device_id !== deviceId || row.request_hash !== hash) throw fitbitError("fitbit_operation_conflict", 409);
      if (row.state === "committed" && row.result_json) return { replayed: true as const, result: JSON.parse(row.result_json) };
      if (row.state === "failed") throw fitbitError("fitbit_operation_previously_failed",409);
      // Never restart an expired/stopped session by blindly replaying an ambiguous request.
      throw fitbitError("fitbit_operation_unconfirmed", 409);
    }
    const at = new Date().toISOString();
    this.database.prepare("INSERT INTO device_effects(profile_id,operation_id,device_id,operation,request_hash,state,created_at,updated_at) VALUES (?,?,?,?,?,'started',?,?)")
      .run(profileId, operationId, deviceId, operation, hash, at, at);
    return { replayed: false as const };
  }
  finish(profileId: string, operationId: string, state: "committed" | "failed" | "unknown", result?: unknown) {
    this.database.prepare("UPDATE device_effects SET state=?,result_json=?,updated_at=? WHERE profile_id=? AND operation_id=? AND state='started'")
      .run(state, result === undefined ? null : JSON.stringify(result), new Date().toISOString(), profileId, operationId);
  }
}
