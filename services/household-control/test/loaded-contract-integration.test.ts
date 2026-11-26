import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { HouseholdDatabase } from "../src/database.ts";
import { HouseholdDomainRuntime } from "../src/domain-runtime/runtime.ts";
import type { DomainConfiguration } from "../src/domain-runtime/configuration.ts";
import type { OpenClawAgentAdapter } from "../src/openclaw-adapter.ts";
import { ArtifactStore } from "../src/platform/artifacts.ts";
import { buildNativeExecutionProfiles } from "../src/platform/native-execution.ts";
import { projectNativeProgressPlan } from "../src/task-flow/native-progress-policy.ts";
import type { HouseholdNativeProgress } from "../src/domain.ts";

const sourceText = "Fred Fixture likes blue.";
async function fixture(activeGoal = false,nativeSandboxCheck?:(sessionKey:string,agentId:string)=>Promise<void>,
  source: { audience?: "private" | "household"; mode?: "normal" | "brain_dump" | "diagnostic" } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "hardy-loaded-integration-"));
  const skills = path.join(directory, "skills"), workspace = path.join(directory, "workspace");
  await mkdir(skills); await mkdir(workspace);
  const instructions: Record<string, string> = { memory: "MEMORY-CONTRACT-V1: retain exact verified human quotations and scoped sources.",
    contacts: "CONTACTS-CONTRACT-V1: extract locally, save every card and report fields.", documents: "DOCUMENTS-CONTRACT-V1: use only local extraction.", lists: "LISTS-CONTRACT-V1: use stable owning item IDs." };
  for (const [id, text] of Object.entries(instructions)) await writeFile(path.join(skills, id + ".md"), text);
  await writeFile(path.join(skills, "household-domains.json"), JSON.stringify({ schemaVersion: 1,
    domains: Object.fromEntries(Object.keys(instructions).map(id => [id, { path: id + ".md" }])) }));
  const database = new HouseholdDatabase(":memory:"), sql = database.domainConnection();
  sql.prepare("INSERT INTO devices(id,profile_id,display_name,public_key_der_base64,status,enrolled_at) VALUES('fixture-device','alex','Fixture','not-a-real-key','active',?)").run(new Date().toISOString());
  const conversation = { id: "contract-conversation", ownerProfileId: "alex", agentId: "main", sessionKey: "hardy-home:contract-test", title: "Contract fixture", presetId: null, audience: source.audience ?? "private", updatedAt: new Date().toISOString() };
  database.insertConversation(conversation);
  database.submissions.enqueue({ submissionId: "fixture-source", conversationId: conversation.id, profileId: "alex", agentId: "main",
    textHash: createHash("sha256").update(sourceText).digest("hex"), requestHash: "fixture-request", payload: { kind: "message", text: sourceText, ...(activeGoal ? { goalStart: { issuedAtMs: Date.now() } } : {}) }, originDeviceId: "fixture-device", taskContext: { mode: source.mode && source.mode !== "normal" ? source.mode : activeGoal ? "task" : "conversation" } });
  assert.equal(database.getSubmissionDomainBinding("fixture-source")!.goalBound, activeGoal, "Fixture retains real atomic goal-start admission semantics");
  const claim = database.submissions.claimNext(2, 120000)!;
  database.submissions.accepted(claim.receipt.submissionId, claim.leaseToken!, { ...claim.receipt, status: "running", runId: "root-run", goalId: activeGoal ? "original-goal" : null });
  const grant = { enabled: true, domains: ["memory", "contacts", "documents", "lists", "analysis"], scopes: ["personal", "household"] as Array<"personal" | "household">,
    contactEditing: true, projectCodes: [], canManageProjects: false, canReviewReceipts: false, allowedAttendees: [], sharedDomains: ["memory", "contacts", "documents", "lists", "analysis"] };
  const configuration: DomainConfiguration = { version: 1, profiles: { alex: grant },
    capture: { python: process.env.HARDY_TEST_PYTHON ?? "/usr/bin/python3", script: path.resolve(import.meta.dirname, "../../../skills/household-capture/scripts/capture.py"), workspaces: { main: workspace } },
    google: { gogBinary: "/unused/gog", account: "fixture@example.test", client: "fixture", calendarId: "fixture", timezone: "UTC" },
    memory: { workspaces: { main: workspace }, sharedAgentId: "main", wikiVaults: { main: path.join(directory, "wiki") } },
    documents: { python: "/unused/python", script: "/unused/documents", cacheRoot: path.join(directory, "cache") },
    execution: { skillsRoot: skills, nativeConfigPath: path.join(directory, "native.json"), openclawBinary: "/unused/openclaw", sandboxImage: "fixture:unused", sandboxRoots: [path.join(directory, "sandboxes")], nativeEntries: [], schedulingEnabled: false },
    uplift: { python: "/unused/python", moduleRoot: directory, database: path.join(directory, "uplift.sqlite"), vaultRoot: path.join(directory, "receipts") } };
  let reads = 0, progress: HouseholdNativeProgress | null = null, progressReads = 0, loseCompletionResponse = false;
  let nativeGoal: { id: string; objective: string; status: string; updatedAt: number } | null = activeGoal ? { id: "original-goal", objective: sourceText, status: "active", updatedAt: Date.now() } : null;
  let nativeRunId: string | null = "root-run";
  let analysisChildState="complete",analysisChildReads=0;
  const nativeMutations: Array<{ operation: any; expectedSessionId?: string }> = [];
  const publishedPlans: unknown[] = [];
  // Only the native transport/provider reads are replaced; application, scoped
  // admission, source/device fences, grants, contracts and artifacts are real.
  const adapter = { getContext: async () => ({ sessionKey: conversation.sessionKey, sessionId: "root-session", runId: nativeRunId,
    goal: nativeGoal && { ...nativeGoal },
    continuationPending: false, parentSessionKey: null, contextTokens: null, contextBudgetStatus: null }),
    observeAnalysisChild:async (args:Parameters<OpenClawAgentAdapter["observeAnalysisChild"]>[0])=>{
      args.assertCurrent();analysisChildReads++;
      assert.equal(args.childSessionKey,"agent:household-analysis:subagent:wake-child");
      assert.equal(args.runId,"analysis-wake-child-run");
      assert.equal(args.expectedSessionId,"analysis-child-session");
      assert.equal(args.parentSessionKey,"agent:main:"+conversation.sessionKey);
      return {state:analysisChildState};
    },
    listMessages: async () => [{ id: "fixture-source", role: "user", text: sourceText }], getProgress: async () => { progressReads++; return progress; },
    putProgress: async (_conversation: unknown, plan: unknown, current: () => void) => { current(); publishedPlans.push(structuredClone(plan)); },
    mutateGoal: async (_conversation: unknown, operation: any, current: () => void, expectedSessionId?: string) => {
      current(); nativeMutations.push({ operation: structuredClone(operation), expectedSessionId });
      if (!nativeGoal || operation.goalId !== nativeGoal.id || expectedSessionId !== "root-session" || operation.action !== "complete") throw Error("fixture_wrong_native_target");
      nativeGoal = { ...nativeGoal, status: "complete", updatedAt: Date.now() };
      if (loseCompletionResponse) { loseCompletionResponse = false; throw Object.assign(Error("Native completion reply was lost"), { code: "fixture_reply_lost" }); }
      return { goalId: nativeGoal.id, status: "complete", runId: "root-run", replayed: false };
    },
    requestDomainCapability: async () => { reads++; return { status: "ready" }; } } as unknown as OpenClawAgentAdapter;
  const artifacts = new ArtifactStore({ root: path.join(directory, "artifacts") });await artifacts.initialize();
  const runtime = new HouseholdDomainRuntime({ database, adapter, artifacts, configuration, nativeSandboxCheck });
  const rootGrant = { sessionKey: conversation.sessionKey, rootSessionKey: conversation.sessionKey, sourceId: "fixture-source", parentSessionKey: null,
    agentId: "main", sessionId: "root-session", goalId: activeGoal ? "original-goal" : null, runId: "root-run", mode: source.mode ?? "normal" };
  runtime.admission.authority.bind(rootGrant);
  const context = { agentId: "main", sessionKey: conversation.sessionKey, sessionId: "root-session", runId: "root-run", assertInvocationCurrent() {} };
  const binding = () => runtime.getTaskContext(context);
  const revision = () => database.getCheckpoint(conversation.id, "root-session", rootGrant.goalId)?.revision ?? 0;
  const select = (domains = ["memory"]) => runtime.execute("household_task_select_domains", { expectedRevision: revision(), domains }, context);
  const guard = async (toolName = "household_memory_status", params = { scope: "personal" }) => runtime.taskGuard(await binding(), { toolName, params }, context);
  return { directory, skills, workspace, instructions, database, sql, artifacts, runtime, configuration, context, rootGrant, conversation, binding, revision, select, guard, reads: () => reads,
    setProgress: (value: HouseholdNativeProgress | null) => { progress = value; }, progressReads: () => progressReads,
    nativeMutations, publishedPlans, failCompletionResponseOnce: () => { loseCompletionResponse = true; },
    setNativeRunId: (value: string | null) => { nativeRunId = value; },
    setAnalysisChildState:(value:string)=>{analysisChildState=value;},analysisChildReads:()=>analysisChildReads,
    setNativeGoalStatus: (status: string) => { if (!nativeGoal) throw Error("No native goal"); nativeGoal = { ...nativeGoal, status }; },
    close: async () => { await runtime.close(); database.close(); await rm(directory, { recursive: true, force: true }); } };
}

