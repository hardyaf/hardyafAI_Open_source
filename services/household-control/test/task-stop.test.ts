import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { HouseholdTaskApplication } from "../src/domain-runtime/task-application.ts";
import type { TaskApplicationBinding, TaskApplicationOptions } from "../src/domain-runtime/task-application.ts";

function fixture(change?: (binding: TaskApplicationBinding) => void) {
  let active = true, stops = 0, writes = 0;
  const binding: TaskApplicationBinding = { task: {
    principal: { profileId: "alex", canReadHousehold: true }, scope: { ownerProfileId: "alex", conversationId: "conversation-a", taskId: "goal-a", audience: "private" },
    native: { sessionId: "parent-session", sessionKey: "parent-key", goalId: "goal-a", goalStatus: "active", objective: "Create an event", runId: "run-b" },
    source: { id: "fresh-human-b", text: "Please stop this task", sha256: createHash("sha256").update("Please stop this task").digest("hex"), human: true },
    mode: "normal", artifactIds: [], assertCurrent() { if (!active) throw Error("control_revoked_source"); },
  }, execution: { agentId: "main", sessionKey: "parent-key", sessionId: "parent-session", runId: "run-b", sandboxed: false } };
  change?.(binding);
  const options: TaskApplicationOptions = {
    database: { getCheckpoint: () => null, updateCheckpoint: () => { writes++; throw Error("unexpected_checkpoint_after_stop"); } },
    artifacts: { read: async () => { throw Error("unexpected_artifact_read"); }, put: async () => { writes++; throw Error("unexpected_artifact_write"); } } as TaskApplicationOptions["artifacts"],
    resolveContext: async () => binding, loadCatalog: () => [{ id: "calendar", description: "Calendar", instructions: "Use the scoped calendar tools", tools: ["household_calendar_query"] }], effectsEvidence: async () => [],
    policies: { assertReady: async () => {} }, spawn: async () => { throw Error("unexpected_spawn"); }, child: async () => { throw Error("unexpected_child"); }, sandboxRoots: ["/native/sandboxes"],
    stop: async (current, request) => { stops++; active = false; return { state: "paused", goalId: current.task.native.goalId!, operationId: request.operationId, receipt: { persisted: true } }; },
  };
  const app = new HouseholdTaskApplication(options);
  return { app, binding, options, stops: () => stops, writes: () => writes };
}

test("fresh human stop uses owning native control and never writes after it revokes admission", async () => {
  const f = fixture();
  const result = await f.app.execute("household_task_stop", { operationId: "stop-operation-a", note: "Human requested stopping" }, {}) as { state: string; taskComplete: boolean; effectsRolledBack: boolean };
  assert.equal(result.state, "paused"); assert.equal(result.taskComplete, false); assert.equal(result.effectsRolledBack, false);
  assert.equal(f.stops(), 1); assert.equal(f.writes(), 0);
});
test("scheduled and child executions cannot authorize root stop", async () => {
  for (const change of [(binding: TaskApplicationBinding) => { binding.task.source.human = false; },
    (binding: TaskApplicationBinding) => { binding.execution.sessionId = "child-session"; }]) {
    const f = fixture(change);
    await assert.rejects(() => f.app.execute("household_task_stop", { operationId: "stop-operation-a" }, {}), /task_stop_fresh_human_root_required/);
    assert.equal(f.stops(), 0);
  }
});
test("diagnostic task may honor its human stop without granting repair authority", async () => {
  const f = fixture(binding => { binding.task.mode = "diagnostic"; });
  assert.equal((await f.app.guard(f.binding, { toolName: "household_task_stop", params: { operationId: "stop-operation-a" } })).allow, true);
  const result = await f.app.execute("household_task_stop", { operationId: "stop-operation-a" }, {}) as { state: string };
  assert.equal(result.state, "paused");
});
test("brain dumps use ordinary typed actions without inventing native goal-creation authority",async()=>{
  const f=fixture(binding=>{binding.task.mode="brain_dump";binding.task.native.goalId=null;binding.task.native.goalStatus=null;binding.task.native.objective=null;});
  const prompt=await f.app.prompt(f.binding),data=JSON.parse(prompt.appendContext.slice(prompt.appendContext.indexOf("\n")+1));
  assert.equal(data.goalStartAvailable,false);assert.ok(!prompt.toolsAllow?.includes("create_goal"));
  assert.doesNotMatch(prompt.prependSystemContext,/brain.dump admission requires a durable native goal/i);
  const decision=await f.app.guard(f.binding,{toolName:"create_goal",params:{objective:"current request"}});
  assert.equal(decision.allow,false);assert.match((decision as any).reason,/household_analysis_start/);assert.match((decision as any).reason,/household_analysis_result/);
  assert.equal(f.writes(),0);
});

