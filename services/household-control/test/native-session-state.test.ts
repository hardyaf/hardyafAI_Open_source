import assert from "node:assert/strict";
import { test } from "node:test";
import { contextFromRow, matchesNativeSession, stateFromExactObservation, stateFromRow } from "../src/native-session-state.ts";
import { validateRestrictedAttachments, validateRestrictedKey } from "../src/restricted-native-session.ts";

// Written with Slice 1; execution belongs to the consolidated functionality campaign.
test("a yielded parent with active descendants does not settle its original submission", () => {
  const state = stateFromRow({ key: "agent:main:home", status: "done", lastRunId: "root", hasActiveSubagentRun: true }, "root");
  assert.equal(state.status, "running");
  assert.equal(state.continuationPending, true);
});

test("a later session turn cannot prove an uncertain submission was admitted", () => {
  assert.equal(stateFromRow({ status: "running", lastRunId: "different" }, "unknown-request").status, "unknown");
  assert.equal(stateFromRow({ status: "done", lastRunId: "different" }, "unknown-request").status, "unknown");
});

test("an exact native goal anchors successor completion", () => {
  const state = stateFromRow({ status: "done", lastRunId: "successor", goal: {
    id: "goal-1", objective: "finish the task", status: "complete", updatedAt: 10,
  } }, "original", "goal-1");
  assert.equal(state.status, "complete");
  assert.equal(state.runId, "original");
});

test("a terminal parent successor is observable under the exact still-active goal", () => {
  for (const [native, expected] of [["done", "complete"], ["failed", "failed"], ["timeout", "failed"], ["interrupted", "cancelled"], ["killed", "cancelled"]] as const) {
    const row = { status: native, lastRunId: "announce-successor", sessionId: "same-session", parentSessionKey: null, hasActiveRun: false,
      goal: { id: "goal-1", objective: "Save both entries", status: "active", updatedAt: 10 } };
    const state = stateFromRow(row, "original-root", "goal-1");
    assert.equal(state.status, expected); assert.equal(state.runId, "announce-successor"); assert.equal(state.goalId, "goal-1");
    assert.equal(contextFromRow(row, { sessionKey: "home" }).goal?.status, "active", "A terminal turn does not complete the goal");
  }
});

test("same-goal successors retain active, queue, child and yield precedence", () => {
  const base = { status: "done", lastRunId: "announce-successor", parentSessionKey: null,
    goal: { id: "goal-1", objective: "Save both entries", status: "active", updatedAt: 10 } };
  for (const patch of [{ hasActiveRun: true }, { hasActiveSubagentRun: true }, { subagentRunState: "paused" }, { status: "running" }, { swarm: { groups: [{ queued: 1, running: 0 }] } }])
    assert.equal(stateFromRow({ ...base, ...patch }, "original-root", "goal-1").status, "running");
  assert.equal(stateFromRow({ ...base, status: "queued" }, "original-root", "goal-1").status, "queued");
});

test("terminal successor projection requires a current run, exact goal and parent lineage", () => {
  const base = { status: "done", lastRunId: "announce-successor", parentSessionKey: null,
    goal: { id: "goal-1", objective: "Save both entries", status: "active", updatedAt: 10 } };
  assert.equal(stateFromRow(base, "original-root").status, "unknown");
  assert.equal(stateFromRow(base, "original-root", "different-goal").status, "unknown");
  for (const patch of [{ goal: null }, { lastRunId: null }, { parentSessionKey: "another-parent" }, { status: "idle" }, { status: "unknown" }])
    assert.equal(stateFromRow({ ...base, ...patch }, "original-root", "goal-1").status, "unknown");
});

test("waiting for user input can finish a turn while its goal remains visible", () => {
  const row = { key: "agent:main:home", status: "done", lastRunId: "question-turn", goal: {
    id: "goal-1", objective: "make a schedule", status: "active", updatedAt: 10,
  } };
  assert.equal(stateFromRow(row, "question-turn").status, "complete");
  assert.equal(contextFromRow(row, { sessionKey: "home" }).goal?.status, "active");
});

test("a wait deadline is not a terminal execution and yielded work remains active", () => {
  assert.equal(stateFromExactObservation({ status: "timeout" }), "unknown");
  assert.equal(stateFromExactObservation({ status: "ok", yielded: true, livenessState: "paused" }), "running");
  assert.equal(stateFromExactObservation({ status: "ok", stopReason: "end_turn" }), "complete");
});

test("canonical key matching cannot cross the mapped agent boundary", () => {
  assert.equal(matchesNativeSession({ key: "agent:other:home" }, { sessionKey: "home", agentId: "main" }), false);
  assert.equal(matchesNativeSession({ key: "agent:main:home", agentId: "main" }, { sessionKey: "home", agentId: "main" }), true);
});

test("restricted inputs cannot select host paths or mismatched helper namespaces", () => {
  assert.throws(() => validateRestrictedKey(`hardy-home:restricted:analysis:${"a".repeat(40)}`, "household-diagnostics"));
  assert.throws(() => validateRestrictedAttachments([{ type: "file", fileName: "../secrets", mimeType: "text/plain", content: "", sizeBytes: 0 }], "household-analysis"));
  assert.throws(() => validateRestrictedAttachments([{ type: "file", fileName: "input.txt", mimeType: "text/plain", content: "aGVsbG8=", sizeBytes: 2 }], "household-analysis"));
});
