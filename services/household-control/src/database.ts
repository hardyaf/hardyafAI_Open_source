import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  Conversation,
  HouseholdCheckpoint,
  HouseholdCheckpointUpdate,
  FamilyProfile,
  PromptPreset,
  SubmissionReceipt,
} from "./domain.ts";
import { presets as seedPresets, profiles as seedProfiles } from "./mock-data.ts";
import { executionAuthorityMigration } from "./request-context.ts";
import { SubmissionRepository } from "./submission-repository.ts";
import { contactsMigrationSql } from "./domains/contacts/schema.ts";
import { domainEffectMigrationSql } from "./domain-runtime/effect-store.ts";
import { deviceEffectsMigrationSql } from "./fitbit/device-effects.ts";
import { connectionMetadataMigration } from "./connections/repository.ts";
import { conversationOrganizationMigration } from "./conversation-organization.ts";

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
    tags: JSON.parse(asString(row.tags_json)),
    folderId: asNullableString(row.folder_id), deletedAt: asNullableString(row.deleted_at),
    presetId: asNullableString(row.preset_id),
    audience: asString(row.audience) as Conversation["audience"],
    updatedAt: asString(row.updated_at),
  };
}

export class HouseholdDatabase {
  private readonly db: DatabaseSync;
  readonly submissions: SubmissionRepository;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.migrate();
    this.submissions = new SubmissionRepository(this.db);
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
    // Additive v2 migration: retain the original submission ledger and native execution owner.
    const columns = new Set((this.db.prepare("PRAGMA table_info(submissions)").all() as DatabaseRow[]).map(row => String(row.name)));
    const additions: Array<[string,string]> = [
      ["task_context_json","TEXT"],["payload_json","TEXT"],["request_hash","TEXT"],["origin_device_id","TEXT"],
      ["attempt_count","INTEGER NOT NULL DEFAULT 0"],["next_attempt_at","TEXT"],
      ["lease_token","TEXT"],["lease_expires_at","TEXT"],["dispatch_started_at","TEXT"],
      ["recovery_required","INTEGER NOT NULL DEFAULT 0"],["goal_id","TEXT"],
    ];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const [name,type] of additions) if (!columns.has(name)) this.db.exec(`ALTER TABLE submissions ADD COLUMN ${name} ${type}`);
      const conversationColumns = new Set((this.db.prepare("PRAGMA table_info(conversations)").all() as DatabaseRow[]).map(row => String(row.name)));
      if (!conversationColumns.has("goal_control_issued_at_ms")) this.db.exec("ALTER TABLE conversations ADD COLUMN goal_control_issued_at_ms INTEGER NOT NULL DEFAULT 0");
      this.db.exec(`CREATE INDEX IF NOT EXISTS submissions_dispatch_order ON submissions(status,created_at);
        CREATE INDEX IF NOT EXISTS submissions_conversation_status ON submissions(conversation_id,status);
        CREATE TABLE IF NOT EXISTS conversation_checkpoints (
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          native_session_id TEXT NOT NULL,
          native_goal_id TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK(revision>0),
          phase TEXT NOT NULL,
          question_artifact_id TEXT,
          checkpoint_artifact_id TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(conversation_id,native_session_id,native_goal_id)
        );
        INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES (2,datetime('now'));`);
      this.db.exec(contactsMigrationSql);
      this.db.exec(domainEffectMigrationSql);
      for (const [name,type] of [["domain_control_issued_at_ms","INTEGER NOT NULL DEFAULT 0"],["domain_goal_bound","INTEGER NOT NULL DEFAULT 0"],["domain_audience","TEXT NOT NULL DEFAULT 'private'"]]) {
        if(!columns.has(name))this.db.exec(`ALTER TABLE submissions ADD COLUMN ${name} ${type}`);
      }
      this.db.exec(`CREATE TRIGGER IF NOT EXISTS submissions_domain_admission_context AFTER INSERT ON submissions
        BEGIN UPDATE submissions SET
          domain_control_issued_at_ms=(SELECT goal_control_issued_at_ms FROM conversations WHERE id=NEW.conversation_id),
          domain_audience=(SELECT audience FROM conversations WHERE id=NEW.conversation_id),
          domain_goal_bound=CASE WHEN json_valid(NEW.payload_json) THEN CASE WHEN
            json_extract(NEW.payload_json,'$.kind')='goal_resume' OR json_type(NEW.payload_json,'$.goalStart')='object' THEN 1 ELSE 0 END ELSE 0 END
          WHERE id=NEW.id; END;`);
      this.db.exec("INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES (3,datetime('now'));");
      for(const table of ["devices","enrollment_invitations"]){
        const cols=new Set((this.db.prepare(`PRAGMA table_info(${table})`).all() as DatabaseRow[]).map(row=>String(row.name)));
        if(!cols.has("device_kind"))this.db.exec(`ALTER TABLE ${table} ADD COLUMN device_kind TEXT NOT NULL DEFAULT 'personal' CHECK(device_kind IN ('personal','display'))`);
      }
      this.db.exec(executionAuthorityMigration);
      if(!(this.db.prepare("PRAGMA table_info(native_execution_grants)").all() as DatabaseRow[]).some(row=>row.name==="native_run_id"))this.db.exec("ALTER TABLE native_execution_grants ADD COLUMN native_run_id TEXT");
      if(!(this.db.prepare("PRAGMA table_info(native_execution_grants)").all() as DatabaseRow[]).some(row=>row.name==="invocations_json"))this.db.exec("ALTER TABLE native_execution_grants ADD COLUMN invocations_json TEXT NOT NULL DEFAULT '[]'");
      if(!(this.db.prepare("PRAGMA table_info(native_execution_grants)").all() as DatabaseRow[]).some(row=>row.name==="loaded_contracts_json"))this.db.exec("ALTER TABLE native_execution_grants ADD COLUMN loaded_contracts_json TEXT NOT NULL DEFAULT '[]'");
      this.db.exec("DROP TRIGGER IF EXISTS submissions_domain_admission_context");
      this.db.exec(`CREATE TRIGGER submissions_domain_admission_context AFTER INSERT ON submissions BEGIN UPDATE submissions SET
        domain_control_issued_at_ms=(SELECT goal_control_issued_at_ms FROM conversations WHERE id=NEW.conversation_id),
        domain_audience=(SELECT audience FROM conversations WHERE id=NEW.conversation_id),
        domain_goal_bound=CASE WHEN NEW.goal_id IS NOT NULL OR (json_valid(NEW.payload_json) AND (json_extract(NEW.payload_json,'$.kind')='goal_resume' OR json_type(NEW.payload_json,'$.goalStart')='object')) THEN 1 ELSE 0 END WHERE id=NEW.id; END;`);
      this.db.exec("INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES (4,datetime('now'));");
      if (!conversationColumns.has("tags_json"))
        this.db.exec("ALTER TABLE conversations ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'");
      this.db.exec("INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES (5,datetime('now'));");
      this.db.exec(deviceEffectsMigrationSql);
      this.db.exec("INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES (6,datetime('now')); ");
      this.db.exec(connectionMetadataMigration);
      this.db.exec("INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES (7,datetime('now')); ");
      if(!conversationColumns.has("deleted_at"))this.db.exec("ALTER TABLE conversations ADD COLUMN deleted_at TEXT");
      this.db.exec(conversationOrganizationMigration);
      this.db.exec("CREATE TRIGGER IF NOT EXISTS submissions_reject_deleted_conversation BEFORE INSERT ON submissions WHEN EXISTS(SELECT 1 FROM conversations WHERE id=NEW.conversation_id AND deleted_at IS NOT NULL) BEGIN SELECT RAISE(ABORT,'conversation_deleted'); END");
      this.db.exec("INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES (8,datetime('now')); ");
      this.db.exec("COMMIT");
    } catch (error) { try { this.db.exec("ROLLBACK"); } catch {} throw error; }
  }

  /** Composition-only connection: domains receive this explicitly; never expose SQL to tools. */
  domainConnection(): DatabaseSync { return this.db; }

  getSubmissionDomainBinding(id:string):{controlWatermark:number;goalBound:boolean;audience:string}|null {
    const row=this.db.prepare("SELECT domain_control_issued_at_ms,domain_goal_bound,domain_audience FROM submissions WHERE id=?").get(id) as DatabaseRow|undefined;
    return row?{controlWatermark:Number(row.domain_control_issued_at_ms),goalBound:row.domain_goal_bound===1,audience:String(row.domain_audience)}:null;
  }

  get schemaVersion(): number {
    return Number((this.db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as DatabaseRow).version);
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
    return (this.db.prepare("SELECT c.*,(SELECT p.folder_id FROM conversation_folder_placements p JOIN conversation_folders f ON f.id=p.folder_id AND f.owner_profile_id=p.profile_id AND f.deleted_at IS NULL WHERE p.conversation_id=c.id AND p.profile_id=?) AS folder_id FROM conversations c WHERE c.deleted_at IS NULL AND (c.owner_profile_id=? OR c.audience='household') ORDER BY c.updated_at DESC")
      .all(profileId,profileId) as DatabaseRow[]).map(conversationFromRow);
  }

  getConversation(conversationId: string): Conversation | undefined {
    const row = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId) as DatabaseRow | undefined;
    return row ? conversationFromRow(row) : undefined;
  }

  findConversationBySessionKey(sessionKey: string): Conversation | undefined {
    const marker = sessionKey.indexOf("hardy-home:");
    const storedKey = marker >= 0 ? sessionKey.slice(marker) : sessionKey;
    const row = this.db.prepare("SELECT * FROM conversations WHERE session_key = ? AND deleted_at IS NULL").get(storedKey) as DatabaseRow | undefined;
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

  updateConversationMetadata(conversation: Conversation, title: string, tags?: string[]): Conversation|undefined {
    const result=this.db.prepare("UPDATE conversations SET title=?,tags_json=COALESCE(?,tags_json) WHERE id=? AND deleted_at IS NULL")
      .run(title,tags===undefined?null:JSON.stringify(tags),conversation.id);
    return Number(result.changes)===1?this.getConversation(conversation.id):undefined;
  }

  touchConversation(conversationId: string) {
    this.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), conversationId);
  }

  getCheckpoint(conversationId: string, nativeSessionId: string, nativeGoalId: string | null): HouseholdCheckpoint | null {
    const row = this.db.prepare("SELECT * FROM conversation_checkpoints WHERE conversation_id=? AND native_session_id=? AND native_goal_id=?")
      .get(conversationId,nativeSessionId,nativeGoalId ?? "") as DatabaseRow | undefined;
    return row ? {
      conversationId, nativeSessionId, nativeGoalId, revision:Number(row.revision),phase:asString(row.phase),
      questionArtifactId:asNullableString(row.question_artifact_id),
      checkpointArtifactId:asNullableString(row.checkpoint_artifact_id),updatedAt:asString(row.updated_at),
    } : null;
  }

  updateCheckpoint(conversationId: string, update: HouseholdCheckpointUpdate): HouseholdCheckpoint {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.getCheckpoint(conversationId,update.nativeSessionId,update.nativeGoalId);
      if ((current?.revision ?? 0) !== update.expectedRevision) throw new Error("checkpoint_revision_conflict");
      const question = Object.hasOwn(update,"questionArtifactId") ? update.questionArtifactId ?? null : current?.questionArtifactId ?? null;
      const checkpoint = Object.hasOwn(update,"checkpointArtifactId") ? update.checkpointArtifactId ?? null : current?.checkpointArtifactId ?? null;
      this.db.prepare(`INSERT INTO conversation_checkpoints
        (conversation_id,native_session_id,native_goal_id,revision,phase,question_artifact_id,checkpoint_artifact_id,updated_at)
        VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(conversation_id,native_session_id,native_goal_id) DO UPDATE SET
        revision=excluded.revision,phase=excluded.phase,question_artifact_id=excluded.question_artifact_id,
        checkpoint_artifact_id=excluded.checkpoint_artifact_id,updated_at=excluded.updated_at`)
        .run(conversationId,update.nativeSessionId,update.nativeGoalId ?? "",update.expectedRevision+1,update.phase,question,checkpoint,new Date().toISOString());
      const result = this.getCheckpoint(conversationId,update.nativeSessionId,update.nativeGoalId)!;
      this.db.exec("COMMIT");
      return result;
    } catch (error) { try { this.db.exec("ROLLBACK"); } catch {} throw error; }
  }

  getGoalControlIssuedAt(conversationId: string): number {
    const row = this.db.prepare("SELECT goal_control_issued_at_ms FROM conversations WHERE id=?").get(conversationId) as DatabaseRow | undefined;
    return Number(row?.goal_control_issued_at_ms ?? 0);
  }

  recordGoalControl(conversationId: string, issuedAtMs: number): void {
    if (!Number.isSafeInteger(issuedAtMs) || issuedAtMs <= 0) throw new Error("invalid_goal_operation_time");
    this.db.prepare("UPDATE conversations SET goal_control_issued_at_ms=MAX(goal_control_issued_at_ms,?) WHERE id=?").run(issuedAtMs,conversationId);
  }

  createInvitation(profileId: string, ttlMinutes = 15, requestedCode?: string, deviceKind: "personal" | "display" = "personal"): { code: string; expiresAt: string } {
    if (!this.getProfile(profileId)) throw new Error("profile_not_found");
    const code = (requestedCode ?? randomBytes(15).toString("base64url")).trim().toUpperCase();
    if (!/^[A-Z0-9_-]{8,64}$/.test(code)) {
      throw new Error("Enrollment code must contain 8-64 letters, numbers, underscores, or hyphens");
    }
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000).toISOString();
    this.db.prepare(`
      INSERT INTO enrollment_invitations(id, profile_id, code_hash, expires_at, created_at, device_kind)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), profileId, codeHash(code), expiresAt, now.toISOString(), deviceKind);
    return { code, expiresAt };
  }

  claimInvitation(args: {
    code: string;
    displayName: string;
    publicKeyDerBase64: string;
    deviceKind?: "personal" | "display";
  }): { deviceId: string; profile: FamilyProfile } | undefined {
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const invitation = this.db.prepare(`
        SELECT * FROM enrollment_invitations
        WHERE code_hash = ? AND claimed_at IS NULL AND expires_at > ?
      `).get(codeHash(args.code), now) as DatabaseRow | undefined;
      if (!invitation || invitation.device_kind !== (args.deviceKind ?? "personal")) {
        this.db.exec("ROLLBACK");
        return undefined;
      }
      const personalDevices=Number((this.db.prepare("SELECT count(*) AS count FROM devices WHERE profile_id=? AND device_kind='personal'").get(asString(invitation.profile_id)) as DatabaseRow).count);
      const deviceId = `device-${randomUUID()}`;
      this.db.prepare(`
        INSERT INTO devices(id, profile_id, display_name, public_key_der_base64, enrolled_at, device_kind)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(deviceId, asString(invitation.profile_id), args.displayName, args.publicKeyDerBase64, now, args.deviceKind ?? "personal");
      const result = this.db.prepare(`
        UPDATE enrollment_invitations SET claimed_at = ?, device_id = ?
        WHERE id = ? AND claimed_at IS NULL
      `).run(now, deviceId, asString(invitation.id));
      if (Number(result.changes) !== 1) throw new Error("invitation_claim_race");
      // First personal enrollment activates delivery, not domain/tool grants.
      // Revoked or explicitly held existing profiles are never reactivated here.
      if((args.deviceKind??"personal")==="personal"&&personalDevices===0)this.db.prepare("UPDATE profiles SET status='available',status_detail='Ready' WHERE id=? AND status='offline'").run(asString(invitation.profile_id));
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
    deviceKind: "personal" | "display";
  } | undefined {
    const row = this.db.prepare("SELECT * FROM devices WHERE id = ?").get(deviceId) as DatabaseRow | undefined;
    if (!row) return undefined;
    return {
      id: asString(row.id),
      profileId: asString(row.profile_id),
      publicKeyDerBase64: asString(row.public_key_der_base64),
      status: asString(row.status),
      deviceKind: asString(row.device_kind) as "personal" | "display",
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

  getSubmission(submissionId: string) {
    return this.submissions.get(submissionId);
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

  listActiveSubmissions(): Array<{ receipt: SubmissionReceipt; createdAt: string }> {
    return this.submissions.listActive().map(item => ({ receipt:item.receipt,createdAt:item.createdAt }));
  }

  close() {
    this.db.close();
  }
}
