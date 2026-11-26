import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { HouseholdDatabase } from "../src/database.ts";
import { SqliteHouseholdStore } from "../src/sqlite-household-store.ts";
import type { Conversation, HouseholdAgentAdapter, HouseholdAgentEvent, HouseholdConversationContext, HouseholdAgentRunState } from "../src/domain.ts";

class UnboundGoalAdapter implements HouseholdAgentAdapter {
  readonly mode = "mock" as const;
  state: HouseholdAgentRunState = { status: "complete", runId: "source-run", updatedAt: new Date(Date.now() + 10_000).toISOString() };
  native: HouseholdConversationContext = { sessionKey: "", sessionId: "source-generation", runId: null, continuationPending: false,
    goal: { id: "unbound-native-goal", objective: "An unbound native objective", status: "active", updatedAt: Date.now() },
    parentSessionKey: null, contextTokens: 32768, contextBudgetStatus: "ready" };
  sends = 0;
  cancellations = 0;
  gate?: { entered: () => void; wait: Promise<void> };
  deferContext() {
    let entered!: () => void, release!: () => void;
    const observed = new Promise<void>(resolve => { entered = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    this.gate = { entered, wait };
    return { observed, release };
  }
  async ensureConversation(_conversation: Conversation) {}
  async listMessages(_conversation: Conversation) { return []; }
  async submitMessage(): Promise<never> { this.sends++; throw Error("unbound fixture cannot dispatch"); }
  async getRunState() { return { ...this.state }; }
  async getContext(conversation: Conversation) {
    const gate = this.gate;
    if (gate) { gate.entered(); await gate.wait; this.gate = undefined; }
    return { ...structuredClone(this.native), sessionKey: conversation.sessionKey };
  }
  async cancel() { this.cancellations++; }
  onEvent(_listener: (event: HouseholdAgentEvent) => void) { return () => {}; }
  async diagnostics() { return { status: "healthy" }; }
  async close() {}
}

async function fixture() {
  const database = new HouseholdDatabase(":memory:"), adapter = new UnboundGoalAdapter(), store = new SqliteHouseholdStore(database, adapter);
  const profile = store.getProfile("alex")!, conversation = await store.createConversation(profile, "Unbound completion truth", null);
  const text = "A normal no-goal conversation turn", hash = createHash("sha256").update(text).digest("hex");
  database.submissions.enqueue({ submissionId: "unbound-source", conversationId: conversation.id, profileId: profile.id, agentId: profile.agentId,
    textHash: hash, requestHash: hash, payload: { kind: "message", text, taskContext: { mode: "conversation", artifactIds: [] } } });
  const claim = database.submissions.claimNext(2, 60_000)!;
  database.submissions.accepted(claim.receipt.submissionId, claim.leaseToken!, { ...claim.receipt, status: "running", runId: "source-run", goalId: null });
  return { database, adapter, store, conversation, receipt: () => database.submissions.get("unbound-source")!.receipt };
}

test("completed turn with cleared public run ID cannot complete an unbound nonterminal native goal", async () => {
  for (const [status, continuationPending] of [["active", false], ["active", true], ["paused", false], ["blocked", false], ["budget_limited", false], ["usage_limited", false]] as const) {
    const f = await fixture(); try {
      f.adapter.native.goal!.status = status;
      // Pending work on an unowned native goal cannot lend authority to this source.
      f.adapter.native.continuationPending = continuationPending;
      await f.store.reconcileRuns();
      assert.equal(f.receipt().status, "failed");
      assert.equal(f.receipt().failureCode, "native_goal_binding_missing");
      assert.equal(f.receipt().recoveryRequired, false);
      assert.equal(f.receipt().goalId, null);
      assert.equal(f.database.getSubmissionDomainBinding("unbound-source")!.goalBound, false);
      assert.equal(f.adapter.native.goal!.id, "unbound-native-goal");
      assert.equal(f.adapter.native.goal!.status, status);
      assert.equal(f.adapter.sends, 0); assert.equal(f.adapter.cancellations, 0);
    } finally { await f.store.close(); }
  }
});

test("ordinary follow-up can finish beside an old completed goal or no goal", async () => {
  for (const goalPresent of [true, false]) {
    const f = await fixture(); try {
      if (goalPresent) f.adapter.native.goal = { ...f.adapter.native.goal!, status: "complete", updatedAt: Date.now() - 100_000 };
      else f.adapter.native.goal = null;
      await f.store.reconcileRuns();
      assert.equal(f.receipt().status, "complete"); assert.equal(f.receipt().failureCode, null); assert.equal(f.receipt().goalId, null);
      assert.equal(f.adapter.sends, 0);
    } finally { await f.store.close(); }
  }
});

test("source binding published during native-context await is reread instead of failed as unbound", async () => {
  const f = await fixture(); const gate = f.adapter.deferContext();
  try {
    const cycle = f.store.reconcileRuns(); await gate.observed;
    f.database.domainConnection().prepare("UPDATE submissions SET goal_id=?,domain_goal_bound=1 WHERE id=?").run("unbound-native-goal", "unbound-source");
    gate.release(); await cycle;
    assert.equal(f.receipt().status, "failed"); assert.equal(f.receipt().failureCode, "task_incomplete_after_native_run");
    assert.equal(f.receipt().goalId, "unbound-native-goal");
  } finally { gate.release(); await f.store.close(); }
});

test("a newer exact terminal receipt during native-context await is preserved", async () => {
  const f = await fixture(); const gate = f.adapter.deferContext();
  try {
    const cycle = f.store.reconcileRuns(); await gate.observed;
    f.database.submissions.failWithCode("unbound-source", "source-run", "operator_cancelled", "cancelled");
    gate.release(); await cycle;
    assert.equal(f.receipt().status, "cancelled"); assert.equal(f.receipt().failureCode, "operator_cancelled");
    assert.equal(f.receipt().goalId, null);
  } finally { gate.release(); await f.store.close(); }
});

test("an older completed-run observation cannot settle a replaced unbound run after context await", async () => {
  const f = await fixture(); const gate = f.adapter.deferContext();
  try {
    const cycle = f.store.reconcileRuns(); await gate.observed;
    f.database.domainConnection().prepare("UPDATE submissions SET run_id=? WHERE id=? AND status='running'").run("newer-source-run", "unbound-source");
    gate.release(); await cycle;
    assert.equal(f.receipt().status, "running"); assert.equal(f.receipt().failureCode, null);
    assert.equal(f.receipt().runId, "newer-source-run"); assert.equal(f.receipt().goalId, null);
    assert.equal(f.store.getSnapshot().activeRuns, 1);
  } finally { gate.release(); await f.store.close(); }
});

test("legacy abort cannot upgrade an unbound active native goal to a completed source", async () => {
  const f = await fixture(); try {
    assert.equal(await f.store.cancel(f.store.getProfile("alex")!, f.conversation.id, "source-run"), true);
    assert.equal(f.receipt().status, "cancelled"); assert.equal(f.receipt().goalId, null);
    assert.equal(f.adapter.native.goal!.status, "active"); assert.equal(f.adapter.cancellations, 1);
    assert.equal(f.adapter.sends, 0);
  } finally { await f.store.close(); }
});

test("legacy completion after abort requires fresh native proof for no-goal or old completed-goal follow-up", async () => {
  for (const variant of ["old-complete", "no-goal", "missing-context"] as const) {
    const f = await fixture(); try {
      if (variant === "old-complete") f.adapter.native.goal!.status = "complete";
      else f.adapter.native.goal = null;
      if (variant === "missing-context") (f.adapter as unknown as { getContext?: unknown }).getContext = undefined;
      await f.store.cancel(f.store.getProfile("alex")!, f.conversation.id, "source-run");
      assert.equal(f.receipt().status, variant === "missing-context" ? "cancelled" : "complete");
      assert.equal(f.receipt().goalId, null);
    } finally { await f.store.close(); }
  }
});

test("legacy abort rereads binding, newer terminal decisions and replacement run across native-context await", async () => {
  for (const variant of ["binding", "terminal", "replacement"] as const) {
    const f = await fixture(); const gate = f.adapter.deferContext();
    try {
      const cancel = f.store.cancel(f.store.getProfile("alex")!, f.conversation.id, "source-run"); await gate.observed;
      if (variant === "binding") {
        f.database.domainConnection().prepare("UPDATE submissions SET goal_id=?,domain_goal_bound=1 WHERE id=?").run("unbound-native-goal", "unbound-source");
        f.adapter.native.goal!.status = "complete";
      } else if (variant === "terminal") f.database.submissions.failWithCode("unbound-source", "source-run", "newer_operator_decision", "cancelled");
      else f.database.domainConnection().prepare("UPDATE submissions SET run_id=? WHERE id=? AND status='running'").run("newer-source-run", "unbound-source");
      gate.release(); await cancel;
      assert.equal(f.receipt().status, variant === "binding" ? "complete" : variant === "terminal" ? "cancelled" : "running");
      if (variant === "binding") assert.equal(f.receipt().goalId, "unbound-native-goal");
      if (variant === "terminal") assert.equal(f.receipt().failureCode, "newer_operator_decision");
      if (variant === "replacement") assert.equal(f.receipt().runId, "newer-source-run");
    } finally { gate.release(); await f.store.close(); }
  }
});