test("public web exposure and invocation require an explicit current normal-chat root grant", async () => {
  const f = await fixture();
  try {
    const search = { toolName: "web_search", params: { query: "public source fixture" } };
    const fetch = { toolName: "web_fetch", params: { url: "https://example.com" } };
    const root = await f.binding();
    assert.equal((await f.runtime.taskPrompt(root)).toolsAllow.includes(search.toolName), false);
    assert.equal((await f.runtime.taskGuard(root, search, f.context)).allow, false);

    f.configuration.profiles.alex.domains.push("web");
    const prompt = await f.runtime.taskPrompt(root);
    assert.ok(prompt.toolsAllow.includes(search.toolName) && prompt.toolsAllow.includes(fetch.toolName));
    assert.match(prompt.prependSystemContext, /offline analysis child/);
    for (const event of [search, fetch]) assert.equal((await f.runtime.taskGuard(root, event, f.context)).allow, true);
    for (const toolName of ["browser", "exec", "x_search"])
      assert.equal((await f.runtime.taskGuard(root, { toolName, params: {} }, f.context)).allow, false);

    const child = { ...f.rootGrant, sessionKey: "agent:main:subagent:web-fixture", parentSessionKey: f.rootGrant.sessionKey, sessionId: "web-child-session", runId: "web-child-run" };
    f.runtime.admission.authority.bind(child);
    const childContext = { ...f.context, sessionKey: child.sessionKey, sessionId: child.sessionId, runId: child.runId };
    const childBinding = await f.runtime.getTaskContext(childContext);
    assert.equal((await f.runtime.taskPrompt(childBinding)).toolsAllow.includes(search.toolName), false);
    assert.equal((await f.runtime.taskGuard(childBinding, search, childContext)).allow, false);

    f.sql.prepare("UPDATE devices SET status='revoked' WHERE id='fixture-device'").run();
    await assert.rejects(() => f.runtime.taskGuard(root, search, f.context), /domain_authority_revoked/);
  } finally { await f.close(); }
});

test("public web requires a shared grant in household chats and stays out of diagnosis and brain dumps", async () => {
  for (const source of [{ audience: "household" }, { mode: "diagnostic" }, { mode: "brain_dump" }] as const) {
    const f = await fixture(false, undefined, source);
    try {
      const search = { toolName: "web_search", params: { query: "public source fixture" } };
      f.configuration.profiles.alex.domains.push("web");
      const root = await f.binding();
      assert.equal((await f.runtime.taskPrompt(root)).toolsAllow.includes(search.toolName), false);
      assert.equal((await f.runtime.taskGuard(root, search, f.context)).allow, false);

      if ("audience" in source) {
        f.configuration.profiles.alex.sharedDomains.push("web");
        assert.equal((await f.runtime.taskPrompt(root)).toolsAllow.includes(search.toolName), true);
        assert.equal((await f.runtime.taskGuard(root, search, f.context)).allow, true);
      }
    } finally { await f.close(); }
  }
});