test("only an explicit trusted system policy can create its exact native objective",async()=>{
  const f=fixture(binding=>{binding.task.native.goalId=null;binding.task.native.goalStatus=null;binding.task.native.objective=null;binding.task.source.human=false;});
  f.options.allowGoalCreation=()=>true;
  const prompt=await f.app.prompt(f.binding),data=JSON.parse(prompt.appendContext.slice(prompt.appendContext.indexOf("\n")+1));
  assert.equal(data.goalStartAvailable,true);assert.ok(prompt.toolsAllow?.includes("create_goal"));assert.match(prompt.prependSystemContext,/explicit trusted system goal.creation policy/);
  for(const objective of ["current request","Model text cannot replace the real source"]){
    const decision=await f.app.guard(f.binding,{toolName:"create_goal",params:{objective}});
    assert.equal(decision.allow,true);assert.deepEqual((decision as any).params,{objective:f.binding.task.source.text});
  }
  assert.equal((await f.app.guard(f.binding,{toolName:"create_goal",params:{objective:"current request",token_budget:999}})).allow,false);
  f.options.allowGoalCreation=()=>false;assert.equal((await f.app.guard(f.binding,{toolName:"create_goal",params:{objective:"current request"}})).allow,false);
  assert.equal(f.writes(),0);
});

test("without an active goal authorized domain instructions load ephemerally without durable writes", async () => {
  const f = fixture(binding => { binding.task.native.goalId = null; binding.task.native.goalStatus = null; binding.task.scope.taskId = "conversation:conversation-a"; });
  const result = await f.app.execute("household_task_select_domains", { expectedRevision: 0, domains: ["calendar"] }, {}) as {
    ephemeral: boolean; selectedDomains: string[]; contexts: Array<{ id: string; instructions: string }>;
  };
  assert.equal(result.ephemeral, true); assert.deepEqual(result.selectedDomains, ["calendar"]);
  assert.equal(result.contexts[0].instructions, "Use the scoped calendar tools");
  assert.equal(f.writes(), 0);
  await assert.rejects(() => f.app.execute("household_task_select_domains", { expectedRevision: 0, domains: ["secrets"] }, {}), /task_domain_not_authorized/);
  assert.equal(f.writes(), 0);
  const context = await f.app.execute("household_task_context", {}, {}) as { handoff: unknown };
  assert.equal(context.handoff, null); assert.equal(f.writes(), 0);
});

test("ordinary questions are goal-free while durable phase handoffs retain native goal ownership", async () => {
  const f = fixture(binding => { binding.task.native.goalId = null; binding.task.native.goalStatus = null; });
  const question = { expectedRevision: 0, question: "Which date?", reason: "The task needs its date" };
  assert.equal((await f.app.guard(f.binding, { toolName: "household_task_ask_question", params: question })).allow, true);
  // This fixture intentionally has no writer; reaching it proves the ordinary question passed goal admission.
  await assert.rejects(() => f.app.execute("household_task_ask_question", question, {}), /unexpected_artifact_write/);
  await assert.rejects(() => f.app.execute("household_task_checkpoint", { expectedRevision: 0, phase: "planning", summary: "Plan", nextAction: "Ask for date" }, {}), /active_native_goal_required/);
  assert.equal(f.writes(), 1);
  f.binding.task.native.goalId = "new-active-goal"; f.binding.task.native.goalStatus = "active";
  assert.equal((await f.app.guard(f.binding, { toolName: "household_task_ask_question", params: question })).allow, true);
  f.binding.task.native.goalStatus = "complete";
  assert.equal((await f.app.guard(f.binding, { toolName: "household_task_ask_question", params: question })).allow, false);
});
