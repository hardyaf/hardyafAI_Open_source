import test from "node:test";
import assert from "node:assert/strict";
import { GatewayClientRequestError } from "@openclaw/gateway-client";
import { OpenClawAgentAdapter } from "../src/openclaw-adapter.ts";
import { profiles } from "../src/mock-data.ts";
import type { Conversation } from "../src/domain.ts";
import type { NativeGoalMutation } from "../src/native-session-state.ts";
import { createHash } from "node:crypto";
import { HouseholdDatabase } from "../src/database.ts";
import { SqliteHouseholdStore } from "../src/sqlite-household-store.ts";

// Exercise the actual adapter against a correlated native RPC transport fixture.
// No network/model/provider is called; native goal/session wire semantics remain real.
function fixture(rejection?: Error, goalResponse?: unknown, rowPatch: Record<string, unknown> = {}, waitResult: unknown = { status: "pending" }, history: unknown = { messages: [] }) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const conversation: Conversation = { id: "protocol-conversation", ownerProfileId: "alex", agentId: "main", sessionKey: "hardy-home:protocol-fixture",
    title: "Protocol fixture", presetId: null, audience: "private", updatedAt: new Date().toISOString() };
  const adapter = new OpenClawAgentAdapter({ url: "ws://127.0.0.1:1", token: "fixture-unused-token" });
  const session = { key: conversation.sessionKey, agentId: "main", sessionId: "native-protocol-session", goal: null, ...rowPatch };
  const client = { async request(method: string, params: Record<string, unknown>) {
    calls.push({ method, params });
    if (method === "sessions.describe") return { session: { ...session } };
    if (method === "agent.wait") return waitResult;
    if (method === "chat.history") return history;
    if (["sessions.goal.update", "sessions.goal.clear"].includes(method)) return goalResponse;
    assert.equal(method, "chat.send");
    if (rejection) throw rejection;
    // Installed native normalizeChatSendRequest rejects this before admission.
    if (params.intent && params.workContext) throw new GatewayClientRequestError({ code: "INVALID_REQUEST", message: "Working context is only supported for ordinary chat messages." });
    return { runId: "native-protocol-run", ...(params.intent ? { goalId: "native-protocol-goal" } : {}) };
  }, async stopAndWait() {} };
  // Test transport seam only; avoid adding a production client-injection API.
  Object.defineProperties(adapter, { client: { value: client }, ready: { value: true, writable: true }, started: { value: true, writable: true } });
  const args = { conversation, profile: profiles[0], text: "Create this exact fixture household task", submissionId: "protocol-submission", shouldQueue: false, queuePosition: null,
    nativeContext: { page: "hardy-home", title: "Household task", selection: "Fixture selection" } };
  return { adapter, args, calls, session };
}

test("Hardy Home shows final chat text and excludes tool preambles and typed reasoning", async () => {
  const text = (value: string) => ({ type: "text", text: value });
  const history = { messages: [
    { role: "user", content: "Check the list", __openclaw: { id: "user" } },
    { role: "assistant", stopReason: "toolUse", content: [text("I found it")] },
    { role: "assistant", content: [text("Checking again"), { type: "toolCall" }] },
    { role: "assistant", content: [{ type: "thinking", text: "Private reasoning" }] },
    { role: "assistant", stopReason: "stop", content: [{ type: "thinking", text: "Private reasoning" }, text("I found it")], __openclaw: { id: "final" } },
    { role: "assistant", content: "I found it", __openclaw: { id: "later" } },
  ] };
  const f = fixture(undefined, undefined, {}, undefined, history);
  try {
    const messages = await f.adapter.listMessages(f.args.conversation);
    assert.deepEqual(messages.map(({ id, text }) => [id, text]), [
      ["user", "Check the list"], ["final", "I found it"], ["later", "I found it"],
    ]);
  } finally { await f.adapter.close(); }
});

