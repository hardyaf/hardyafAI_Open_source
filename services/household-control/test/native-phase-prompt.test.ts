import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { HouseholdTaskApplication } from "../src/domain-runtime/task-application.ts";
import type { TaskApplicationBinding, TaskApplicationOptions } from "../src/domain-runtime/task-application.ts";
import type { HouseholdCheckpoint } from "../src/domain.ts";
import type { ArtifactMetadata } from "../src/platform/artifacts.ts";

const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const rootObjective = "ROOT-ASSIGNMENT: Add alpha in the parent, spawn a beta child, then verify both and complete the original goal.";
const parentNextAction = "ROOT-NEXT: delegate beta, yield, verify both alpha and beta, complete root";
const selectedInstructions = "SELECTED-LISTS-CONTRACT: Read the scoped list and capture only the entries assigned to the current worker; verify returned item IDs.";

function fixture(mode: TaskApplicationBinding["task"]["mode"] = "normal") {
  let checkpoint: HouseholdCheckpoint | null = null;
  let checkpointWrites = 0;
  const objects = new Map<string, { metadata: ArtifactMetadata; bytes: Buffer }>();
  const root: TaskApplicationBinding = { task: {
    principal: { profileId: "alex", canReadHousehold: true },
    scope: { ownerProfileId: "alex", conversationId: "conversation-phase", taskId: "original-goal", audience: "household" },
    native: { sessionId: "original-session", sessionKey: "original-key", goalId: "original-goal", goalStatus: "active", objective: rootObjective, runId: "root-run" },
    source: { id: "original-human-source", text: rootObjective, sha256: sha(rootObjective), human: true },
    mode, artifactIds: ["original-input"], assertCurrent() {},
  }, execution: { agentId: "main", sessionKey: "original-key", sessionId: "original-session", runId: "root-run", sandboxed: false } };
  const child: TaskApplicationBinding = { task: root.task,
    execution: { agentId: "main", sessionKey: "phase-child-key", sessionId: "phase-child-session", runId: "phase-child-run", sandboxed: false } };
  let current = root;
  const options: TaskApplicationOptions = {
    database: {
      getCheckpoint: () => checkpoint,
      updateCheckpoint: (conversationId, update) => {
        assert.equal(update.expectedRevision, checkpoint?.revision ?? 0);
        checkpointWrites++;
        checkpoint = { conversationId, nativeSessionId: update.nativeSessionId, nativeGoalId: update.nativeGoalId,
          revision: update.expectedRevision + 1, phase: update.phase, questionArtifactId: update.questionArtifactId ?? null,
          checkpointArtifactId: update.checkpointArtifactId ?? null, updatedAt: new Date().toISOString() };
        return checkpoint;
      },
    },
    artifacts: {
      read: async id => { const value = objects.get(id); if (!value) throw Error("fixture_artifact_missing"); return { metadata: structuredClone(value.metadata), bytes: Buffer.from(value.bytes) }; },
      put: async (scope, _principal, input) => {
        const id = "artifact-" + sha(input.idempotencyKey ?? input.bytes);
        const metadata: ArtifactMetadata = { ...scope, schemaVersion: 1, id, filename: input.filename, mimeType: input.mimeType,
          kind: input.kind, byteLength: input.bytes.length, sha256: sha(input.bytes), createdAt: new Date().toISOString() };
        objects.set(id, { metadata, bytes: Buffer.from(input.bytes) }); return metadata;
      },
    } as TaskApplicationOptions["artifacts"],
    resolveContext: async () => current,
    loadCatalog: () => [{ id: "lists", description: "Scoped household shopping lists", instructions: selectedInstructions, tools: ["household_lists_capture"] }],
    effectsEvidence: async () => [], policies: { assertReady: async () => {} },
    spawn: async () => { throw Error("test_does_not_spawn"); }, child: async () => { throw Error("test_does_not_read_child"); },
    sandboxRoots: ["/fixture/sandboxes"], domainToolNames: ["household_lists_capture"],
  };
  const app = new HouseholdTaskApplication(options);
  async function seed() {
    await app.execute("household_task_checkpoint", { expectedRevision: 0, phase: "working", summary: "ROOT-SUMMARY: alpha has been added; beta remains",
      nextAction: parentNextAction, outcomes: [{ id: "both-entries", description: "ROOT-OUTCOME: alpha and beta both exist", evidenceKind: "operation",
        requiredEffect: { toolName: "household_lists_capture", state: "committed" } }] }, {});
    await app.execute("household_task_select_domains", { expectedRevision: checkpoint!.revision, domains: ["lists"] }, {});
  }
  return { app, root, child, seed, useChild: () => { current = child; }, writes: () => checkpointWrites,
    setAnalysisPolicy: (policy: TaskApplicationOptions["analysisToolPolicy"]) => { options.analysisToolPolicy = policy; },
    setEvidence: (reader: TaskApplicationOptions["effectsEvidence"]) => { options.effectsEvidence = reader; } };
}

