import type { MessageTaskContext } from "./request-context.ts";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ConversationActivity, HouseholdGoalMutation, SubmissionReceipt } from "./domain.ts";

type Row = Record<string, unknown>;
export type SubmissionPayload =
  | { kind: "message"; text: string; nativeContext?: { page: string; title?: string; selection?: string }; goalStart?: { issuedAtMs: number }; taskContext?: MessageTaskContext }
  | { kind: "goal_resume"; operation: HouseholdGoalMutation; taskContext?: MessageTaskContext };

export type StoredSubmission = {
  receipt: SubmissionReceipt;
  taskContext: MessageTaskContext | null;
  textHash: string;
  requestHash: string | null;
  payload: SubmissionPayload | null;
  originDeviceId: string | null;
  createdAt: string;
  updatedAt: string;
  attemptCount: number;
  nextAttemptAt: string | null;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  dispatchStartedAt: string | null;
  recoveryRequired: boolean;
};

function optional(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function fromRow(row: Row): StoredSubmission {
  let payload: SubmissionPayload | null = null;
  if (typeof row.payload_json === "string") {
    try { payload = JSON.parse(row.payload_json) as SubmissionPayload; } catch { /* Invalid payload is made visible at dispatch. */ }
  }
  const receipt: SubmissionReceipt = {
    submissionId: String(row.id), conversationId: String(row.conversation_id),
    profileId: String(row.profile_id), agentId: String(row.agent_id),
    status: String(row.status) as SubmissionReceipt["status"],
    queuePosition: row.queue_position === null ? null : Number(row.queue_position),
    runId: optional(row.run_id),
    failureCode: optional(row.last_error),
    recoveryRequired: Number(row.recovery_required ?? 0) === 1,
    attemptCount: Number(row.attempt_count ?? 0),
    goalId: optional(row.goal_id),
  };
  return {
    receipt, taskContext: typeof row.task_context_json === "string" ? JSON.parse(row.task_context_json) : null, textHash: String(row.text_hash), requestHash: optional(row.request_hash), payload,
    originDeviceId: optional(row.origin_device_id), createdAt: String(row.created_at),
    updatedAt: String(row.updated_at), attemptCount: Number(row.attempt_count ?? 0),
    nextAttemptAt: optional(row.next_attempt_at), leaseToken: optional(row.lease_token),
    leaseExpiresAt: optional(row.lease_expires_at), dispatchStartedAt: optional(row.dispatch_started_at),
    recoveryRequired: Number(row.recovery_required ?? 0) === 1,
  };
}

/** Delivery state in the existing household ledger; OpenClaw owns execution. */
export class SubmissionRepository {
  private readonly db: DatabaseSync;
  constructor(db: DatabaseSync) { this.db = db; }

  private transaction<T>(action: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = action(); this.db.exec("COMMIT"); return result; }
    catch (error) { try { this.db.exec("ROLLBACK"); } catch {} throw error; }
  }

  get(id: string): StoredSubmission | undefined {
    const row = this.db.prepare("SELECT * FROM submissions WHERE id = ?").get(id) as Row | undefined;
    return row ? fromRow(row) : undefined;
  }

  enqueue(args: {
    submissionId: string; conversationId: string; profileId: string; agentId: string;
    textHash: string; requestHash: string; payload: SubmissionPayload; originDeviceId?: string;
    legacyCompatible?: boolean;
  }): { submission: StoredSubmission; replayed: boolean } {
    return this.transaction(() => {
      const existing = this.get(args.submissionId);
      if (existing) {
        if (existing.receipt.conversationId !== args.conversationId || existing.receipt.profileId !== args.profileId ||
            existing.receipt.agentId !== args.agentId || existing.textHash !== args.textHash ||
            (existing.requestHash !== null ? existing.requestHash !== args.requestHash : !args.legacyCompatible)) {
          throw new Error("submission_conflict");
        }
        return { submission: existing, replayed: true };
      }
      const now = new Date().toISOString();
      this.db.prepare(`INSERT INTO submissions
        (id,conversation_id,profile_id,agent_id,text_hash,status,queue_position,payload_json,request_hash,
         origin_device_id,goal_id,created_at,updated_at,task_context_json)
        VALUES (?,?,?,?,?,'queued',NULL,?,?,?,?,?,?,?)`).run(
        args.submissionId,args.conversationId,args.profileId,args.agentId,args.textHash,
        JSON.stringify(args.payload),args.requestHash,args.originDeviceId ?? null,
        args.payload.kind === "goal_resume" ? args.payload.operation.goalId : args.payload.taskContext?.expectedGoalId ?? null,now,now,
        args.payload.taskContext ? JSON.stringify(args.payload.taskContext) : null,
      );
      this.refreshQueuePositions();
      return { submission: this.get(args.submissionId)!, replayed: false };
    });
  }

  /** Bounded provenance navigation in the existing ledger, not a second source store. */
  latestGoalSource(conversationId:string,profileId:string,goalId:string):StoredSubmission|undefined{
    const values=(this.db.prepare(`SELECT * FROM submissions WHERE conversation_id=? AND profile_id=? AND goal_id=?
      AND task_context_json IS NOT NULL ORDER BY created_at DESC,rowid DESC LIMIT 100`).all(conversationId,profileId,goalId) as Row[]).map(fromRow);
    return values.find(value=>typeof value.taskContext?.sourceArtifactId==="string"&&/^artifact-[a-f0-9]{64}$/.test(value.taskContext.sourceArtifactId));
  }

  counts(): { active: number; queued: number; recoveryRequired: number } {
    const row = this.db.prepare(`SELECT
      SUM(CASE WHEN status IN ('dispatching','running') OR recovery_required=1 THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) AS queued,
      SUM(CASE WHEN recovery_required=1 THEN 1 ELSE 0 END) AS recovery_required
      FROM submissions`).get() as Row;
    return { active: Number(row.active ?? 0), queued: Number(row.queued ?? 0), recoveryRequired: Number(row.recovery_required ?? 0) };
  }

  listActive(limit = 32): StoredSubmission[] {
    return (this.db.prepare(`SELECT * FROM submissions
      WHERE status IN ('dispatching','running') OR recovery_required=1 ORDER BY updated_at,id LIMIT ?`)
      .all(limit) as Row[]).map(fromRow);
  }

  listForConversation(conversationId: string): StoredSubmission[] {
    return (this.db.prepare(`SELECT * FROM submissions WHERE conversation_id=?
      AND (status IN ('queued','dispatching','running') OR recovery_required=1) ORDER BY created_at,rowid`)
      .all(conversationId) as Row[]).map(fromRow);
  }

  conversationActivity(conversationId: string): ConversationActivity {
    const row = this.db.prepare(`SELECT status FROM submissions
      WHERE conversation_id=? AND recovery_required=0 AND status IN ('queued','dispatching','running')
      ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'dispatching' THEN 1 ELSE 2 END LIMIT 1`)
      .get(conversationId) as { status: Exclude<ConversationActivity, "idle"> } | undefined;
    return row?.status ?? "idle";
  }

  /** Expired in-flight claims are uncertain: never replay them blindly. */
  recoverExpiredClaims(now = new Date().toISOString()): SubmissionReceipt[] {
    return this.transaction(() => {
      const missing = this.db.prepare("SELECT id FROM submissions WHERE status='queued' AND payload_json IS NULL").all() as Row[];
      for (const row of missing) this.db.prepare("UPDATE submissions SET status='failed',queue_position=NULL,last_error='queued_payload_unavailable',updated_at=? WHERE id=?").run(now,String(row.id));
      const rows = this.db.prepare(`SELECT * FROM submissions WHERE status='dispatching'
        AND recovery_required=0 AND (lease_expires_at IS NULL OR lease_expires_at<=?)`).all(now) as Row[];
      for (const row of rows) {
        this.db.prepare(`UPDATE submissions SET status='failed',recovery_required=1,queue_position=NULL,
          lease_token=NULL,lease_expires_at=NULL,last_error=CASE WHEN payload_json IS NULL THEN 'legacy_dispatch_payload_missing_unknown' ELSE 'dispatch_interrupted_unknown' END,updated_at=? WHERE id=?`)
          .run(now,String(row.id));
      }
      this.refreshQueuePositions();
      return [...missing,...rows].map(row => this.get(String(row.id))!.receipt);
    });
  }

  isClaimCurrent(id: string, token: string): boolean {
    const row = this.db.prepare("SELECT id FROM submissions WHERE id=? AND status='dispatching' AND lease_token=? AND recovery_required=0 AND lease_expires_at>?")
      .get(id,token,new Date().toISOString());
    return !!row;
  }

  cancelQueuedGoalOperations(conversationId: string, goalId: string, issuedAtMs: number): SubmissionReceipt[] {
    const rows = this.db.prepare("SELECT * FROM submissions WHERE conversation_id=? AND status='queued'").all(conversationId) as Row[];
    const cancelled: SubmissionReceipt[] = [];
    for (const row of rows) {
      const stored = fromRow(row);
      if (stored.payload?.kind !== "goal_resume" || stored.payload.operation.goalId !== goalId || stored.payload.operation.issuedAtMs > issuedAtMs) continue;
      this.db.prepare("UPDATE submissions SET status='cancelled',payload_json=NULL,queue_position=NULL,last_error='superseded_by_goal_update',updated_at=? WHERE id=? AND status='queued'")
        .run(new Date().toISOString(),stored.receipt.submissionId);
      cancelled.push(this.get(stored.receipt.submissionId)!.receipt);
    }
    this.refreshQueuePositions();
    return cancelled;
  }

  claimNext(maxActiveRuns: number, leaseMs: number): StoredSubmission | undefined {
    return this.transaction(() => {
      if (this.counts().active >= maxActiveRuns) return undefined;
      const now = new Date().toISOString();
      const row = this.db.prepare(`SELECT s.* FROM submissions s JOIN profiles p ON p.id=s.profile_id
        WHERE s.status='queued' AND (s.next_attempt_at IS NULL OR s.next_attempt_at<=?)
        AND p.status NOT IN ('paused','offline')
        AND NOT EXISTS (SELECT 1 FROM submissions a WHERE a.conversation_id=s.conversation_id
          AND (a.status IN ('dispatching','running') OR a.recovery_required=1))
        AND NOT EXISTS (SELECT 1 FROM submissions q WHERE q.conversation_id=s.conversation_id
          AND q.status='queued' AND (q.created_at<s.created_at OR (q.created_at=s.created_at AND q.rowid<s.rowid)))
        ORDER BY s.created_at,s.rowid LIMIT 1`).get(now) as Row | undefined;
      if (!row) return undefined;
      const token = randomUUID();
      this.db.prepare(`UPDATE submissions SET status='dispatching',queue_position=NULL,lease_token=?,lease_expires_at=?,
        attempt_count=attempt_count+1,dispatch_started_at=?,next_attempt_at=NULL,last_error=NULL,updated_at=? WHERE id=? AND status='queued'`)
        .run(token,new Date(Date.now()+leaseMs).toISOString(),now,now,String(row.id));
      this.refreshQueuePositions();
      return this.get(String(row.id));
    });
  }

  /** Internal dispatch clock, retained separately from the immutable HTTP/payload hash. */
  goalStartDispatchTime(id:string,token:string,minimum:number):number{
    return this.transaction(()=>{
      if(!this.isClaimCurrent(id,token))throw new Error("delivery_admission_revoked");
      const existing=this.get(id)!.taskContext?.goalStartDispatchAtMs;
      if(existing!==undefined){if(!Number.isSafeInteger(existing)||existing<1)throw new Error("goal_start_dispatch_time_invalid");return existing;}
      const timestamp=Math.max(Date.now(),minimum);
      this.db.prepare(`UPDATE submissions SET task_context_json=json_set(COALESCE(task_context_json,'{}'),'$.goalStartDispatchAtMs',?)
        WHERE id=? AND status='dispatching' AND lease_token=?`).run(timestamp,id,token);
      return timestamp;
    });
  }

  renew(id: string, token: string, leaseMs: number): boolean {
    return Number(this.db.prepare(`UPDATE submissions SET lease_expires_at=?
      WHERE id=? AND status='dispatching' AND lease_token=? AND recovery_required=0`)
      .run(new Date(Date.now()+leaseMs).toISOString(),id,token).changes) === 1;
  }

  accepted(id: string, token: string, receipt: SubmissionReceipt): boolean {
    return Number(this.db.prepare(`UPDATE submissions SET status=?,run_id=?,goal_id=COALESCE(?,goal_id),
      payload_json=NULL,recovery_required=0,last_error=NULL,lease_token=NULL,lease_expires_at=NULL,
      queue_position=NULL,updated_at=? WHERE id=? AND status='dispatching' AND lease_token=?`)
      .run(receipt.status,receipt.runId,receipt.goalId ?? null,new Date().toISOString(),id,token).changes) === 1;
  }

  retryNotSent(id: string, token: string, failureCode: string, nextAttemptAt: string | null): boolean {
    const terminal = nextAttemptAt === null;
    const changed = Number(this.db.prepare(`UPDATE submissions SET status=?,last_error=?,next_attempt_at=?,
      lease_token=NULL,lease_expires_at=NULL,dispatch_started_at=NULL,queue_position=NULL,
      payload_json=CASE WHEN ? THEN NULL ELSE payload_json END,updated_at=?
      WHERE id=? AND status='dispatching' AND lease_token=?`)
      .run(terminal ? "failed" : "queued",failureCode,nextAttemptAt,terminal ? 1 : 0,new Date().toISOString(),id,token).changes) === 1;
    this.refreshQueuePositions();
    return changed;
  }

  markUnknown(id: string, token: string, failureCode: string): boolean {
    return Number(this.db.prepare(`UPDATE submissions SET status='failed',recovery_required=1,last_error=?,
      lease_token=NULL,lease_expires_at=NULL,queue_position=NULL,updated_at=?
      WHERE id=? AND status='dispatching' AND lease_token=?`)
      .run(failureCode,new Date().toISOString(),id,token).changes) === 1;
  }

  failClaim(id: string, token: string, failureCode: string): boolean {
    return this.retryNotSent(id,token,failureCode,null);
  }

  /** Move one running signed-app source to its verified native successor. */
  adoptGoalFreeNativeRun(id:string,previousRunId:string,runId:string,bindProjection:()=>void):boolean {
    return this.transaction(()=>{
      const result=this.db.prepare(`UPDATE submissions SET run_id=?,updated_at=?
        WHERE id=? AND run_id=? AND status='running' AND origin_device_id IS NOT NULL
        AND recovery_required=0 AND goal_id IS NULL AND domain_goal_bound=0`)
        .run(runId,new Date().toISOString(),id,previousRunId);
      if(result.changes!==1)return false;
      bindProjection();
      return true;
    });
  }

  reconcile(id: string, status: SubmissionReceipt["status"], runId: string | null): SubmissionReceipt | undefined {
    const terminal = status === "complete" || status === "failed" || status === "cancelled";
    this.db.prepare(`UPDATE submissions SET status=?,run_id=COALESCE(?,run_id),recovery_required=0,
      last_error=NULL,lease_token=NULL,lease_expires_at=NULL,queue_position=NULL,
      payload_json=CASE WHEN ? THEN NULL ELSE payload_json END,updated_at=? WHERE id=?
      AND (status IN ('dispatching','running') OR recovery_required=1)`)
      .run(status,runId,terminal ? 1 : 0,new Date().toISOString(),id);
    return this.get(id)?.receipt;
  }

  /** A native turn settled without completing its bound goal. Keep an explicit
   * inspectable reason in this ledger; this is not uncertain delivery/retry work.
   */
  failWithCode(id:string,runId:string|null,failureCode:string,status:"failed"|"cancelled"="failed"):SubmissionReceipt|undefined{
    if(!/^[a-z][a-z0-9_]{0,100}$/.test(failureCode)||!["failed","cancelled"].includes(status))throw new Error("submission_failure_invalid");
    this.db.prepare(`UPDATE submissions SET status=?,run_id=COALESCE(?,run_id),recovery_required=0,
      last_error=?,lease_token=NULL,lease_expires_at=NULL,queue_position=NULL,payload_json=NULL,updated_at=? WHERE id=?
      AND (status IN ('dispatching','running') OR recovery_required=1)`)
      .run(status,runId,failureCode,new Date().toISOString(),id);
    return this.get(id)?.receipt;
  }

  cancelQueued(conversationId: string, profileId: string): SubmissionReceipt[] {
    return this.transaction(() => {
      const rows = this.db.prepare(`SELECT id FROM submissions WHERE conversation_id=? AND profile_id=? AND status='queued'`)
        .all(conversationId,profileId) as Row[];
      for (const row of rows) this.db.prepare(`UPDATE submissions SET status='cancelled',payload_json=NULL,
        queue_position=NULL,last_error=NULL,updated_at=? WHERE id=?`).run(new Date().toISOString(),String(row.id));
      this.refreshQueuePositions();
      return rows.map(row => this.get(String(row.id))!.receipt);
    });
  }

  /** The native target fence has already succeeded; this settles only its older delivery records. */
  cancelTargeted(conversationId:string,profileId:string,target:{goalId?:string;runId?:string;issuedAtMs:number}):SubmissionReceipt[]{
    return this.transaction(()=>{
      const records=(this.db.prepare(`SELECT * FROM submissions WHERE conversation_id=? AND profile_id=?
        AND status IN ('queued','dispatching','running','waiting_for_user','failed') AND created_at<=?`)
        .all(conversationId,profileId,new Date(target.issuedAtMs).toISOString()) as Row[]).map(fromRow).filter(row=>
          target.goalId?row.receipt.goalId===target.goalId:row.receipt.runId===target.runId);
      for(const row of records)this.db.prepare(`UPDATE submissions SET status='cancelled',payload_json=NULL,queue_position=NULL,
        recovery_required=0,lease_token=NULL,lease_expires_at=NULL,last_error=NULL,updated_at=? WHERE id=?`)
        .run(new Date().toISOString(),row.receipt.submissionId);
      this.refreshQueuePositions();return records.map(row=>this.get(row.receipt.submissionId)!.receipt);
    });
  }

  waiting(id: string, runId: string | null): SubmissionReceipt | undefined {
    return this.reconcile(id,"waiting_for_user",runId);
  }

  applyTerminal(sessionConversationId: string, runId: string | null, status: SubmissionReceipt["status"]): SubmissionReceipt[] {
    if (!runId) return [];
    const rows = this.db.prepare(`SELECT id FROM submissions WHERE conversation_id=? AND run_id=?
      AND (status IN ('dispatching','running') OR recovery_required=1)`).all(sessionConversationId,runId) as Row[];
    return rows.map(row => this.reconcile(String(row.id),status,runId)!).filter(Boolean);
  }

  profileActivity(profileId: string): { active: number; queued: number; recoveryRequired: number } {
    const row = this.db.prepare(`SELECT
      SUM(CASE WHEN status IN ('dispatching','running') OR recovery_required=1 THEN 1 ELSE 0 END) active,
      SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) queued,
      SUM(CASE WHEN recovery_required=1 THEN 1 ELSE 0 END) recovery_required FROM submissions WHERE profile_id=?`).get(profileId) as Row;
    return { active:Number(row.active ?? 0),queued:Number(row.queued ?? 0),recoveryRequired:Number(row.recovery_required ?? 0) };
  }

  refreshQueuePositions(): void {
    const rows = this.db.prepare("SELECT id FROM submissions WHERE status='queued' ORDER BY created_at,rowid").all() as Row[];
    const update = this.db.prepare("UPDATE submissions SET queue_position=? WHERE id=?");
    rows.forEach((row,index) => update.run(index+1,String(row.id)));
  }
}
