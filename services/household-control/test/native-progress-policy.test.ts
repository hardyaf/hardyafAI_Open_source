import {decideTaskFinalize} from "../src/task-flow/hooks.ts";
import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { nativeProgressPlanCurrent, projectNativeProgressPlan, validateNativeProgressWrite } from "../src/task-flow/native-progress-policy.ts";
import type { TaskHandoff, VerifiedTaskEvidence } from "../src/task-flow/types.ts";
import type { HouseholdNativeProgress } from "../src/domain.ts";

function state(): TaskHandoff {
  return { schemaVersion: 1, kind: "task_handoff", nativeSessionId: "session", nativeGoalId: "goal", taskId: "goal", objective: "Complete two requested outcomes",
    originalSourcePromptId: "human-source", originalSourceSha256: "source-hash", mode: "normal", selectedDomains: ["lists"], phase: "working", summary: "", nextAction: "Deliver the outcomes",
    outcomes: [{ id: "alpha", description: "Add alpha", evidenceKind: "operation", requiredEffect: { toolName: "household_lists_capture", state: "committed" } },
      { id: "beta", description: "Add beta", evidenceKind: "operation", requiredEffect: { toolName: "household_lists_capture", state: "committed" } }],
    verifications: {}, questionArtifactId: null, replies: [], previousArtifactId: null, terminal: null };
}
const proof: VerifiedTaskEvidence = { kind: "operation", id: "owning-operation", verified: true, digest: "owning-digest", summary: "Owned result", provenance: "owning-domain" };
function card(handoff: TaskHandoff, updatedAt = 200): HouseholdNativeProgress {
  return { sessionKey: "native-session", revision: 1, updatedAt, steps: projectNativeProgressPlan(handoff) };
}

test("native plan projects existing outcomes and an actual verification stage without a second canonical plan", () => {
  const handoff = state(), initial = projectNativeProgressPlan(handoff);
  assert.deepEqual(initial.map(entry => entry.status), ["in_progress", "pending", "pending"]);
  handoff.verifications.alpha = [proof];
  assert.deepEqual(projectNativeProgressPlan(handoff).map(entry => entry.status), ["completed", "in_progress", "pending"]);
  handoff.verifications.beta = [proof];
  assert.deepEqual(projectNativeProgressPlan(handoff).map(entry => entry.status), ["completed", "completed", "in_progress"]);
  handoff.terminal = "complete";
  assert.ok(projectNativeProgressPlan(handoff).every(entry => entry.status === "completed"));
});

test("progress writes cannot invent outcomes, clear unfinished work or overclaim verification", () => {
  const handoff = state(), plan = projectNativeProgressPlan(handoff);
  assert.equal(validateNativeProgressWrite({ plan }, handoff), true);
  assert.equal(validateNativeProgressWrite({ plan: [] }, handoff), false);
  assert.equal(validateNativeProgressWrite({ plan: [{ ...plan[0], step: "Different request" }, ...plan.slice(1)] }, handoff), false);
  assert.equal(validateNativeProgressWrite({ plan: plan.map(entry => ({ ...entry, status: "completed" })) }, handoff), false);
  assert.equal(validateNativeProgressWrite({ plan: plan.map(entry => ({ ...entry, status: "in_progress" })) }, handoff), true);
  assert.equal(validateNativeProgressWrite({ plan, sessionKey: "other-session" }, handoff), false);
  assert.equal(validateNativeProgressWrite({ plan, markdown: "x".repeat(8193) }, handoff), false);
  assert.equal(validateNativeProgressWrite({ plan: [{ ...plan[0], extra: true }, ...plan.slice(1)] }, handoff), false);
});

test("native presentation bounds long Unicode labels without weakening canonical outcomes", () => {
  const handoff = state(), description = "家族の依頼🚀".repeat(600); handoff.outcomes[0].description = description;
  for (let index = 2; index < 40; index++) handoff.outcomes.push({ ...handoff.outcomes[0], id: "outcome-" + index });
  const plan = projectNativeProgressPlan(handoff);
  assert.equal(plan.length, 41); assert.ok(plan.every(entry => Buffer.byteLength(entry.step, "utf8") <= 512));
  assert.ok(plan[0].step.startsWith("alpha: ")); assert.ok(plan[0].step.endsWith("…"));
  assert.equal(handoff.outcomes[0].description, description); assert.equal(validateNativeProgressWrite({ plan }, handoff), true);
});

test("presentation tolerates fresh human prompts, revised labels and reordered stable outcomes", () => {
  const handoff = state(); assert.equal(nativeProgressPlanCurrent(card(handoff), handoff, 100), true);
  assert.equal(nativeProgressPlanCurrent(card(handoff, 99), handoff, 100), true);
  assert.equal(nativeProgressPlanCurrent(card(handoff), handoff, NaN), true);
  assert.equal(nativeProgressPlanCurrent(null, handoff, 100), false);
  const changed = state(); changed.outcomes[0].description = "Updated plan display";
  assert.equal(nativeProgressPlanCurrent(card(handoff), changed, 100), true);
  const reordered = card(handoff); reordered.steps = reordered.steps!.map(entry => ({ ...entry,
    step: entry.step.startsWith("alpha: ") ? "alpha: Different presentation" : entry.step })).reverse();
  assert.equal(validateNativeProgressWrite({ plan: reordered.steps }, handoff), true);
  assert.equal(nativeProgressPlanCurrent(reordered, handoff, 100), true);
  const duplicate = projectNativeProgressPlan(handoff); duplicate[1] = { ...duplicate[0] };
  assert.equal(validateNativeProgressWrite({ plan: duplicate }, handoff), false);
});

