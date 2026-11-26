import type { DatabaseSync } from "node:sqlite";
import type { ConnectionRecord, ConnectionsStore } from "./contracts.ts";

export const connectionMetadataMigration = `
  CREATE TABLE IF NOT EXISTS credential_connections (
    id TEXT PRIMARY KEY,
    owner_profile_id TEXT NOT NULL REFERENCES profiles(id),
    label TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('password','google','google_client')),
    secret_id TEXT NOT NULL,
    account TEXT,
    account_id TEXT,
    origin TEXT,
    preset TEXT,
    scopes_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('connected','disconnected','needs_reauthorization','unknown')),
    client_id TEXT,
    redirect_uri TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS credential_connections_owner
    ON credential_connections(owner_profile_id, updated_at);
`;

function fromRow(row: Record<string, unknown>): ConnectionRecord {
  return {
    id: String(row.id), ownerProfileId: String(row.owner_profile_id),
    label: String(row.label), kind: row.kind as ConnectionRecord["kind"],
    secretId: String(row.secret_id), scopes: JSON.parse(String(row.scopes_json)),
    status: row.status as ConnectionRecord["status"],
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    ...(row.account == null ? {} : { account: String(row.account) }),
    ...(row.account_id == null ? {} : { accountId: String(row.account_id) }),
    ...(row.origin == null ? {} : { origin: String(row.origin) }),
    ...(row.preset == null ? {} : { preset: row.preset as ConnectionRecord["preset"] }),
    ...(row.client_id == null ? {} : { clientId: String(row.client_id) }),
    ...(row.redirect_uri == null ? {} : { redirectUri: String(row.redirect_uri) }),
  };
}

/** Metadata in the existing household authority. Secret values remain in Bitwarden. */
export class ConnectionRepository implements ConnectionsStore {
  private readonly database: DatabaseSync;

  constructor(database: DatabaseSync) { this.database = database; }

  list(ownerProfileId: string): ConnectionRecord[] {
    return this.database.prepare("SELECT * FROM credential_connections WHERE owner_profile_id=? ORDER BY updated_at DESC,id")
      .all(ownerProfileId).map(row => fromRow(row));
  }

  get(ownerProfileId: string, id: string): ConnectionRecord | undefined {
    const row = this.database.prepare("SELECT * FROM credential_connections WHERE owner_profile_id=? AND id=?")
      .get(ownerProfileId, id);
    return row ? fromRow(row) : undefined;
  }

  save(record: ConnectionRecord): void {
    const result = this.database.prepare(`INSERT INTO credential_connections
      (id,owner_profile_id,label,kind,secret_id,account,account_id,origin,preset,scopes_json,status,client_id,redirect_uri,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET label=excluded.label,secret_id=excluded.secret_id,
        account=excluded.account,account_id=excluded.account_id,origin=excluded.origin,preset=excluded.preset,
        scopes_json=excluded.scopes_json,status=excluded.status,client_id=excluded.client_id,
        redirect_uri=excluded.redirect_uri,updated_at=excluded.updated_at
      WHERE credential_connections.owner_profile_id=excluded.owner_profile_id AND credential_connections.kind=excluded.kind`)
      .run(record.id, record.ownerProfileId, record.label, record.kind, record.secretId,
        record.account ?? null, record.accountId ?? null, record.origin ?? null, record.preset ?? null,
        JSON.stringify(record.scopes), record.status, record.clientId ?? null, record.redirectUri ?? null,
        record.createdAt, record.updatedAt);
    if (Number(result.changes) !== 1) throw new Error("connection_metadata_conflict");
  }
}
