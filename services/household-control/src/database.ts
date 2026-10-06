import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  Conversation,
  FamilyProfile,
  PromptPreset,
  SubmissionReceipt,
} from "./domain.ts";
import { presets as seedPresets, profiles as seedProfiles } from "./mock-data.ts";

type DatabaseRow = Record<string, unknown>;

function codeHash(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

function asString(value: unknown): string {
  if (typeof value !== "string") throw new Error("invalid_database_value");
  return value;
}

function asNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : asString(value);
}

function profileFromRow(row: DatabaseRow): FamilyProfile {
  return {
    id: asString(row.id),
    displayName: asString(row.display_name),
    initials: asString(row.initials),
    agentId: asString(row.agent_id),
    role: asString(row.role) as FamilyProfile["role"],
    color: asString(row.color),
    status: asString(row.status) as FamilyProfile["status"],
    statusDetail: asString(row.status_detail),
    capabilities: JSON.parse(asString(row.capabilities_json)),
  };
}

function conversationFromRow(row: DatabaseRow): Conversation {
  return {
    id: asString(row.id),
    ownerProfileId: asString(row.owner_profile_id),
    agentId: asString(row.agent_id),
    sessionKey: asString(row.session_key),
    title: asString(row.title),
    presetId: asNullableString(row.preset_id),
    audience: asString(row.audience) as Conversation["audience"],
    updatedAt: asString(row.updated_at),
  };
}