test("trusted native analysis hook admits only the exact current confined child without a factory sandbox flag",async()=>{
  const checked:Array<[string,string]>=[];
  const f=await fixture(false,async(key,agent)=>{checked.push([key,agent]);});
  try{
    const agentId="household-analysis",sessionKey="agent:household-analysis:subagent:analysis-test",sessionId="analysis-sid",runId="analysis-run";
    const child={...f.rootGrant,agentId,sessionKey,sessionId:null,runId,parentSessionKey:f.rootGrant.sessionKey};
    f.runtime.admission.authority.bind(child);
    const hook={agentId,sessionKey,sessionId,runId,assertInvocationCurrent(){}};
    const binding=await f.runtime.getTaskContext(hook);
    assert.equal(binding.execution.sandboxed,false);
    assert.equal(binding.execution.workspaceDir,undefined);
    const native={agents:{defaults:{model:"ollama/fixture"},entries:buildNativeExecutionProfiles({analysisWorkspace:f.workspace,
      diagnosticWorkspace:f.workspace,image:f.configuration.execution.sandboxImage,sandboxUser:"1000:1000"})}};
    await writeFile(f.configuration.execution.nativeConfigPath,JSON.stringify(native));
    const guard=(toolName:string,params:Record<string,unknown>={},current=binding)=>f.runtime.taskGuard(current,{toolName,params},hook);
    assert.equal((await guard("read",{path:"input.csv"})).allow,false,"No trusted live native profile");
    const unsafe=structuredClone(native);
    unsafe.agents.entries[agentId].sandbox.docker.network="bridge";
    f.runtime.configureNativePolicyReader(()=>unsafe);
    assert.equal((await guard("read",{path:"input.csv"})).allow,false,"Current runtime must also match the confinement policy");
    f.runtime.configureNativePolicyReader(()=>native);
    for(const params of [{host:"gateway"},{host:"node"},{host:"auto"},{elevated:true},{security:"full"},{ask:"off"}])
      assert.equal((await guard("exec",{command:"python3 analysis.py",...params})).allow,false);
    assert.equal((await guard("sessions_spawn",{task:"outside work"})).allow,false);
    assert.equal(checked.length,0);
    assert.equal((await guard("read",{path:"input.csv"})).allow,true);
    assert.equal(f.runtime.admission.authority.get(sessionKey)?.sessionId,sessionId,"Pin the first trusted SDK session generation");
    assert.deepEqual(await guard("exec",{command:"python3 analysis.py"}),{allow:true,params:{command:"python3 analysis.py",host:"sandbox"}});
    const publish={toolName:"household_analysis_publish_output",toolCallId:"analysis-output-call",
      params:{requestArtifactId:"artifact-"+"a".repeat(64),relativePath:"outputs/chart.png"}};
    assert.equal((await guard(publish.toolName,publish.params)).allow,true,"The V2 invocation can bind from the trusted hook");
    await f.runtime.bindNativeInvocation(binding,publish,hook);
    await assert.rejects(()=>f.runtime.executeNativeInvocation(publish.toolName,publish.params,{...hook,toolCallId:publish.toolCallId}),
      /analysis_sandbox_child_required/,"An actual publisher still needs V2 sandbox evidence");
    assert.equal(binding.execution.sandboxed,false,"The hook proof never impersonates a V2 sandbox context");
    assert.equal((await guard("read",{},await f.runtime.getTaskContext({...hook,sessionId:"another-sid"}))).allow,false);
    assert.equal((await guard("read",{},await f.runtime.getTaskContext({...hook,runId:"another-run"}))).allow,false);
    assert.equal((await guard("exec",{command:"python3 analysis.py"},await f.binding())).allow,false);
    assert.deepEqual(checked,Array.from({length:3},()=>[sessionKey,agentId]));
    f.database.submissions.enqueue({submissionId:"other-source",conversationId:f.conversation.id,profileId:"alex",agentId:"main",
      textHash:createHash("sha256").update(sourceText).digest("hex"),requestHash:"other-source-hash",
      payload:{kind:"message",text:sourceText},originDeviceId:"fixture-device"});
    f.runtime.admission.authority.bind({...f.rootGrant,sourceId:"other-source"});
    assert.equal((await guard("read",{path:"input.csv"})).allow,false,"A previous child cannot inherit a successor's source");
  }finally{await f.close();}
});

for(const sourceTool of ["subagent_settle","subagent_announce"]){
test("only the exact native analysis "+sourceTool+" adopts a running signed goal-free source",async()=>{
  const f=await fixture();try{
    const original=await f.binding(),parentKey="agent:main:"+f.conversation.sessionKey;
    const child={...f.rootGrant,agentId:"household-analysis",sessionKey:"agent:household-analysis:subagent:wake-child",
      sessionId:"analysis-child-session",runId:"analysis-wake-child-run",parentSessionKey:f.rootGrant.sessionKey};
    f.runtime.admission.authority.bind(child);
    const runId=sourceTool==="subagent_settle"?`announce:requester-settle:main:${parentKey}:${child.runId}:yield-1`:`announce:v1:${child.sessionKey}:${child.runId}`;
    const wake={...f.context,sessionKey:parentKey,runId,inputProvenance:{kind:"inter_session",sourceTool,sourceSessionKey:child.sessionKey}};
    const admit=(observation:typeof wake)=>f.runtime.admitNativeTurn({},observation,observation);
    const receipt=()=>f.database.submissions.get("fixture-source")!.receipt;
    await assert.rejects(()=>admit({...wake,inputProvenance:{...wake.inputProvenance,sourceTool:"sessions_send"}}),/native_analysis_wake_not_authorized/);
    await assert.rejects(()=>admit({...wake,runId:runId.replace(child.runId,"unowned-run")}),/native_analysis_wake_not_authorized/);
    await assert.rejects(()=>admit({...wake,inputProvenance:{...wake.inputProvenance,sourceSessionKey:"agent:household-analysis:subagent:unowned"}}),/native_analysis_wake_not_authorized/);
    assert.equal(f.analysisChildReads(),0);
    f.setAnalysisChildState("running");
    await assert.rejects(()=>admit(wake),/native_analysis_wake_not_authorized/);
    assert.equal(receipt().runId,f.rootGrant.runId);
    assert.deepEqual(f.runtime.admission.authority.get(f.rootGrant.sessionKey),f.rootGrant);
    f.setAnalysisChildState("complete");
    f.setNativeRunId(null); // The trusted native prompt precedes public active-run projection.
    await admit(wake);
    assert.equal(receipt().runId,runId);
    assert.equal(receipt().submissionId,f.rootGrant.sourceId);
    assert.equal(receipt().goalId,null);
    assert.equal(f.runtime.admission.authority.get(f.rootGrant.sessionKey)?.runId,runId);
    const bound=await f.runtime.getTaskContext(wake);
    assert.equal(bound.task.source.id,"user:"+f.rootGrant.sourceId);
    assert.equal(bound.task.native.goalId,null);
    assert.throws(()=>original.task.assertCurrent(),/native_run_authority_changed/);
    await admit(wake);
    assert.equal(f.analysisChildReads(),2,"Repeated prompt admission reuses the exact current run");
  }finally{await f.close();}
});
}

test("no-goal automatic memory loads its skill without creating task state and saves a grounded source", async () => {
  const f = await fixture(); try {
    await assert.rejects(() => f.runtime.execute("household_memory_status", { scope: "personal" }, f.context), /loaded_contract_required/);
    const first=await f.guard();assert.equal(first.allow,false);assert.match(first.reason??"",/loaded automatically/);assert.match(first.reason??"",/MEMORY-CONTRACT-V1/);
    assert.equal(f.reads(), 0,"Instructions precede the first business call");
    assert.equal(f.revision(), 0);
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM conversation_checkpoints").get()!.n, 0);
    assert.equal((await f.guard()).allow, true);
    await f.runtime.execute("household_memory_status", { scope: "personal" }, f.context);
    assert.equal(f.reads(), 1);
    const saved = await f.runtime.execute("household_memory_source_save", { operationId: "remember-fact-1", scope: "personal", title: "Fred preference", text: sourceText,
      sourceIds: ["user:fixture-source"], certainty: "fact" }, f.context) as { result: { source: { certainty: string } } };
    assert.equal(saved.result.source.certainty, "confirmed");
    assert.equal(f.revision(), 0, "Automatic curation must not manufacture a goal/checkpoint");
  } finally { await f.close(); }
});