test("atomic native goal start omits ordinary working context while preserving its identity and intent", async () => {
  const f = fixture(); try {
    const receipt = await f.adapter.submitMessage({ ...f.args, goalStart: { issuedAtMs: 1234 }, taskContext: { mode: "task", artifactIds: [], goalStartDispatchAtMs: 2345 } });
    const send = f.calls.find(call => call.method === "chat.send")!.params;
    assert.equal(Object.hasOwn(send, "workContext"), false);
    assert.deepEqual(send.intent, { kind: "session-goal-start", version: 1, issuedAtMs: 2346 });
    assert.equal(send.sessionId, "native-protocol-session");
    assert.equal(send.sessionKey, f.args.conversation.sessionKey); assert.equal(send.agentId, "main");
    assert.equal(send.message, f.args.text); assert.equal(send.idempotencyKey, f.args.submissionId); assert.equal(send.deliver, false);
    assert.equal(receipt.goalId, "native-protocol-goal"); assert.equal(receipt.runId, "native-protocol-run");
  } finally { await f.adapter.close(); }
});

test("ordinary native chat retains its requested working context and has no goal-start intent", async () => {
  const f = fixture(); try {
    await f.adapter.submitMessage(f.args);
    const send = f.calls.find(call => call.method === "chat.send")!.params;
    assert.deepEqual(send.workContext, f.args.nativeContext);
    assert.equal(Object.hasOwn(send, "intent"), false); assert.equal(send.deliver, false);
  } finally { await f.adapter.close(); }
});

test("pinned correlated pre-admission guards classify exact rejected sends", async () => {
  const rejections = [
    { error: new GatewayClientRequestError({ code: "INVALID_REQUEST", message: "Working context is only supported for ordinary chat messages." }), outcome: "not_sent", code: "gateway_request_rejected" },
    { error: new GatewayClientRequestError({ code: "INVALID_REQUEST", message: 'Session "agent:main:hardy-home:protocol-fixture" is archived. Restore it before starting new work.' }), outcome: "not_sent", code: "conversation_archived" },
    { error: new GatewayClientRequestError({ code: "INVALID_REQUEST", message: 'Session "agent:main:hardy-home:other" is archived. Restore it before starting new work.' }), outcome: "unknown", code: "gateway_send_unknown" },
    { error: new GatewayClientRequestError({ code: "INVALID_REQUEST", message: "Another invalid-request branch with unknown admission phase" }), outcome: "unknown", code: "gateway_send_unknown" },
    { error: Object.assign(Error("Working context is only supported for ordinary chat messages."), { name: "GatewayClientRequestError", gatewayCode: "INVALID_REQUEST" }), outcome: "unknown", code: "gateway_send_unknown" },
    { error: new GatewayClientRequestError({ code: "UNAVAILABLE", message: "Native execution availability is uncertain" }), outcome: "unknown", code: "gateway_send_unknown" },
    { error: Error("Socket closed after request write"), outcome: "unknown", code: "gateway_send_unknown" },
  ];
  for (const { error, outcome, code } of rejections) {
    const f = fixture(error); try {
      await assert.rejects(() => f.adapter.submitMessage(f.args), failure => {
        const typed = failure as { code: string; deliveryOutcome: string; retryable: boolean };
        assert.equal(typed.deliveryOutcome, outcome); assert.equal(typed.code, code); assert.equal(typed.retryable, false); return true;
      });
    } finally { await f.adapter.close(); }
  }
});

for (const [action, status] of [["complete", "complete"], ["pause", "paused"], ["block", "blocked"], ["resume", "active"], ["edit", "blocked"]] as const) {
  test("native " + action + " mutation normalizes exact nested goal status from the committed envelope", async () => {
    const operation: NativeGoalMutation = { goalId: "native-protocol-goal", operationId: "goal-operation-" + action, issuedAtMs: 1234, action,
      ...(action === "edit" ? { objective: "Updated exact fixture objective" } : {}), note: "Fixture note" };
    const response = { operationId: operation.operationId, action, sessionId: "native-protocol-session", goalId: operation.goalId,
      status: action === "resume" ? "started" : "updated", goal: { id: operation.goalId, status },
      ...(action === "resume" ? { runId: "native-resume-run" } : {}), replayed: action === "complete" };
    const f = fixture(undefined, response); try {
      let admissionChecks = 0;
      const result = await f.adapter.mutateGoal(f.args.conversation, operation, () => { admissionChecks++; }, "native-protocol-session");
      assert.deepEqual(result, { goalId: operation.goalId, status, runId: action === "resume" ? "native-resume-run" : null, replayed: action === "complete" });
      assert.ok(admissionChecks > 0); assert.equal(f.calls.length, 1);
      assert.equal(f.calls[0].method, "sessions.goal.update");
      assert.deepEqual(f.calls[0].params, { sessionKey: f.args.conversation.sessionKey, agentId: "main", sessionId: "native-protocol-session",
        goalId: operation.goalId, operationId: operation.operationId, issuedAtMs: 1234,
        ...(action === "edit" ? { action, objective: operation.objective } : { action, note: operation.note }) });
    } finally { await f.adapter.close(); }
  });
}