test("completed native progress is insufficient without canonical finish and owning verification", () => {
  const handoff = state(); handoff.verifications = { alpha: [proof], beta: [proof] };
  assert.equal(nativeProgressPlanCurrent(card(handoff), handoff, 100, true), false);
  handoff.terminal = "complete"; const completed = card(handoff);
  assert.equal(nativeProgressPlanCurrent(completed, handoff, 100, true), true);
  assert.equal(nativeProgressPlanCurrent(completed, handoff, 100, false), false);
  handoff.verifications.beta = [{ ...proof, verified: false }];
  assert.equal(nativeProgressPlanCurrent(completed, handoff, 100, true), false);
});

test("durable human waiting finalizes without completing or clearing the unfinished native plan", async () => {
  const handoff=state();handoff.questionArtifactId="artifact-question";handoff.phase="waiting_for_user";
  const current=card(handoff);assert.ok(current.steps!.some(step=>step.status!=="completed"));
  const context={scope:{taskId:"goal"},native:{goalId:"goal",goalStatus:"active"},source:{id:"human-source"}} as any;
  const decision=decideTaskFinalize(context,{checkpoint:null,handoff,question:null});
  assert.equal(decision,undefined);
  assert.equal(handoff.terminal,null);assert.ok(current.steps!.some(step=>step.status!=="completed"));
});

test("installed native hook normalization preserves waiting finalize instead of requesting a retry", {
  skip:!process.env.OPENCLAW_TEST_PACKAGE_ROOT&&"Set OPENCLAW_TEST_PACKAGE_ROOT for installed SDK contract verification",
},async()=>{
  const require=createRequire(path.join(process.env.OPENCLAW_TEST_PACKAGE_ROOT!,"package.json"));
  const {runAgentHarnessBeforeAgentFinalizeHook}=await import(pathToFileURL(require.resolve("openclaw/plugin-sdk/agent-harness-runtime")).href);
  let calls=0;
  const normalized=await runAgentHarnessBeforeAgentFinalizeHook({event:{runId:"fixture-waiting-run",lastAssistantMessage:"Which fruit should I add?",messages:[]},ctx:{agentId:"main",sessionKey:"fixture-session",sessionId:"fixture-generation",runId:"fixture-waiting-run"},hookRunner:{hasHooks:()=>true,runBeforeAgentFinalize:async()=>{calls++;return {action:"finalize",reason:"A durable question is waiting for a fresh human reply."};}}});
  assert.equal(normalized.action,"finalize");assert.equal(normalized.retry,undefined);assert.equal(calls,1);
});

test("installed native wrapper applies trusted generated progress params to an empty model call", {
  skip: !process.env.OPENCLAW_TEST_PACKAGE_ROOT && "Set OPENCLAW_TEST_PACKAGE_ROOT for installed SDK contract verification",
}, async () => {
  const require = createRequire(path.join(process.env.OPENCLAW_TEST_PACKAGE_ROOT!, "package.json"));
  const { initializeGlobalHookRunner, resetGlobalHookRunner } = await import(pathToFileURL(require.resolve("openclaw/plugin-sdk/hook-runtime")).href);
  const { wrapToolWithBeforeToolCallHook } = await import(pathToFileURL(require.resolve("openclaw/plugin-sdk/agent-harness-runtime")).href);
  const generated = { plan: projectNativeProgressPlan(state()) };
  const context = { agentId: "main", sessionKey: "fixture-progress", sessionId: "fixture-generation", runId: "fixture-progress-run" };
  let policyCalls = 0, executionCalls = 0;
  try {
    initializeGlobalHookRunner({ hooks: [], plugins: [], typedHooks: [], trustedToolPolicies: [{ pluginId: "hardy-household", origin: "config", source: "fixture-progress-policy",
      policy: { id: "fixture-generated-progress", description: "Use the current application-generated projection", evaluate: async (event: any) => {
        assert.equal(event.toolName, "progress_card"); assert.deepEqual(event.params, {}); policyCalls++;
        return { allow: true, params: structuredClone(generated) };
      } } }] });
    const raw = { name: "progress_card", label: "Progress", description: "Save the generated current-task projection",
      parameters: { type: "object", properties: { plan: { type: "array" } }, required: ["plan"], additionalProperties: false },
      execute: async (_toolCallId: string, params: unknown) => {
        executionCalls++; assert.deepEqual(params, generated);
        return { content: [{ type: "text", text: "Generated progress received" }] };
      } };
    const wrapped = wrapToolWithBeforeToolCallHook(raw, context);
    await wrapped.execute("fixture-progress-call", {});
    assert.equal(policyCalls, 1); assert.equal(executionCalls, 1);
    // This proves the supported policy transformation, not a native continuation callback.
  } finally { resetGlobalHookRunner(); }
});