test("active root and native child/successor restore only actually injected contract metadata", async () => {
  const f = await fixture(true); try {
    await f.select(); assert.ok(f.revision() > 0);
    const childGrant = { ...f.rootGrant, sessionKey: "agent:main:subagent:contract-child", parentSessionKey: f.rootGrant.sessionKey, sessionId: "child-session", runId: "child-run" };
    f.runtime.admission.authority.bind(childGrant);
    const childContext = { ...f.context, sessionKey: childGrant.sessionKey, sessionId: childGrant.sessionId, runId: childGrant.runId };
    const child = await f.runtime.getTaskContext(childContext);
    const prompt = await f.runtime.taskPrompt(child);
    assert.equal("loadedContracts" in prompt, false, "Internal marker is not model context");
    assert.match(prompt.prependSystemContext, /MEMORY-CONTRACT-V1/);
    assert.equal((await f.runtime.taskGuard(child, { toolName: "household_memory_status", params: { scope: "personal" } }, childContext)).allow, true);
    assert.equal(f.runtime.admission.authority.contracts.list(childGrant, child.task.assertCurrent).length, 1);
    const successor = { ...f.rootGrant, runId: "root-successor" };
    f.runtime.admission.authority.bind(successor);
    assert.equal(f.runtime.admission.authority.contracts.list(successor, () => {}).length, 0);
    const next = await f.runtime.getTaskContext({ ...f.context, runId: successor.runId });
    await f.runtime.taskPrompt(next);
    assert.equal(f.runtime.admission.authority.contracts.list(successor, next.task.assertCurrent).length, 1);
  } finally { await f.close(); }
});

test("contract changes or revoked device prevent both the guard and final pre-effect write", async () => {
  const f = await fixture(); try {
    await f.select(); const retained = await f.binding();
    assert.equal((await f.guard()).allow, true);
    await writeFile(path.join(f.skills, "memory.md"), "MEMORY-CONTRACT-V2: changed policy must be loaded again.");
    await assert.rejects(() => f.runtime.execute("household_memory_source_save", { operationId: "blocked-fact-1", scope: "personal", title: "Fred", text: sourceText,
      sourceIds: ["user:fixture-source"], certainty: "fact" }, f.context), /loaded_contract_required/);
    const changed=await f.guard();assert.equal(changed.allow,false);assert.match(changed.reason??"",/MEMORY-CONTRACT-V2/);
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM domain_effects").get()!.n, 0, "Automatic loading itself performs no business effects");
    assert.equal((await f.guard()).allow, true);
    f.sql.prepare("UPDATE devices SET status='revoked' WHERE id='fixture-device'").run();
    await assert.rejects(() => f.runtime.taskGuard(retained, { toolName: "household_memory_status", params: { scope: "personal" } }, f.context), /domain_authority_revoked/);
    await assert.rejects(() => f.runtime.execute("household_memory_status", { scope: "personal" }, f.context), /domain_authority_revoked/);
  } finally { await f.close(); }
});

test("trusted first child SID rehydrates only its exact current loaded contracts before V2 execution", async () => {
  const f = await fixture(true); try {
    await f.select();
    const childGrant = { ...f.rootGrant, sessionKey: "agent:main:subagent:first-sid", parentSessionKey: f.rootGrant.sessionKey, sessionId: null, runId: "first-child-run" };
    f.runtime.admission.authority.bind(childGrant);
    const childContext = { ...f.context, sessionKey: childGrant.sessionKey, sessionId: "first-child-generation", runId: childGrant.runId, toolCallId: "tool_call:first:household_memory_status:1" };
    const child = await f.runtime.getTaskContext(childContext);await f.runtime.taskPrompt(child);
    assert.equal(f.runtime.admission.authority.contracts.list(childGrant, child.task.assertCurrent).length, 1);
    const event = { toolName: "household_memory_status", toolCallId: childContext.toolCallId, runId: childContext.runId, params: { scope: "personal" } };
    assert.equal((await f.runtime.taskGuard(child, event, childContext)).allow, true);
    await f.runtime.bindNativeInvocation(child, event, childContext);
    const bound = f.runtime.admission.authority.get(childGrant.sessionKey)!;
    assert.equal(bound.sessionId, childContext.sessionId);
    assert.equal(f.runtime.admission.authority.contracts.list(bound, child.task.assertCurrent).length, 1);
    await f.runtime.executeNativeInvocation(event.toolName, event.params, childContext);
    assert.equal(f.reads(), 1, "Actual typed V2 execution still has its loaded contract after SID binding");
    await assert.rejects(() => f.runtime.bindNativeInvocation(child, { ...event, toolCallId: "wrong-generation-call" }, { ...childContext, sessionId: "unrelated-child-generation", toolCallId: "wrong-generation-call" }), /trusted_native_invocation_required/);
  } finally { await f.close(); }
});

test("an oversized selected contract is not marked loaded by bounded prompt restoration", async () => {
  const f = await fixture(true); try {
    await writeFile(path.join(f.skills, "memory.md"), "OVERSIZED-CONTRACT " + "x".repeat(25000));
    await f.select();
    const successor = { ...f.rootGrant, runId: "root-large-successor" }; f.runtime.admission.authority.bind(successor);
    const next = await f.runtime.getTaskContext({ ...f.context, runId: successor.runId });
    const prompt = await f.runtime.taskPrompt(next);
    assert.match(prompt.prependSystemContext, /load its complete instructions/);
    assert.equal(f.runtime.admission.authority.contracts.list(successor, next.task.assertCurrent).length, 0);
    assert.equal((await f.runtime.taskGuard(next, { toolName: "household_memory_status", params: { scope: "personal" } }, {})).allow, false);
  } finally { await f.close(); }
});

test("deduplicated shared instruction text restores both exact authorized domain markers", async () => {
  const f = await fixture(true); try {
    const shared = "SHARED-CONTRACT: one full contract covers document extraction and contact capture.";
    await writeFile(path.join(f.skills, "memory.md"), shared); await writeFile(path.join(f.skills, "documents.md"), shared);
    await f.select(["memory", "documents"]);
    const successor = { ...f.rootGrant, runId: "root-dedup-successor" }; f.runtime.admission.authority.bind(successor);
    const next = await f.runtime.getTaskContext({ ...f.context, runId: successor.runId }); const prompt = await f.runtime.taskPrompt(next);
    assert.equal(prompt.prependSystemContext.split(shared).length - 1, 1);
    assert.deepEqual(f.runtime.admission.authority.contracts.list(successor, next.task.assertCurrent).map(x => x.domainId).sort(), ["documents", "memory"]);
  } finally { await f.close(); }
});

