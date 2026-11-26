import assert from "node:assert/strict";
import { test } from "node:test";
import { HouseholdDatabase } from "../src/database.ts";
import { MockHouseholdAgentAdapter } from "../src/mock-adapter.ts";
import { SqliteHouseholdStore } from "../src/sqlite-household-store.ts";

async function createRunningTurn(label: string) {
  const database = new HouseholdDatabase(":memory:");
  const adapter = new MockHouseholdAgentAdapter([]);
  const store = new SqliteHouseholdStore(database, adapter);
  const unsubscribe = store.onAgentEvent(() => {});
  const profile = store.getProfile("alex");
  assert.ok(profile);
  const conversation = await store.createConversation(profile, label, null);
  const admitted = await store.submitMessage({
    profile,
    conversationId: conversation.id,
    text: "Reconnect acceptance",
    submissionId: `submission-${label.replaceAll(" ", "-")}`,
  });
  assert.ok(admitted);
  assert.equal(admitted.status, "queued");
  assert.equal(store.getProfile("alex")?.status, "queued");
  await store.reconcileRuns();
  const receipt = database.getSubmission(admitted.submissionId)!.receipt;
  assert.equal(receipt.status, "running");
  assert.ok(receipt.runId);
  assert.equal(store.getProfile("alex")?.status, "working");
  return { adapter, conversation, receipt, store, unsubscribe };
}

test("canonical OpenClaw event keys resolve to household conversations", async () => {
  const fixture = await createRunningTurn("canonical-event");
  try {
    fixture.adapter.emitEvent({
      sessionKey: `agent:main:${fixture.conversation.sessionKey}`,
      runId: fixture.receipt.runId,
      phase: "complete",
    });
    // A terminal event is a wake hint, not proof that the current native run ended.
    assert.equal(fixture.store.getProfile("alex")?.status, "working");
    await fixture.store.reconcileRuns();
    assert.equal(fixture.store.getProfile("alex")?.status, "working");
    fixture.adapter.setRunState(fixture.conversation, {
      status: "complete", runId: fixture.receipt.runId, updatedAt: new Date(Date.now() + 1_000).toISOString(),
    });
    await fixture.store.reconcileRuns();
    assert.equal(fixture.store.getProfile("alex")?.status, "available");
    const replay = await fixture.store.submitMessage({
      profile: fixture.store.getProfile("alex")!,
      conversationId: fixture.conversation.id,
      text: "Reconnect acceptance",
      submissionId: fixture.receipt.submissionId,
    });
    assert.equal(replay?.status, "complete");
  } finally {
    fixture.unsubscribe();
    await fixture.store.close();
  }
});

test("status read reconciles a terminal run whose event was missed", async () => {
  const fixture = await createRunningTurn("missed-event");
  try {
    fixture.adapter.setRunState(fixture.conversation, {
      status: "complete",
      runId: fixture.receipt.runId,
      updatedAt: new Date(Date.now() + 1_000).toISOString(),
    });
    await fixture.store.reconcileRuns();
    assert.equal(fixture.store.getProfile("alex")?.status, "available");
    const replay = await fixture.store.submitMessage({
      profile: fixture.store.getProfile("alex")!,
      conversationId: fixture.conversation.id,
      text: "Reconnect acceptance",
      submissionId: fixture.receipt.submissionId,
    });
    assert.equal(replay?.status, "complete");
  } finally {
    fixture.unsubscribe();
    await fixture.store.close();
  }
});