test("truthful legacy top-level statuses and exact clear receipts remain supported", async () => {
  for (const status of ["active", "paused", "blocked", "usage_limited", "budget_limited", "complete", "cleared"]) {
    const action = status === "cleared" ? "clear" : "edit";
    const operation: NativeGoalMutation = { goalId: "native-protocol-goal", operationId: "legacy-goal-operation", issuedAtMs: 1234, action,
      ...(action === "edit" ? { objective: "Keep actual returned status" } : {}) };
    const f = fixture(undefined, { goalId: operation.goalId, status, runId: "retained-run", replayed: true }); try {
      const result = await f.adapter.mutateGoal(f.args.conversation, operation, undefined, "native-protocol-session");
      assert.deepEqual(result, { goalId: operation.goalId, status, runId: "retained-run", replayed: true });
      assert.equal(f.calls[0].method, action === "clear" ? "sessions.goal.clear" : "sessions.goal.update");
      if (action === "clear") assert.equal(Object.hasOwn(f.calls[0].params, "action"), false);
    } finally { await f.adapter.close(); }
  }
});

test("malformed or mismatched goal mutation receipts remain unknown after the possible commit", async () => {
  const operation: NativeGoalMutation = { goalId: "native-protocol-goal", operationId: "exact-goal-operation", issuedAtMs: 1234, action: "complete" };
  const native = { goalId: operation.goalId, operationId: operation.operationId, action: operation.action, sessionId: "native-protocol-session",
    status: "updated", goal: { id: operation.goalId, status: "complete" } };
  const responses: unknown[] = [
    null, [], "complete", { status: "complete" },
    { ...native, goalId: "other-goal" }, { ...native, goal: { id: "other-goal", status: "complete" } },
    { ...native, sessionId: "replacement-session" }, { ...native, operationId: "another-operation" }, { ...native, action: "pause" },
    { ...native, agentId: "natasha" }, { ...native, sessionKey: "another-session-key" },
    { ...native, goal: null }, { ...native, goal: [] }, { ...native, goal: { id: operation.goalId } },
    { ...native, goal: { id: operation.goalId, status: "invented" } }, { ...native, goal: undefined },
    { ...native, status: "paused" }, { ...native, status: ["updated"] },
    { ...native, operationId: undefined }, { ...native, sessionId: undefined },
    { ...native, runId: 123 }, { ...native, replayed: "true" },
  ];
  for (const response of responses) {
    const f = fixture(undefined, response); try {
      await assert.rejects(() => f.adapter.mutateGoal(f.args.conversation, operation, undefined, "native-protocol-session"), failure => {
        const typed = failure as { code: string; deliveryOutcome: string };
        assert.equal(typed.code, "gateway_goal_outcome_unknown"); assert.equal(typed.deliveryOutcome, "unknown"); return true;
      });
      assert.equal(f.calls.length, 1, "A response mismatch cannot issue another mutation");
    } finally { await f.adapter.close(); }
  }
});

test("a requested completion never substitutes for the exact returned goal status", async () => {
  const operation: NativeGoalMutation = { goalId: "native-protocol-goal", operationId: "exact-goal-operation", issuedAtMs: 1234, action: "complete" };
  const f = fixture(undefined, { goalId: operation.goalId, operationId: operation.operationId, action: operation.action,
    sessionId: "native-protocol-session", status: "updated", goal: { id: operation.goalId, status: "paused" } }); try {
    assert.equal((await f.adapter.mutateGoal(f.args.conversation, operation, undefined, "native-protocol-session")).status, "paused");
  } finally { await f.adapter.close(); }
});