test("discovery, owning effect recovery and task metadata remain available before selection", async () => {
  const f = await fixture(); try {
    for (const [toolName, params] of [["tool_search", {}], ["household_effects_inspect", { operationId: "unknown-operation" }], ["household_task_context", {}]] as const)
      assert.equal((await f.runtime.taskGuard(await f.binding(), { toolName, params }, {})).allow, true);
    assert.equal(f.runtime.admission.authority.contracts.list(f.rootGrant, () => {}).length, 0);
  } finally { await f.close(); }
});

test("active-goal business effects ignore cosmetic progress while native continuation uses generated evidence state", async () => {
  const f = await fixture(true); try {
    await f.select();
    const write = { toolName: "household_memory_source_save", params: { scope: "personal", title: "Fred", text: sourceText, certainty: "fact" } };
    assert.equal((await f.runtime.taskGuard(await f.binding(), write, {})).allow, true);
    await f.runtime.execute("household_task_checkpoint", { expectedRevision: f.revision(), phase: "working", summary: "Save one fact", nextAction: "Persist exact quote", outcomes: [
      { id: "fact", description: "Private Fred preference source is saved", evidenceKind: "operation", requiredEffect: { toolName: "household_memory_source_save", state: "committed" } },
    ] }, f.context);
    f.setProgress({ sessionKey: f.conversation.sessionKey, revision: 1, updatedAt: 0, steps: [{ step: "Old unrelated presentation", status: "completed" }] });
    const binding = await f.binding();
    assert.equal((await f.runtime.taskGuard(binding, write, {})).allow, true);
    assert.equal(f.progressReads(), 0, "Presentation availability cannot block authorized work");
    const continuation = await f.runtime.taskGuard(binding, { toolName: "progress_card", params: { plan: [{ step: "Invented completed outcome", status: "completed" }], sessionKey: "another-task" } }, {});
    assert.equal(continuation.allow, true);
    const handoff = (await f.runtime.tasks.snapshot(binding)).handoff!;
    assert.deepEqual((continuation as any).params, { plan: projectNativeProgressPlan(handoff) });
    assert.ok((continuation as any).params.plan.some((step: { status: string }) => step.status !== "completed"));
    const childGrant = { ...f.rootGrant, sessionKey: "agent:main:subagent:phase", parentSessionKey: f.rootGrant.sessionKey, sessionId: "phase-session", runId: "phase-run" };
    f.runtime.admission.authority.bind(childGrant);
    const childContext = { ...f.context, sessionKey: childGrant.sessionKey, sessionId: childGrant.sessionId, runId: childGrant.runId };
    const child = await f.runtime.getTaskContext(childContext); await f.runtime.taskPrompt(child);
    assert.equal((await f.runtime.taskGuard(child, write, {})).allow, true);
    assert.equal((await f.runtime.tasks.guard(child, { toolName: "progress_card", params: {} })).allow, false);
  } finally { await f.close(); }
});

test("ordinary human list writes derive operation identity without a goal, checkpoint or progress card", async () => {
  const f = await fixture(); try {
    await f.select(["lists"]);
    const args = { items: [{ kind: "shopping", scope: "personal", text: "Bookkeeping fixture bread" }] };
    const first = await f.runtime.execute("household_lists_capture", { ...args, outcomeId: "bread" }, f.context) as any;
    assert.match(first.operation.operationId, /^auto:[a-f0-9]{64}$/);
    assert.equal(first.operation.replayed, false); assert.equal(first.result.result.verified, true);
    assert.equal(first.taskEvidence.state, "not_declared");
    const again = await f.runtime.execute("household_lists_capture", args, f.context) as any;
    assert.equal(again.operation.operationId, first.operation.operationId); assert.equal(again.operation.replayed, true);
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM domain_effects").get()!.n, 1);
    assert.equal(f.revision(), 0); assert.equal(f.sql.prepare("SELECT count(*) AS n FROM conversation_checkpoints").get()!.n, 0);
    const current = await f.runtime.execute("household_lists_read", { scope: "personal" }, f.context) as any;
    assert.equal(current.result.lists[0].items.length, 1);
    assert.match(current.result.lists[0].items[0].text, /Bookkeeping fixture bread/);
    assert.equal(f.progressReads(), 0); assert.equal((await f.binding()).task.native.goalId, null);
    f.sql.prepare("UPDATE devices SET status='revoked' WHERE id='fixture-device'").run();
    await assert.rejects(() => f.runtime.execute("household_lists_capture", args, f.context), /domain_authority_revoked/);
  } finally { await f.close(); }
});

test("selected instructions return only their exact scoped schemas with optional mechanical IDs", async () => {
  const f = await fixture(); try {
    const selected = await f.runtime.execute("household_task_select_domains", { domains: ["memory"] }, f.context) as any;
    assert.equal(selected.ephemeral, true); assert.equal(f.revision(), 0);
    assert.ok(selected.tools.length > 0);
    for (const tool of selected.tools) {
      assert.equal(tool.id, "openclaw:hardy-household:" + tool.nativeName); assert.match(tool.nativeName, /^household_memory_/);
      assert.equal(tool.inputSchema.type, "object"); assert.equal(tool.inputSchema.additionalProperties, false);
    }
    const save = selected.tools.find((tool: any) => tool.nativeName === "household_memory_source_save");
    assert.ok(save); assert.ok(!save.inputSchema.required.includes("operationId"));
    assert.ok(save.inputSchema.properties.operationId); assert.ok(save.inputSchema.properties.outcomeId);
    assert.ok(!selected.tools.some((tool: any) => /calendar|contacts|exec/.test(tool.nativeName)));
    await assert.rejects(() => f.runtime.execute("household_task_select_domains", { domains: ["calendar"] }, f.context), /task_domain_not_authorized/);
  } finally { await f.close(); }
});