test("phase child keeps original authority and selected skill without inheriting the root assignment", async () => {
  const f = fixture(); await f.seed();
  const before = await f.app.flow.snapshot(f.root.task);
  const childPrompt = await f.app.prompt(f.child);
  const data = JSON.parse(childPrompt.appendContext.slice(childPrompt.appendContext.indexOf("\n") + 1));
  assert.equal(data.executionRole, "phase_child");
  assert.equal(data.parentTask.native.goalId, "original-goal");
  assert.equal(data.parentTask.sourcePromptId, "original-human-source");
  assert.equal(data.parentTask.audience, "household");
  assert.equal(data.parentTask.native.objective, undefined);
  assert.equal(data.handoff, undefined);
  assert.deepEqual(data.coordinationTools.map((tool: any) => tool.nativeName).sort(), ["household_task_context", "household_task_select_domains"]);
  assert.match(childPrompt.prependSystemContext, /assignment supplied by your current parent/i);
  assert.match(childPrompt.prependSystemContext, /parent.*(?:goal|completion)/i);
  assert.ok(childPrompt.prependSystemContext.includes(selectedInstructions));
  for (const forbidden of [rootObjective, parentNextAction, "ROOT-SUMMARY:", "ROOT-OUTCOME:"])
    assert.ok(!childPrompt.appendContext.includes(forbidden), `Child prompt inherited ${forbidden}`);
  for (const preserved of ["original-goal", "original-human-source", "household"])
    assert.ok(childPrompt.appendContext.includes(preserved), `Missing original boundary ${preserved}`);
  assert.doesNotMatch(childPrompt.prependSystemContext, /For multi-phase work, checkpoint the original goal/);
  assert.doesNotMatch(childPrompt.prependSystemContext, /Before finishing, attach actual evidence for every outcome/);
  assert.doesNotMatch(childPrompt.prependSystemContext, /In ordinary conversation, automatically remember/);
  assert.doesNotMatch(childPrompt.appendContext, /goalStartObjective/);
  for (const name of ["household_task_complete", "household_task_finish", "household_task_stop", "create_goal", "update_goal"])
    assert.ok(!childPrompt.toolsAllow?.includes(name), `Child exposed root control ${name}`);
  assert.ok(childPrompt.toolsAllow?.includes("household_lists_capture"));
  assert.ok(childPrompt.toolsAllow?.includes("sessions_spawn"), "A genuinely narrower delegation stays available");
  assert.deepEqual(await f.app.flow.snapshot(f.root.task), before, "Prompt projection must not rewrite root durable state");
});