async function successorDeliveryFixture(patch: Record<string, unknown> = {}) {
  const f = fixture(undefined, undefined, { status: "done", lastRunId: "announce-successor", parentSessionKey: null, hasActiveRun: false, activeRunIds: [],
    updatedAt: Date.now() + 10_000, goal: { id: "original-goal", objective: "Save alpha and beta", status: "active", updatedAt: 10 }, ...patch });
  const database = new HouseholdDatabase(":memory:"), store = new SqliteHouseholdStore(database, f.adapter);
  database.insertConversation(f.args.conversation);
  const text = "Save alpha and beta", hash = createHash("sha256").update(text).digest("hex");
  database.submissions.enqueue({ submissionId: "original-source", conversationId: f.args.conversation.id, profileId: "alex", agentId: "main", textHash: hash,
    requestHash: hash, payload: { kind: "message", text, goalStart: { issuedAtMs: Date.now() } }, taskContext: { mode: "task", artifactIds: [] } });
  const claim = database.submissions.claimNext(2, 60_000)!;
  database.submissions.accepted(claim.receipt.submissionId, claim.leaseToken!, { ...claim.receipt, status: "running", runId: "original-root", goalId: "original-goal" });
  return { ...f, database, store, receipt: () => database.submissions.get("original-source")!.receipt };
}

test("the actual adapter observes the terminal same-goal announce and delivery reports missing task proof", async () => {
  const f = await successorDeliveryFixture(); try {
    const state = await f.adapter.getRunState(f.args.conversation, "original-root", "original-goal");
    assert.equal(state.status, "complete"); assert.equal(state.runId, "announce-successor"); assert.equal(state.goalId, "original-goal");
    assert.equal(f.calls.some(call => call.method === "agent.wait"), false, "An explicit current terminal row needs no older-run observation");
    await f.store.reconcileRuns();
    assert.equal(f.receipt().status, "failed"); assert.equal(f.receipt().failureCode, "task_incomplete_after_native_run");
    assert.equal(f.receipt().goalId, "original-goal"); assert.equal((await f.adapter.getContext(f.args.conversation)).goal!.status, "active");
    assert.ok(f.calls.every(call => call.method === "sessions.describe"), "Reconciliation cannot send work or mutate the goal");
  } finally { await f.store.close(); }
});

test("a same-goal terminal successor preserves a durable human question instead of claiming task success", async () => {
  const f = await successorDeliveryFixture(); try {
    f.database.updateCheckpoint(f.args.conversation.id, { nativeSessionId: "native-protocol-session", nativeGoalId: "original-goal", expectedRevision: 0,
      phase: "waiting_for_user", questionArtifactId: "artifact-" + "a".repeat(64), checkpointArtifactId: null });
    await f.store.reconcileRuns();
    assert.equal(f.receipt().status, "waiting_for_user"); assert.equal(f.receipt().failureCode, null);
    assert.equal((await f.adapter.getContext(f.args.conversation)).goal!.status, "active");
  } finally { await f.store.close(); }
});

test("stale, unrelated, child and active observations cannot settle the original source", async () => {
  for (const patch of [{ updatedAt: Date.now() - 100_000 }, { goal: { id: "different-goal", objective: "Other work", status: "active", updatedAt: 10 } },
    { key: "another-session" }, { parentSessionKey: "different-parent" }, { hasActiveRun: true }, { hasActiveSubagentRun: true }]) {
    const f = await successorDeliveryFixture(patch); try {
      await f.store.reconcileRuns();
      assert.equal(f.receipt().status, "running", JSON.stringify(patch)); assert.equal(f.receipt().failureCode, null);
      assert.equal(f.receipt().goalId, "original-goal");
      assert.equal(f.calls.some(call => call.method === "chat.send" || call.method === "sessions.goal.update"), false);
    } finally { await f.store.close(); }
  }
});