test("committed owner receipts associate automatically and complete the exact native goal once", async () => {
  const f = await fixture(true); try {
    await f.select();
    await f.runtime.execute("household_task_checkpoint", { expectedRevision: f.revision(), phase: "working", summary: "Remember a fact", nextAction: "Save", outcomes: [
      { id: "fact", description: "Fred preference saved", evidenceKind: "operation", requiredEffect: { toolName: "household_memory_source_save", state: "committed" } },
    ] }, f.context);
    const saved = await f.runtime.execute("household_memory_source_save", { scope: "personal", title: "Fred", text: sourceText, certainty: "fact" }, f.context) as any;
    assert.equal(saved.taskEvidence.state, "associated"); assert.deepEqual(saved.taskEvidence.outcomeIds, ["fact"]);
    const complete = await f.runtime.execute("household_task_complete", { summary: "Saved Fred's preference" }, f.context) as any;
    assert.equal(complete.state, "complete"); assert.equal(complete.nativeGoal.goalId, "original-goal"); assert.equal(complete.nativeGoal.status, "complete");
    assert.equal(f.nativeMutations.length, 1); assert.equal(f.nativeMutations[0].operation.goalId, "original-goal");
    assert.equal(f.nativeMutations[0].expectedSessionId, "root-session"); assert.equal(f.nativeMutations[0].operation.action, "complete");
    assert.ok(f.publishedPlans.length > 0);
    const finalizeBinding = await f.runtime.getTaskContext({ ...f.context, completionRecovery: true });
    assert.equal((await f.runtime.taskFinalize(finalizeBinding)).action, "finalize");
    await assert.rejects(() => f.runtime.execute("household_memory_source_save", { scope: "personal", title: "No extra work", text: sourceText, certainty: "fact" }, f.context), /source_goal_not_active/);
  } finally { await f.close(); }
});

test("native completion response loss recovers the exact prepared owner operation without repeating mutation", async () => {
  const f = await fixture(true); try {
    await f.select();
    await f.runtime.execute("household_task_checkpoint", { expectedRevision: f.revision(), phase: "working", summary: "Remember a fact", nextAction: "Save", outcomes: [
      { id: "fact", description: "Fred preference saved", evidenceKind: "operation", requiredEffect: { toolName: "household_memory_source_save", state: "committed" } },
    ] }, f.context);
    await f.runtime.execute("household_memory_source_save", { scope: "personal", title: "Fred", text: sourceText, certainty: "fact" }, f.context);
    f.failCompletionResponseOnce();
    await assert.rejects(() => f.runtime.execute("household_task_complete", { summary: "Saved preference" }, f.context), /Native completion reply was lost/);
    assert.equal(f.nativeMutations.length, 1);
    const recovered = await f.runtime.execute("household_task_complete", { summary: "Saved preference" }, f.context) as any;
    assert.equal(recovered.state, "complete"); assert.equal(recovered.nativeGoal.goalId, "original-goal");
    assert.equal(f.nativeMutations.length, 1, "Recovery reads exact owner control and native state instead of replaying completion");
  } finally { await f.close(); }
});

test("completion response loss recovers after source completion and native active-run retirement", async () => {
  const f = await fixture(true); try {
    await f.select();
    await f.runtime.execute("household_task_checkpoint", { expectedRevision: f.revision(), phase: "working", summary: "Remember a fact", nextAction: "Save", outcomes: [
      { id: "fact", description: "Fred preference saved", evidenceKind: "operation", requiredEffect: { toolName: "household_memory_source_save", state: "committed" } },
    ] }, f.context);
    await f.runtime.execute("household_memory_source_save", { scope: "personal", title: "Fred", text: sourceText, certainty: "fact" }, f.context);
    f.failCompletionResponseOnce();
    await assert.rejects(() => f.runtime.execute("household_task_complete", { summary: "Saved preference" }, f.context), /Native completion reply was lost/);
    f.sql.prepare("UPDATE submissions SET status='complete' WHERE id='fixture-source'").run();
    f.setNativeRunId(null);
    const effectsBefore = f.sql.prepare("SELECT count(*) AS n FROM domain_effects").get()!.n;
    const recovered = await f.runtime.execute("household_task_complete", { summary: "Saved preference" }, f.context) as any;
    assert.equal(recovered.state, "complete"); assert.equal(recovered.nativeGoal.goalId, "original-goal");
    assert.equal(f.nativeMutations.length, 1, "Already completed native mutation must not repeat");
    assert.equal(f.database.submissions.get("fixture-source")?.receipt.status, "complete", "Coordination cannot reopen a settled source");
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM domain_effects").get()!.n, effectsBefore, "Recovery cannot add business effects");
    await assert.rejects(() => f.runtime.execute("household_memory_source_save", { scope: "personal", title: "No extra work", text: sourceText, certainty: "fact" }, f.context), /admitted_household_request_required/);
  } finally { await f.close(); }
});

test("a completed native goal without this source's prepared completion cannot be adopted", async () => {
  const f = await fixture(true); try {
    await f.select();
    await f.runtime.execute("household_task_checkpoint", { expectedRevision: f.revision(), phase: "working", summary: "Remember a fact", nextAction: "Save", outcomes: [
      { id: "fact", description: "Fred preference saved", evidenceKind: "operation", requiredEffect: { toolName: "household_memory_source_save", state: "committed" } },
    ] }, f.context);
    await f.runtime.execute("household_memory_source_save", { scope: "personal", title: "Fred", text: sourceText, certainty: "fact" }, f.context);
    f.setNativeGoalStatus("complete");
    await assert.rejects(() => f.runtime.execute("household_task_complete", { summary: "Adopt completed history" }, f.context), /source_goal_not_active/);
    assert.equal(f.nativeMutations.length, 0);
  } finally { await f.close(); }
});


test("an unplanned native progress request stays unfinished without becoming completion authority", async () => {
  const f = await fixture(true); try {
    const binding = await f.binding();
    const empty = await f.runtime.taskGuard(binding, { toolName: "progress_card", params: {} }, {});
    assert.equal(empty.allow, true); assert.ok((empty as any).params.plan.length > 0);
    assert.ok((empty as any).params.plan.some((step: any) => step.status === "in_progress"));
    assert.ok((empty as any).params.plan.every((step: any) => step.status !== "completed"));
    const proposed = await f.runtime.taskGuard(binding, { toolName: "progress_card", params: { plan: [{ step: "Claimed finished work", status: "completed" }] } }, {});
    assert.equal(proposed.allow, true); assert.ok((proposed as any).params.plan.every((step: any) => step.status !== "completed"));
    assert.equal(await f.runtime.tasks.flow.canComplete(binding.task), false); assert.equal(f.revision(), 0);
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM conversation_checkpoints").get()!.n, 0);
  } finally { await f.close(); }
});

test("task context restores current-goal owner facts without declaring outcomes or changing checkpoints", async () => {
  const f = await fixture(true); try {
    await f.select();
    const saved = await f.runtime.execute("household_memory_source_save", { scope: "personal", title: "Fred", text: sourceText, certainty: "fact" }, f.context) as any;
    const revision = f.revision();
    const restored = await f.runtime.execute("household_task_context", {}, f.context) as any;
    assert.ok(restored.evidenceCandidates.some((fact: any) => fact.kind === "operation" && fact.id === saved.operation.operationId));
    assert.ok(restored.evidenceCandidates.every((fact: any) => !('digest' in fact) && !('provenance' in fact)));
    assert.equal(f.revision(), revision); assert.deepEqual(restored.handoff.outcomes, []);
    assert.equal(await f.runtime.tasks.flow.canComplete((await f.binding()).task), false);
  } finally { await f.close(); }
});

