import assert from "node:assert/strict";
import { test } from "node:test";
import type { Conversation, HouseholdAgentAdapter, HouseholdAgentEvent, HouseholdSubmitMessage } from "../src/domain.ts";
import { HouseholdDatabase } from "../src/database.ts";
import { SqliteHouseholdStore } from "../src/sqlite-household-store.ts";

class GoalAdmissionProbe implements HouseholdAgentAdapter {
  readonly mode = "mock" as const;
  sends = 0;
  goalStarts = 0;
  async ensureConversation(_conversation: Conversation) {}
  async listMessages(_conversation: Conversation) { return []; }
  async submitMessage(args: HouseholdSubmitMessage) {
    args.assertAdmission?.();
    this.sends++;
    if (args.goalStart) this.goalStarts++;
    return { submissionId: args.submissionId, conversationId: args.conversation.id, profileId: args.profile.id,
      agentId: args.profile.agentId, status: "running" as const, queuePosition: null, runId: "native-" + args.submissionId };
  }
  async getRunState(_conversation: Conversation) { return { status: "unknown" as const, runId: null, updatedAt: null }; }
  async cancel(_conversation: Conversation) {}
  onEvent(_listener: (event: HouseholdAgentEvent) => void) { return () => {}; }
  async diagnostics() { return { status: "healthy" }; }
  async close() {}
}

async function fixture(sourceCapture: (id: string, text: string) => Promise<void>) {
  const database = new HouseholdDatabase(":memory:");
  const adapter = new GoalAdmissionProbe();
  const store = new SqliteHouseholdStore(database, adapter, { sourceCapture });
  const profile = store.getProfile("alex")!;
  assert.notEqual(profile.role, "child");
  const conversation = await store.createConversation(profile, "Role-change admission fixture", null);
  const downgrade = () => {
    database.domainConnection().prepare("UPDATE profiles SET role='child' WHERE id=?").run(profile.id);
    const current = store.getProfile(profile.id)!;
    assert.equal(current.role, "child");
    assert.ok(current.capabilities.includes("chat"));
  };
  const submit = (submissionId: string) => store.submitMessage({ profile, conversationId: conversation.id,
    text: "Synthetic conversation-mode request with an explicit native goal start", submissionId,
    goalStart: { issuedAtMs: Date.now() }, taskContext: { mode: "conversation", artifactIds: [] } });
  return { database, adapter, store, downgrade, submit };
}

test("a queued explicit goal start cannot dispatch after its actor becomes conversation-only", async () => {
  let captures = 0;
  const f = await fixture(async () => { captures++; });
  try {
    const id = "queued-child-goal-start";
    const admitted = await f.submit(id);
    assert.equal(admitted?.status, "queued");
    const saved = f.database.submissions.get(id)!;
    assert.equal(saved.taskContext?.mode, "conversation");
    assert.ok(saved.payload?.kind === "message" && saved.payload.goalStart);
    f.downgrade();
    await f.store.reconcileRuns();
    const result = f.database.submissions.get(id)!;
    assert.equal(f.adapter.sends, 0);
    assert.equal(f.adapter.goalStarts, 0);
    assert.equal(captures, 0);
    assert.equal(result.receipt.status, "failed");
    assert.equal(result.receipt.failureCode, "delivery_authorization_revoked");
    assert.equal(result.receipt.recoveryRequired, false);
    assert.equal(result.payload, null);
  } finally { await f.store.close(); }
});

test("a role downgrade during source capture revokes goal start before native dispatch", async () => {
  let entered!: () => void;
  let release!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const unblocked = new Promise<void>(resolve => { release = resolve; });
  let captures = 0;
  const f = await fixture(async () => { captures++; entered(); await unblocked; });
  let cycle: Promise<void> | undefined;
  try {
    const id = "await-child-goal-start";
    assert.equal((await f.submit(id))?.status, "queued");
    cycle = f.store.reconcileRuns();
    await reached;
    assert.equal(f.database.submissions.get(id)?.receipt.status, "dispatching");
    assert.equal(f.adapter.sends, 0);
    f.downgrade();
    release();
    await cycle;
    const result = f.database.submissions.get(id)!;
    assert.equal(captures, 1);
    assert.equal(f.adapter.sends, 0);
    assert.equal(f.adapter.goalStarts, 0);
    assert.equal(result.receipt.status, "failed");
    assert.equal(result.receipt.failureCode, "delivery_authorization_revoked");
    assert.equal(result.receipt.recoveryRequired, false);
    assert.equal(result.payload, null);
  } finally { release(); await cycle; await f.store.close(); }
});