export class HouseholdDatabase {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.migrate();
    this.seed();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        initials TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin','adult','child')),
        color TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('available','working','queued','paused','offline')),
        status_detail TEXT NOT NULL,
        capabilities_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS presets (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        description TEXT NOT NULL,
        allowed_roles_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES profiles(id),
        display_name TEXT NOT NULL,
        public_key_der_base64 TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active','revoked')) DEFAULT 'active',
        enrolled_at TEXT NOT NULL,
        last_seen_at TEXT
      );
      CREATE TABLE IF NOT EXISTS enrollment_invitations (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES profiles(id),
        code_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        claimed_at TEXT,
        device_id TEXT REFERENCES devices(id),
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS auth_nonces (
        device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        nonce TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        PRIMARY KEY (device_id, nonce)
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        owner_profile_id TEXT NOT NULL REFERENCES profiles(id),
        agent_id TEXT NOT NULL,
        session_key TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        preset_id TEXT REFERENCES presets(id),
        audience TEXT NOT NULL CHECK (audience IN ('private','household')) DEFAULT 'private',
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS conversations_owner_updated
        ON conversations(owner_profile_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS submissions (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id),
        profile_id TEXT NOT NULL REFERENCES profiles(id),
        agent_id TEXT NOT NULL,
        text_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        queue_position INTEGER,
        run_id TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO schema_migrations(version, applied_at)
        VALUES (1, datetime('now'));
    `);
  }

  private seed() {
    const insertProfile = this.db.prepare(`
      INSERT INTO profiles(id, display_name, initials, agent_id, role, color, status, status_detail, capabilities_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        agent_id=excluded.agent_id,
        role=excluded.role,
        color=excluded.color,
        capabilities_json=excluded.capabilities_json
    `);
    for (const profile of seedProfiles) {
      const alphaStatus = profile.id === "alex" ? "available" : "offline";
      const alphaDetail = profile.id === "alex" ? "Ready" : "Not enrolled in connected alpha";
      insertProfile.run(
        profile.id,
        profile.displayName,
        profile.initials,
        profile.agentId,
        profile.role,
        profile.color,
        alphaStatus,
        alphaDetail,
        JSON.stringify(profile.capabilities),
      );
    }
    const insertPreset = this.db.prepare(`
      INSERT INTO presets(id, label, description, allowed_roles_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        label=excluded.label,
        description=excluded.description,
        allowed_roles_json=excluded.allowed_roles_json
    `);
    for (const preset of seedPresets) {
      insertPreset.run(preset.id, preset.label, preset.description, JSON.stringify(preset.allowedRoles));
    }
  }

  getProfile(profileId: string): FamilyProfile | undefined {
    const row = this.db.prepare("SELECT * FROM profiles WHERE id = ?").get(profileId) as DatabaseRow | undefined;
    return row ? profileFromRow(row) : undefined;
  }

  listProfiles(): FamilyProfile[] {
    return (this.db.prepare("SELECT * FROM profiles ORDER BY rowid").all() as DatabaseRow[]).map(profileFromRow);
  }

  setProfileStatus(profileId: string, status: FamilyProfile["status"], detail: string) {
    this.db.prepare("UPDATE profiles SET status = ?, status_detail = ? WHERE id = ?").run(status, detail, profileId);
  }

  listPresets(): PromptPreset[] {
    return (this.db.prepare("SELECT * FROM presets ORDER BY rowid").all() as DatabaseRow[]).map((row) => ({
      id: asString(row.id),
      label: asString(row.label),
      description: asString(row.description),
      allowedRoles: JSON.parse(asString(row.allowed_roles_json)),
    }));
  }

  listConversations(profileId: string): Conversation[] {
    return (this.db.prepare(`
      SELECT * FROM conversations
      WHERE owner_profile_id = ? OR audience = 'household'
      ORDER BY updated_at DESC
    `).all(profileId) as DatabaseRow[]).map(conversationFromRow);
  }

  getConversation(conversationId: string): Conversation | undefined {
    const row = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId) as DatabaseRow | undefined;
    return row ? conversationFromRow(row) : undefined;
  }

  findConversationBySessionKey(sessionKey: string): Conversation | undefined {
    const marker = sessionKey.indexOf("hardy-home:");
    const storedKey = marker >= 0 ? sessionKey.slice(marker) : sessionKey;
    const row = this.db.prepare("SELECT * FROM conversations WHERE session_key = ?").get(storedKey) as DatabaseRow | undefined;
    return row ? conversationFromRow(row) : undefined;
  }

  insertConversation(conversation: Conversation) {
    this.db.prepare(`
      INSERT INTO conversations(id, owner_profile_id, agent_id, session_key, title, preset_id, audience, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      conversation.id,
      conversation.ownerProfileId,
      conversation.agentId,
      conversation.sessionKey,
      conversation.title,
      conversation.presetId,
      conversation.audience,
      conversation.updatedAt,
    );
  }

  touchConversation(conversationId: string) {
    this.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), conversationId);
  }

  createInvitation(profileId: string, ttlMinutes = 15, requestedCode?: string): { code: string; expiresAt: string } {
    if (!this.getProfile(profileId)) throw new Error("profile_not_found");
    const code = (requestedCode ?? randomBytes(15).toString("base64url")).trim().toUpperCase();
    if (!/^[A-Z0-9_-]{8,64}$/.test(code)) {
      throw new Error("Enrollment code must contain 8-64 letters, numbers, underscores, or hyphens");
    }
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000).toISOString();
    this.db.prepare(`
      INSERT INTO enrollment_invitations(id, profile_id, code_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(randomUUID(), profileId, codeHash(code), expiresAt, now.toISOString());
    return { code, expiresAt };
  }

  claimInvitation(args: {
    code: string;
    displayName: string;
    publicKeyDerBase64: string;
  }): { deviceId: string; profile: FamilyProfile } | undefined {
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const invitation = this.db.prepare(`
        SELECT * FROM enrollment_invitations
        WHERE code_hash = ? AND claimed_at IS NULL AND expires_at > ?
      `).get(codeHash(args.code), now) as DatabaseRow | undefined;
      if (!invitation) {
        this.db.exec("ROLLBACK");
        return undefined;
      }
      const deviceId = `device-${randomUUID()}`;
      this.db.prepare(`
        INSERT INTO devices(id, profile_id, display_name, public_key_der_base64, enrolled_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(deviceId, asString(invitation.profile_id), args.displayName, args.publicKeyDerBase64, now);
      const result = this.db.prepare(`
        UPDATE enrollment_invitations SET claimed_at = ?, device_id = ?
        WHERE id = ? AND claimed_at IS NULL
      `).run(now, deviceId, asString(invitation.id));
      if (Number(result.changes) !== 1) throw new Error("invitation_claim_race");
      this.db.exec("COMMIT");
      const profile = this.getProfile(asString(invitation.profile_id));
      if (!profile) throw new Error("profile_not_found");
      return { deviceId, profile };
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  getDevice(deviceId: string): {
    id: string;
    profileId: string;
    publicKeyDerBase64: string;
    status: string;
  } | undefined {
    const row = this.db.prepare("SELECT * FROM devices WHERE id = ?").get(deviceId) as DatabaseRow | undefined;
    if (!row) return undefined;
    return {
      id: asString(row.id),
      profileId: asString(row.profile_id),
      publicKeyDerBase64: asString(row.public_key_der_base64),
      status: asString(row.status),
    };
  }

  recordDeviceSeen(deviceId: string) {
    this.db.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(new Date().toISOString(), deviceId);
  }

  revokeDevice(deviceId: string): boolean {
    const result = this.db.prepare("UPDATE devices SET status = 'revoked' WHERE id = ? AND status = 'active'").run(deviceId);
    return Number(result.changes) === 1;
  }

  consumeNonce(deviceId: string, nonce: string, expiresAt: string): boolean {
    this.db.prepare("DELETE FROM auth_nonces WHERE expires_at <= ?").run(new Date().toISOString());
    try {
      this.db.prepare("INSERT INTO auth_nonces(device_id, nonce, expires_at) VALUES (?, ?, ?)")
        .run(deviceId, nonce, expiresAt);
      return true;
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) return false;
      throw error;
    }
  }

  getSubmission(submissionId: string): { textHash: string; receipt: SubmissionReceipt } | undefined {
    const row = this.db.prepare("SELECT * FROM submissions WHERE id = ?").get(submissionId) as DatabaseRow | undefined;
    if (!row) return undefined;
    return {
      textHash: asString(row.text_hash),
      receipt: {
        submissionId: asString(row.id),
        conversationId: asString(row.conversation_id),
        profileId: asString(row.profile_id),
        agentId: asString(row.agent_id),
        status: asString(row.status) as SubmissionReceipt["status"],
        queuePosition: row.queue_position === null ? null : Number(row.queue_position),
        runId: asNullableString(row.run_id),
      },
    };
  }

  insertSubmission(args: {
    submissionId: string;
    conversationId: string;
    profileId: string;
    agentId: string;
    textHash: string;
    status: SubmissionReceipt["status"];
    queuePosition: number | null;
  }) {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO submissions(id, conversation_id, profile_id, agent_id, text_hash, status, queue_position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      args.submissionId,
      args.conversationId,
      args.profileId,
      args.agentId,
      args.textHash,
      args.status,
      args.queuePosition,
      now,
      now,
    );
  }

  updateSubmission(receipt: SubmissionReceipt, error?: string) {
    this.db.prepare(`
      UPDATE submissions SET status = ?, queue_position = ?, run_id = ?, last_error = ?, updated_at = ?
      WHERE id = ?
    `).run(
      receipt.status,
      receipt.queuePosition,
      receipt.runId,
      error ?? null,
      new Date().toISOString(),
      receipt.submissionId,
    );
  }

  updateRunBySession(sessionKey: string, runId: string | null, status: SubmissionReceipt["status"]) {
    const conversation = this.findConversationBySessionKey(sessionKey);
    if (!conversation) return;
    if (runId) {
      this.db.prepare(`
        UPDATE submissions SET status = ?, updated_at = ?
        WHERE conversation_id = ? AND run_id = ?
      `).run(status, new Date().toISOString(), conversation.id, runId);
    }
  }

  listActiveSubmissions(): Array<{
    receipt: SubmissionReceipt;
    createdAt: string;
  }> {
    const rows = this.db.prepare(`
      SELECT * FROM submissions
      WHERE status IN ('dispatching', 'running')
      ORDER BY created_at DESC
    `).all() as DatabaseRow[];
    return rows.map((row) => ({
      receipt: {
        submissionId: asString(row.id),
        conversationId: asString(row.conversation_id),
        profileId: asString(row.profile_id),
        agentId: asString(row.agent_id),
        status: asString(row.status) as SubmissionReceipt["status"],
        queuePosition: row.queue_position === null ? null : Number(row.queue_position),
        runId: asNullableString(row.run_id),
      },
      createdAt: asString(row.created_at),
    }));
  }

  close() {
    this.db.close();
  }
}