test("real scoped catalog rejects read-operation proof and returns actual committed owner candidates", async () => {
  const f = await fixture(true); try {
    await f.select();
    const saved = await f.runtime.execute("household_memory_source_save", { scope: "personal", title: "Fred", text: sourceText, certainty: "fact" }, f.context) as any;
    const revision = f.revision();
    const read = await f.runtime.execute("household_task_complete", { summary: "Read checked", outcomes: [{ id: "read", description: "List checked",
      evidenceKind: "operation", requiredEffect: { toolName: "household_lists_read", state: "committed" } }] }, f.context) as any;
    assert.equal(read.state, "evidence_required"); assert.equal(read.outcomeIssues[0].code, "task_operation_tool_not_receipted");
    assert.ok(read.evidenceCandidates.some((value: any) => value.id === saved.operation.operationId));
    assert.equal(f.revision(), revision); assert.equal(f.nativeMutations.length, 0);
    const missing = await f.runtime.execute("household_task_complete", { summary: "Fact saved", outcomes: [{ description: "Fred preference is saved",
      evidenceKind: "operation", requiredEffect: { toolName: "household_memory_source_save", state: "committed" },
      references: [{ kind: "operation", id: "fabricated-read-operation" }] }] }, f.context) as any;
    assert.equal(missing.state, "evidence_required"); assert.equal(missing.rejectedEvidence[0].code, "task_evidence_unverified");
    assert.ok(missing.evidenceCandidates.some((value: any) => value.id === saved.operation.operationId));
    assert.equal(f.revision(), revision); assert.equal(f.nativeMutations.length, 0);
  } finally { await f.close(); }
});

for (const history of [{ source: "different-goal-source", operation: "different-goal-operation", goal: "previous-goal", status: "complete", allowed: false },
  { source: "cancelled-same-goal-source", operation: "cancelled-same-goal-operation", goal: "original-goal", status: "cancelled", allowed: true }]) {
  test("completion owner proof " + (history.allowed ? "retains committed effects from a cancelled source in the same goal" : "rejects prior-goal effects in the same conversation"), async () => {
    const f = await fixture(true); try {
      await f.select();
      const saved = await f.runtime.execute("household_memory_source_save", { scope: "personal", title: "Fred", text: sourceText, certainty: "fact" }, f.context) as any;
      const current = f.sql.prepare("SELECT result_json,request_hash FROM domain_effects WHERE operation_id=?").get(saved.operation.operationId)!;
      const at = new Date(Date.now() - 60_000).toISOString();
      f.sql.prepare("INSERT INTO submissions(id,conversation_id,profile_id,agent_id,text_hash,status,goal_id,run_id,created_at,updated_at) VALUES(?,?,'alex','main',?,?,?,?,?,?)")
        .run(history.source, f.conversation.id, createHash("sha256").update(sourceText).digest("hex"), history.status, history.goal, "historical-run", at, at);
      f.sql.prepare("INSERT INTO domain_effects(id,operation_id,profile_id,conversation_id,source_prompt_id,tool_name,request_hash,state,result_json,created_at,updated_at) VALUES(?,?,'alex',?,?,'household_memory_source_save',?,'committed',?,?,?)")
        .run("effect-" + history.source, history.operation, f.conversation.id, history.source, current.request_hash, current.result_json, at, at);
      const request = { summary: "Saved requested fact", outcomes: [{ description: "Fred preference source is saved", evidenceKind: "operation", requiredEffect: { toolName: "household_memory_source_save", state: "committed" }, references: [{ kind: "operation", id: history.operation }] }] };
      if (history.allowed) {
        const result = await f.runtime.execute("household_task_complete", request, f.context) as any;
        assert.equal(result.state, "complete"); assert.equal(f.nativeMutations.length, 1);
      } else {
        const pending=await f.runtime.execute("household_task_complete", request, f.context) as any;
        assert.equal(pending.state,"evidence_required");assert.equal(pending.rejectedEvidence[0].code,"task_evidence_source_mismatch");
        assert.equal(f.nativeMutations.length, 0); assert.equal((await f.runtime.tasks.snapshot(await f.binding())).handoff!.terminal, null);
      }
    } finally { await f.close(); }
  });
}

test("independent-topic effects cannot become original-goal proof after the source history changes",async()=>{
  const f=await fixture(true);try{
    await f.select(["lists"]);
    f.sql.prepare("UPDATE submissions SET task_context_json=json_set(COALESCE(task_context_json,'{}'),'$.independentTopicOf','original-goal','$.independentSourcePromptId','fixture-source') WHERE id='fixture-source'").run();
    const side=await f.runtime.execute("household_lists_capture",{items:[{kind:"shopping",scope:"household",text:"SIDE-TOPIC-ONLY"}]},f.context) as any;
    assert.ok(side.operation.resultRecorded);
    f.database.submissions.reconcile("fixture-source","complete","root-run");
    const packet={mode:"task" as const,artifactIds:[],expectedGoalId:"original-goal",expectedSessionId:"root-session"};
    f.database.submissions.enqueue({submissionId:"original-answer",conversationId:f.conversation.id,profileId:"alex",agentId:"main",textHash:createHash("sha256").update(sourceText).digest("hex"),requestHash:"original-answer-hash",payload:{kind:"message",text:sourceText,taskContext:packet},taskContext:packet,originDeviceId:"fixture-device"});
    const claimed=f.database.submissions.claimNext(2,120000)!;f.database.submissions.accepted(claimed.receipt.submissionId,claimed.leaseToken!,{...claimed.receipt,status:"running",runId:"root-run",goalId:"original-goal"});
    f.runtime.admission.authority.bind({...f.rootGrant,sourceId:"original-answer"});
    const binding=await f.binding(),context=await f.runtime.execute("household_task_context",{},f.context) as any;
    assert.ok(!(context.evidenceCandidates??[]).some((ref:any)=>ref.id===side.operation.operationId));
    await assert.rejects(()=>(f.runtime as any).effectEvidence(binding.task,[{kind:"operation",id:side.operation.operationId}]),/task_evidence_/);
    await f.select(["lists"]);
    const original=await f.runtime.execute("household_lists_capture",{items:[{kind:"shopping",scope:"household",text:"ORIGINAL-REQUESTED-ITEM"}]},f.context) as any;
    const before=f.revision(),pending=await f.runtime.execute("household_task_complete",{summary:"Both requests done",outcomes:[{description:"Side request item saved",evidenceKind:"operation",references:[{kind:"operation",id:side.operation.operationId}]}]},f.context) as any;
    assert.equal(pending.state,"evidence_required");assert.equal(pending.rejectedEvidence[0].code,"task_evidence_source_mismatch");assert.equal(f.revision(),before);assert.equal(f.nativeMutations.length,0);
    assert.ok(pending.evidenceCandidates.some((ref:any)=>ref.id===original.operation.operationId));assert.ok(!pending.evidenceCandidates.some((ref:any)=>ref.id===side.operation.operationId));
    const completed=await f.runtime.execute("household_task_complete",{summary:"Original requested item saved",outcomes:[{description:"Original requested item saved",evidenceKind:"operation",references:[{kind:"operation",id:original.operation.operationId}]}]},f.context) as any;
    assert.equal(completed.state,"complete");assert.equal(f.nativeMutations.length,1);

  }finally{await f.close();}
});