test("unanchored later rows stay unknown and active same-goal work never consults an old completed wait", async () => {
  const row = { status: "done", lastRunId: "announce-successor", parentSessionKey: null,
    goal: { id: "original-goal", objective: "Save both entries", status: "active", updatedAt: 10 } };
  const unanchored = fixture(undefined, undefined, row); try {
    assert.equal((await unanchored.adapter.getRunState(unanchored.args.conversation, "original-root")).status, "unknown");
    assert.equal((await unanchored.adapter.getRunState(unanchored.args.conversation, "original-root", "different-goal")).status, "unknown");
  } finally { await unanchored.adapter.close(); }
  const active = fixture(undefined, undefined, { ...row, status: "running", hasActiveRun: true }, { status: "ok" }); try {
    assert.equal((await active.adapter.getRunState(active.args.conversation, "original-root", "original-goal")).status, "running");
    assert.equal(active.calls.some(call => call.method === "agent.wait"), false);
  } finally { await active.adapter.close(); }
});

test("a question reply explicitly binds the absence of a native goal and still fences session changes",async()=>{
  const f=fixture();try{
    const packet={mode:"conversation" as const,artifactIds:[],replyToQuestionId:"artifact-"+"d".repeat(64),expectedSessionId:"native-protocol-session",expectedGoalId:null};
    const result=await f.adapter.submitMessage({...f.args,taskContext:packet});assert.equal(result.runId,"native-protocol-run");
    assert.equal(f.calls.find(call=>call.method==="chat.send")!.params.sessionId,"native-protocol-session");
    f.session.goal={id:"unrelated-new-goal",status:"active",objective:"Other request",updatedAt:Date.now()} as any;
    await assert.rejects(()=>f.adapter.submitMessage({...f.args,submissionId:"reply-after-goal-change",taskContext:packet}),/question_binding_conflict/);
    assert.equal(f.calls.filter(call=>call.method==="chat.send").length,1);
  }finally{await f.adapter.close();}
});

test("an exact independent turn can finish while another root continuation remains pending",async()=>{
  const f=fixture(undefined,undefined,{hasActiveSubagentRun:true,subagentRunState:"paused",lastRunId:"side-run",status:"done"},{status:"ok",runId:"side-run"});try{
    assert.equal((await f.adapter.getRunState(f.args.conversation,"side-run","original-goal")).status,"running");
    const exact=await f.adapter.getExactRunState(f.args.conversation,"side-run");assert.equal(exact.status,"complete");assert.equal(exact.runId,"side-run");assert.equal(exact.updatedAt,null);
    assert.equal((await f.adapter.getExactRunState(f.args.conversation,"another-run")).status,"unknown");
  }finally{await f.adapter.close();}
});

test("native analysis observes the admitted session and exact run when the child projection omits lastRunId", async () => {
  const childSessionKey = "agent:household-analysis:subagent:fixture";
  const parentSessionKey = "agent:main:hardy-home:protocol-fixture";
  const identity = { childSessionKey, parentSessionKey, runId: "exact-analysis-run",
    expectedSessionId: "exact-analysis-session", rootTaskId: "original-task", assertCurrent() {} };
  const row = { key: childSessionKey, agentId: "household-analysis", parentSessionKey, sessionId: identity.expectedSessionId };
  const options = { restrictedRuntimeCheck: { value: async () => {} }, restrictedSessionCheck: { value: async () => {} } };
  const running = fixture(undefined, undefined, { ...row, status: "running", hasActiveRun: true }, { status: "timeout", runId: identity.runId });
  Object.defineProperties(running.adapter, options);
  try { assert.equal((await running.adapter.observeAnalysisChild(identity)).state, "running"); }
  finally { await running.adapter.close(); }
  const complete = fixture(undefined, undefined, { ...row, status: "done" }, { status: "ok", runId: identity.runId, stopReason: "end_turn" });
  Object.defineProperties(complete.adapter, options);
  try {
    assert.equal((await complete.adapter.observeAnalysisChild(identity)).state, "complete");
    await assert.rejects(() => complete.adapter.observeAnalysisChild({ ...identity, expectedSessionId: "another-session" }), /analysis_child_binding_invalid/);
    await assert.rejects(() => complete.adapter.observeAnalysisChild({ ...identity, runId: "unrelated-run" }), /analysis_child_binding_invalid/);
  } finally { await complete.adapter.close(); }
});