test("the original parent still restores its complete objective, handoff and conductor", async () => {
  const f = fixture(); await f.seed();
  const prompt = await f.app.prompt(f.root);
  for (const required of [rootObjective, parentNextAction, "ROOT-SUMMARY:", "ROOT-OUTCOME:"])
    assert.ok(prompt.appendContext.includes(required), `Root projection lost ${required}`);
  assert.ok(prompt.prependSystemContext.includes(selectedInstructions));
  assert.match(prompt.prependSystemContext, /optional coordination/);
  assert.match(prompt.prependSystemContext, /Curation is optional/);
  assert.ok(!prompt.toolsAllow?.includes("household_task_finish"));
  assert.ok(!prompt.toolsAllow?.includes("household_task_verify_outcome"));
  assert.ok(prompt.toolsAllow?.includes("household_task_complete"));
  assert.ok(prompt.toolsAllow?.includes("update_goal"));
  assert.match(prompt.prependSystemContext, /exact supplied id and typed args/);
  assert.match(prompt.prependSystemContext, /invoke tool_call with the exact supplied id/);
  assert.ok(prompt.toolsAllow?.includes("sessions_yield"), "Native direct-only yield remains visible");
  assert.match(prompt.prependSystemContext, /sessions_yield is direct.only/);
  assert.match(prompt.prependSystemContext, /visible sessions_yield function directly, never tool_call or tool_search/);
  assert.match(prompt.prependSystemContext, /original parent controls/);
  assert.doesNotMatch(prompt.prependSystemContext, /before business writes|exactly the supplied bounded step labels/);
  const data = JSON.parse(prompt.appendContext.slice(prompt.appendContext.indexOf("\n") + 1));
  assert.deepEqual(data.coordinationTools.map((tool: any) => tool.nativeName).sort(), ["household_task_ask_question", "household_task_bind_reply", "household_task_complete", "household_task_context", "household_task_select_domains"]);
  for (const tool of data.coordinationTools) {
    assert.equal(tool.id, "openclaw:hardy-household:"+tool.nativeName); assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
  assert.ok(!data.coordinationTools.some((tool: any) => tool.nativeName === "household_lists_capture"), "Domain schemas belong to selected context responses");
});

test("phase projection does not turn a brain-dump child into the root planner", async () => {
  const f = fixture("brain_dump"); await f.seed();
  const prompt = await f.app.prompt(f.child);
  assert.doesNotMatch(prompt.prependSystemContext, /Brain-dump mode was selected/);
  assert.doesNotMatch(prompt.prependSystemContext, /Read the complete dump and compose its/);
  assert.ok(!prompt.appendContext.includes(rootObjective));
  assert.ok(prompt.prependSystemContext.includes(selectedInstructions));
});

test("phase child cannot finish or complete the original goal even by calling hidden controls", async () => {
  const f = fixture(); await f.seed(); f.useChild();
  const before = f.writes();
  assert.equal((await f.app.guard(f.child, { toolName: "household_task_finish", params: { expectedRevision: before, summary: "Beta phase delivered" } })).allow, false);
  await assert.rejects(() => f.app.execute("household_task_finish", { expectedRevision: before, summary: "Beta phase delivered" }, {}), /task_parent_completion_required/);
  assert.equal((await f.app.guard(f.child, { toolName: "household_task_complete", params: { summary: "Beta phase delivered" } })).allow, false);
  await assert.rejects(() => f.app.execute("household_task_complete", { summary: "Beta phase delivered" }, {}), /task_parent_completion_required/);
  assert.equal((await f.app.guard(f.child, { toolName: "update_goal", params: { status: "complete" } })).allow, false);
  assert.equal((await f.app.guard(f.child, { toolName: "create_goal", params: { objective: "Only add beta" } })).allow, false);
  assert.equal(f.writes(), before, "Rejected completion must not mutate original checkpoint");
  assert.equal(await f.app.finalize(f.child), undefined, "Child finalization does not run root completion repair");
});

test("diagnosis remains sticky in the phase projection without becoming root orchestration", async () => {
  const f = fixture("diagnostic"); await f.seed();
  const prompt = await f.app.prompt(f.child);
  assert.match(prompt.prependSystemContext, /DIAGNOSIS-ONLY/);
  assert.match(prompt.prependSystemContext, /may not apply a repair/);
  assert.doesNotMatch(prompt.prependSystemContext, /For multi-phase work, checkpoint the original goal/);
  assert.ok(!prompt.appendContext.includes(rootObjective));
  for (const name of ["progress_card", "household_task_complete", "household_task_finish", "household_task_stop", "create_goal", "update_goal"])
    assert.ok(!prompt.toolsAllow?.includes(name), `Diagnostic phase child exposed root control ${name}`);
  assert.equal((await f.app.guard(f.child, { toolName: "sessions_spawn", params: { task: "Apply the fix", completionTarget: "parent" } })).allow, false);
});

test("ordinary source-bound actions need no goal ceremony or root progress instruction", async () => {
  const f = fixture(); f.root.task.native.goalId = null; f.root.task.native.goalStatus = null;
  const prompt = await f.app.prompt(f.root);
  assert.match(prompt.prependSystemContext, /No guide-loading step, formal goal, plan, question helper, outcome declaration or completion ceremony/);
  assert.match(prompt.prependSystemContext, /Curation is optional/i);
  assert.doesNotMatch(prompt.prependSystemContext, /When unfinished work needs native next-turn continuation/);
  assert.equal(f.writes(), 0);
  const data = JSON.parse(prompt.appendContext.slice(prompt.appendContext.indexOf("\n") + 1));
  assert.deepEqual(data.coordinationTools.map((tool: any) => tool.nativeName).sort(), ["household_task_ask_question", "household_task_bind_reply", "household_task_context", "household_task_select_domains"]);
});

test("restored prompt carries evidence handles without copying owner receipt bodies", async () => {
  const f = fixture(); await f.seed();
  f.setEvidence(async (_context, refs) => refs.map(ref => ({ ...ref, verified: true, digest: sha("owner-readback"),
    summary: "PRIVATE-OWNER-DETAIL-THAT-NEED-NOT-BE-IN-EVERY-PROMPT", provenance: "owner-receipt", effect: { toolName: "household_lists_capture", state: "committed" } })));
  await f.app.flow.associateEvidence(f.root.task, { references: [{ kind: "operation", id: "actual-list-operation" }] });
  const prompt = await f.app.prompt(f.root), data = JSON.parse(prompt.appendContext.slice(prompt.appendContext.indexOf("\n") + 1));
  assert.deepEqual(data.handoff.verifications["both-entries"], [{ kind: "operation", id: "actual-list-operation" }]);
  assert.doesNotMatch(prompt.appendContext, /PRIVATE-OWNER-DETAIL/);
});


test("fixed native analysis prompt excludes coordination and household business schemas", async () => {
  const f = fixture(); await f.seed(); f.child.execution.agentId = "household-analysis"; f.child.execution.sandboxed = true;
  const prompt = await f.app.prompt(f.child), data = JSON.parse(prompt.appendContext.slice(prompt.appendContext.indexOf(": ") + 2));
  assert.equal(data.coordinationTools, undefined);
  assert.ok(prompt.toolsAllow?.includes("household_analysis_publish_output"));
  assert.match(prompt.prependSystemContext,/"command":"python3 analysis.py"/);
  assert.match(prompt.prependSystemContext,/visible household_analysis_publish_output/);
  for (const name of ["household_task_context", "household_task_select_domains", "household_task_complete", "household_lists_capture", "tool_search", "tool_describe", "tool_call"])
    assert.ok(!prompt.toolsAllow?.includes(name), "Fixed sandbox helper exposed " + name);
});

test("ordinary analysis supplies its operation identity without a manufactured goal",async()=>{
  const f=fixture();f.root.task.native.goalId=null;f.root.task.native.goalStatus=null;
  await assert.rejects(()=>f.app.execute("household_analysis_start",{instruction:"Compute a local summary",inputArtifactIds:[]},{}),/test_does_not_spawn/);
});


test("phase child cannot create or bind the parent's durable human questions",async()=>{
  const f=fixture();await f.seed();f.useChild();const before=f.writes();
  for(const [toolName,params] of [["household_task_ask_question",{question:"Which day?",reason:"Child needs a date"}],["household_task_bind_reply",{relation:"answer"}]] as const){
    assert.equal((await f.app.guard(f.child,{toolName,params})).allow,false);
    await assert.rejects(()=>f.app.execute(toolName,params,{}),/task_parent_question_required/);
    assert.ok(!(await f.app.prompt(f.child)).toolsAllow?.includes(toolName));
  }
  assert.equal(f.writes(),before,"Rejected child question mutations preserve the parent's handoff");
});


test("an independent topic does not inherit original-goal continuation progress instructions",async()=>{
  const f=fixture();await f.seed();await f.app.flow.execute("task.ask_question",{question:"Which day?",reason:"Missing date"},f.root.task);
  const side={...f.root,task:{...f.root.task,source:{id:"side-human-source",text:"Add dish soap",sha256:sha("Add dish soap"),human:true}}};
  await f.app.flow.execute("task.bind_reply",{relation:"new_topic"},side.task);
  const prompt=await f.app.prompt(side);assert.doesNotMatch(prompt.prependSystemContext,/A progress RPC alone does not arm native continuation/);assert.match(prompt.prependSystemContext,/do not publish original-goal progress/i);
});


test("ordinary analysis cannot repair a typed-helper refusal by manufacturing native goal authority",async()=>{
  const f=fixture();f.root.task.native.goalId=null;f.root.task.native.goalStatus=null;
  const prompt=await f.app.prompt(f.root),data=JSON.parse(prompt.appendContext.slice(prompt.appendContext.indexOf("\n")+1));
  assert.equal(data.goalStartAvailable,false);assert.ok(!prompt.toolsAllow?.includes("create_goal"));
  assert.match(prompt.prependSystemContext,/No guide-loading step/);
  const decision=await f.app.guard(f.root,{toolName:"create_goal",params:{objective:"current request"}});assert.equal(decision.allow,false);
  await assert.rejects(()=>f.app.execute("household_analysis_start",{instruction:"Make a local visual",inputArtifactIds:[]},{}),/test_does_not_spawn/);
  assert.equal(f.writes(),0,"No formal goal or task checkpoint is required for typed analysis admission");
});

test("enabled native attachment projection never authorizes raw family spawn attachments",async()=>{
  const f=fixture(),nativePolicy={tools:{sessions_spawn:{attachments:{enabled:true,maxFiles:32,maxTotalBytes:16777216,maxFileBytes:16777216,retainOnSessionKeep:true}}}};
  assert.equal(nativePolicy.tools.sessions_spawn.attachments.enabled,true);
  const args={task:"A bounded same-agent phase",agentId:"main",runtime:"subagent",mode:"run",cleanup:"keep",completionTarget:"parent",visible:false,thread:false};
  assert.equal((await f.app.guard(f.root,{toolName:"sessions_spawn",params:args})).allow,true);
  for(const additional of [{attachments:[{name:"data.csv",content:"private bytes"}]},{attachAs:{mountPath:"/inputs"}},{attachments:[]}])
    assert.equal((await f.app.guard(f.root,{toolName:"sessions_spawn",params:{...args,...additional}})).allow,false,"Actual application guard rejects raw attachment arguments regardless of native support");
  assert.equal((await f.app.guard(f.root,{toolName:"sessions_spawn",params:{...args,agentId:"household-analysis"}})).allow,false,"The typed boundary owns the analysis helper target");
  assert.equal(f.writes(),0);
});


test("analysis exec pins the sandbox and tolerates only an inert false privilege field",async()=>{
  const f=fixture();f.child.execution.agentId="household-analysis";f.child.execution.sandboxed=true;
  let sandboxProven=true;f.setAnalysisPolicy(async()=>sandboxProven);
  const command="python3 analysis.py",guard=(params:Record<string,unknown>)=>f.app.guard(f.child,{toolName:"exec",params});
  assert.deepEqual(await guard({command}),{allow:true,params:{command,host:"sandbox"}});
  assert.deepEqual(await guard({command,elevated:false}),{allow:true,params:{command,host:"sandbox"}});
  for(const override of [{host:"gateway"},{elevated:true},{elevated:null},{node:"other-host"},{security:"full"},{ask:"list"},{ask:"off"}])
    assert.equal((await guard({command,...override})).allow,false);
  const publish={toolName:"household_analysis_publish_output",params:{}};
  assert.equal((await f.app.guard(f.child,publish)).allow,true);
  assert.equal((await f.app.guard(f.root,publish)).allow,false);
  assert.equal((await f.app.guard(f.child,{toolName:"tool_call",params:{id:"openclaw:hardy-household:household_analysis_publish_output"}})).allow,false);
  sandboxProven=false;assert.equal((await guard({command})).allow,false);assert.equal((await f.app.guard(f.child,publish)).allow,false);
});