test("a goal-free independent action keeps the original conversation question scope",async()=>{
  const f=await fixture();try{
    await f.runtime.execute("household_task_ask_question",{question:"Which pickup day?",reason:"The date is missing"},f.context);
    const question=f.database.getCheckpoint(f.conversation.id,"root-session",null)!.questionArtifactId!;
    f.database.submissions.waiting("fixture-source","root-run");
    const packet={mode:"conversation" as const,artifactIds:[],replyToQuestionId:question,expectedSessionId:"root-session",expectedGoalId:null};
    f.database.submissions.enqueue({submissionId:"side-ordinary-source",conversationId:f.conversation.id,profileId:"alex",agentId:"main",textHash:createHash("sha256").update(sourceText).digest("hex"),requestHash:"side-ordinary-hash",payload:{kind:"message",text:sourceText,taskContext:packet},originDeviceId:"fixture-device"});
    const claim=f.database.submissions.claimNext(2,120000)!;f.database.submissions.accepted(claim.receipt.submissionId,claim.leaseToken!,{...claim.receipt,status:"running",runId:"root-run"});
    f.runtime.admission.authority.bind({...f.rootGrant,sourceId:"side-ordinary-source"});
    await f.runtime.execute("household_task_bind_reply",{relation:"new_topic"},f.context);
    const binding=await f.binding();assert.equal(binding.task.scope.taskId,"conversation:"+f.conversation.id);assert.equal(binding.task.independentSource.id,"user:side-ordinary-source");
    assert.equal((await f.runtime.tasks.snapshot(binding)).checkpoint.questionArtifactId,question);
    await f.runtime.execute("household_task_select_domains",{domains:["lists"]},f.context);
    const action=await f.runtime.execute("household_lists_capture",{items:[{kind:"shopping",scope:"household",text:"ordinary side dish soap"}]},f.context) as any;
    const receipt=f.sql.prepare("SELECT source_prompt_id FROM domain_effects WHERE operation_id=?").get(action.operation.operationId)!;
    assert.match((await (f.runtime as any).scope(f.context)).principal.taskId,/^topic:/);assert.equal(receipt.source_prompt_id,"side-ordinary-source");
    assert.equal((await f.runtime.tasks.snapshot(await f.binding())).checkpoint.questionArtifactId,question);
  }finally{await f.close();}
});


test("independent clarification restores only its own inputs and original resumption omits side inputs",async()=>{
  const f=await fixture(true);try{
    const scope={ownerProfileId:"alex",conversationId:f.conversation.id,taskId:"original-goal",audience:"private" as const},principal={profileId:"alex",canReadHousehold:true};
    const put=(name:string)=>f.artifacts.put(scope,principal,{bytes:Buffer.from(name),filename:name+".txt",mimeType:"text/plain",kind:"input"});
    const original=await put("original-A"),side=await put("independent-B"),answer=await put("answer-C");
    f.sql.prepare("UPDATE submissions SET task_context_json=json_set(COALESCE(task_context_json,'{}'),'$.artifactIds',json(?)) WHERE id='fixture-source'").run(JSON.stringify([original.id]));
    await f.binding();f.database.submissions.waiting("fixture-source","root-run");
    const admit=(id:string,artifactIds:string[],independent:boolean)=>{
      const packet={mode:"task" as const,artifactIds,expectedSessionId:"root-session",expectedGoalId:"original-goal",...(independent?{independentTopicOf:"original-goal",independentSourcePromptId:"side-input-source"}:{})};
      f.database.submissions.enqueue({submissionId:id,conversationId:f.conversation.id,profileId:"alex",agentId:"main",textHash:createHash("sha256").update(sourceText).digest("hex"),requestHash:id+"-hash",payload:{kind:"message",text:sourceText,taskContext:packet},originDeviceId:"fixture-device"});
      const claimed=f.database.submissions.claimNext(2,120000)!;assert.equal(claimed.receipt.submissionId,id);
      f.database.submissions.accepted(id,claimed.leaseToken!,{...claimed.receipt,status:"running",runId:"root-run",goalId:"original-goal"});
      f.runtime.admission.authority.bind({...f.rootGrant,sourceId:id});
    };
    admit("side-input-source",[side.id],true);let binding=await f.binding();
    assert.deepEqual(binding.task.artifactIds,[side.id]);f.database.submissions.waiting("side-input-source","root-run");
    admit("side-answer-source",[answer.id],true);binding=await f.binding();
    assert.deepEqual(new Set(binding.task.artifactIds),new Set([side.id,answer.id]));assert.equal(binding.task.independentSource.id,"user:side-input-source");
    f.database.submissions.reconcile("side-answer-source","complete","root-run");
    admit("original-resumption-source",[],false);binding=await f.binding();
    assert.ok(binding.task.artifactIds.includes(original.id));assert.ok(!binding.task.artifactIds.includes(side.id));assert.ok(!binding.task.artifactIds.includes(answer.id));
  }finally{await f.close();}
});


test("authorized ordinary and brain-dump human actions stay goal-free without native creation authority",async()=>{
  for(const mode of ["normal","brain_dump"] as const){
    const f=await fixture();try{
      f.runtime.admission.authority.bind({...f.rootGrant,mode});
      f.sql.prepare("UPDATE submissions SET task_context_json=json_set(COALESCE(task_context_json,'{}'),'$.mode',?) WHERE id='fixture-source'").run(mode==="normal"?"conversation":"brain_dump");
      await f.select(["lists"]);
      const binding=await f.binding(),decision=await f.runtime.taskGuard(binding,{toolName:"create_goal",params:{objective:"current request"}},f.context);
      assert.equal(decision.allow,false);
      const result=await f.runtime.execute("household_lists_capture",{items:[{kind:"shopping",scope:"household",text:mode+" dish soap"}]},f.context) as any;
      assert.equal(result.operation.resultRecorded,true);assert.equal(f.database.submissions.get("fixture-source")!.receipt.goalId,null);assert.equal(f.database.getSubmissionDomainBinding("fixture-source")!.goalBound,false);assert.equal(f.nativeMutations.length,0);
    }finally{await f.close();}
  }
});
