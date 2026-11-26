import assert from "node:assert/strict";
import { test } from "node:test";
import { nativeProgressFromResult } from "../src/native-progress.ts";

// Deferred with the consolidated functionality campaign; no model or provider calls.
test("native progress projection retains its revision without inventing task state", () => {
  assert.deepEqual(nativeProgressFromResult({ card: {
    sessionKey: "agent:main:home", revision: 3, updatedAt: 123,
    markdown: "Waiting for a date", steps: [{ step: "Ask for a date", status: "in_progress" }],
  } }, { agentId: "main", sessionKey: "home" }), {
    sessionKey: "agent:main:home", revision: 3, updatedAt: 123,
    markdown: "Waiting for a date", steps: [{ step: "Ask for a date", status: "in_progress" }],
  });
});

test("native progress projection separates missing from malformed or foreign cards", () => {
  const session = { agentId: "main", sessionKey: "home" };
  assert.equal(nativeProgressFromResult({ card: null }, session), null);
  assert.throws(() => nativeProgressFromResult({}, session));
  assert.throws(() => nativeProgressFromResult({ card: { sessionKey: "agent:other:home", revision: 1, updatedAt: 1 } }, session));
  assert.throws(() => nativeProgressFromResult({ card: { sessionKey: "home", revision: 1, updatedAt: 1, markdown: "a".repeat(8193) } }, session));
});
