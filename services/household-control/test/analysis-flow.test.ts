import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { AnalysisFlowService, readAnalysisOutput } from "../src/analysis-flow/index.ts";
import type { AnalysisFlowContext, AnalysisFlowPorts, NativeAnalysisRequest } from "../src/analysis-flow/types.ts";
import type { ArtifactMetadata } from "../src/platform/artifacts.ts";
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function fixture() {
  const values = new Map<string, { metadata: ArtifactMetadata; bytes: Buffer }>();
  let spawned: NativeAnalysisRequest | null = null;
  const admissions=new Map<string,{childSessionKey:string;runId:string}>();let generation=0;
  const ctx: AnalysisFlowContext = { principal: { profileId: "alex", canReadHousehold: true },
    scope: { ownerProfileId: "alex", conversationId: "conversation-a", taskId: "goal-a", audience: "private" },
    native: { sessionId: "parent-session", sessionKey: "parent-key", goalId: "goal-a", goalStatus: "active", objective: "Plot data", runId: "parent-run" },
    source: { id: "human-a", text: "Plot data", sha256: sha("Plot data") }, mode: "normal", artifactIds: [], assertCurrent() {},
    execution: { agentId: "main", sessionKey: "parent-key", sessionId: "parent-session", runId: "parent-run", sandboxed: false } };
  const ports: AnalysisFlowPorts = { sandboxRoots: ["/native/sandboxes"], assertAnalysisPolicy: async () => {},
    artifacts: {
      read: async id => { const item = values.get(id); if (!item) throw Error("not_found"); return item; },
      put: async (scope, _principal, input) => { const id = "artifact-" + sha(input.idempotencyKey ?? input.bytes); const metadata: ArtifactMetadata = {
        ...scope, id, schemaVersion: 1, filename: input.filename, mimeType: input.mimeType, kind: input.kind,
        byteLength: input.bytes.length, sha256: sha(input.bytes), createdAt: new Date().toISOString() };
        values.set(id, { metadata, bytes: input.bytes }); return metadata; },
    }, spawn: async (_context, request) => { spawned = request;generation++;const child={childSessionKey:"agent:household-analysis:child-"+generation,runId:"child-run-"+generation};admissions.set(request.requestArtifactId,child);return {state:"accepted",...child}; },
    child: async (context,identity) => ({ childSessionKey:identity.childSessionKey,runId:identity.runId,agentId:"household-analysis",parentSessionKey:identity.parentSessionKey,rootTaskId:context.scope.taskId,sandboxed:true,state:"running" }),
    childRequestMatches:async(_context,id,key,run)=>{const child=admissions.get(id);return child?.childSessionKey===key&&child.runId===run;} };
  return { ctx, ports, values, service: new AnalysisFlowService(ports), spawned: () => spawned };
}
test("analysis uses actual fixed native child request with scoped artifact attachments", async () => {
  const f = fixture();
  const input = await f.ports.artifacts.put(f.ctx.scope, f.ctx.principal, { bytes: Buffer.from("value\n42\n"), mimeType: "text/csv", filename: "data.csv", kind: "input" });
  const started = await f.service.execute("analysis.start", { operationId: "analysis-start-a", instruction: "Plot the values", inputArtifactIds: [input.id] }, f.ctx) as { nextAction: string };
  assert.match(started.nextAction,/visible native sessions_yield function directly with \{\}/);
  assert.match(started.nextAction,/Omit waitFor/);
  const request = f.spawned()!;
  assert.equal(request.agentId, "household-analysis"); assert.equal(request.sandbox, "require");
  assert.equal(request.completionTarget, "parent"); assert.equal(request.context, "isolated");
  assert.equal(request.attachments[0].name, "input-0.csv");
  assert.equal(Buffer.from(request.attachments[0].content, "base64").toString("utf8"), "value\n42\n");
  assert.match(request.task, /outputManifestId/);
  assert.match(request.task,/exact absolute sandbox paths from the native attachment notice/);
});
test("private unrelated inputs and diagnostic Python are denied before spawning", async () => {
  const f = fixture();
  const input = await f.ports.artifacts.put({ ...f.ctx.scope, taskId: "other-goal" }, f.ctx.principal, { bytes: Buffer.from("private"), mimeType: "text/plain", filename: "data.txt", kind: "input" });
  await assert.rejects(() => f.service.execute("analysis.start", { operationId: "analysis-start-a", instruction: "Read input", inputArtifactIds: [input.id] }, f.ctx), /analysis_input_scope_or_type_invalid/);
  await assert.rejects(() => f.service.execute("analysis.start", { operationId: "analysis-start-b", instruction: "Fix deployment", inputArtifactIds: [] }, { ...f.ctx, mode: "diagnostic" }), /diagnostic_python_forbidden/);
  assert.equal(f.spawned(), null);
});
test("pre-goal upload anchor is allowed only for an exact trusted admitted input", async () => {
  const f = fixture();
  const input = await f.ports.artifacts.put({ ...f.ctx.scope, taskId: "conversation:" + f.ctx.scope.conversationId }, f.ctx.principal,
    { bytes: Buffer.from("value\n42\n"), mimeType: "text/csv", filename: "upload.csv", kind: "input" });
  const args = { operationId: "analysis-upload-a", instruction: "Plot this upload", inputArtifactIds: [input.id] };
  await assert.rejects(() => f.service.execute("analysis.start", args, f.ctx), /analysis_input_scope_or_type_invalid/);
  await f.service.execute("analysis.start", args, { ...f.ctx, artifactIds: [input.id] });
  assert.equal(f.spawned()!.attachments.length, 1);
});
test("older output data can be reused only when explicitly admitted for this conversation and audience", async () => {
  const f = fixture();
  const old = await f.ports.artifacts.put({ ...f.ctx.scope, taskId: "previous-goal" }, f.ctx.principal,
    { bytes: Buffer.from('{"values":[3,4]}'), mimeType: "application/json", filename: "prior-result.json", kind: "output" });
  const args = { operationId: "analysis-prior-output-a", instruction: "Compare that prior result", inputArtifactIds: [old.id] };
  await assert.rejects(() => f.service.execute("analysis.start", args, f.ctx), /analysis_input_scope_or_type_invalid/);
  await f.service.execute("analysis.start", args, { ...f.ctx, artifactIds: [old.id] });
  assert.equal(f.spawned()!.attachments[0].name, "input-0.json");
});
test("evidence artifacts never become Python input even when explicitly listed", async () => {
  const f = fixture();
  const evidence = await f.ports.artifacts.put(f.ctx.scope, f.ctx.principal,
    { bytes: Buffer.from('{"kind":"task_handoff"}'), mimeType: "application/json", filename: "task-handoff.json", kind: "evidence" });
  await assert.rejects(() => f.service.execute("analysis.start", { operationId: "analysis-evidence-a", instruction: "Analyze this", inputArtifactIds: [evidence.id] },
    { ...f.ctx, artifactIds: [evidence.id] }), /analysis_input_scope_or_type_invalid/);
  assert.equal(f.spawned(), null);
});
test("diagnosis can publish a plain text report without calling Python or native child", async () => {
  const f = fixture();
  const result = await f.service.execute("analysis.publish_report", { operationId: "diagnostic-report-a", title: "Why the event failed", text: "The receipt records a provider authorization failure; no event delivery is verified." }, { ...f.ctx, mode: "diagnostic" }) as { artifact: ArtifactMetadata; operationalChanges: boolean };
  assert.equal(result.artifact.kind, "output"); assert.equal(result.artifact.mimeType, "text/plain");
  assert.equal(result.operationalChanges, false); assert.equal(f.spawned(), null);
});
test("parent cannot impersonate the sandbox output publisher", async () => {
  const f = fixture();
  await assert.rejects(() => f.service.execute("analysis.publish_output", { operationId: "output-publish-a", requestArtifactId: "artifact-" + "a".repeat(64), relativePath: "outputs/chart.png" }, f.ctx), /analysis_sandbox_child_required/);
});
test("output harvester is confined to real regular files in the native sandbox outputs directory", { skip: process.platform !== "linux" }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "household-analysis-"));
  try {
    const workspace = path.join(root, "native-child"), outputs = path.join(workspace, "outputs");
    await mkdir(outputs, { recursive: true });
    await writeFile(path.join(outputs, "report.json"), '{"value":42}');
    assert.equal((await readAnalysisOutput(workspace, "outputs/report.json", [root])).mimeType, "application/json");
    await assert.rejects(() => readAnalysisOutput(workspace, "outputs/../secrets.txt", [root]), /analysis_output_path_invalid/);
    await symlink(path.join(outputs, "report.json"), path.join(outputs, "linked.json"));
    await assert.rejects(() => readAnalysisOutput(workspace, "outputs/linked.json", [root]));
    await assert.rejects(() => readAnalysisOutput(workspace, "outputs/report.json", [path.join(root, "unrelated")]));
  } finally { await rm(root, { recursive: true, force: true }); }
});


type StartedAnalysis={requestArtifactId:string;admission:{childSessionKey:string;runId:string}};
async function startAnalysis(f:ReturnType<typeof fixture>,ctx:AnalysisFlowContext,operationId:string){return f.service.execute("analysis.start",{operationId,instruction:"Plot the admitted values",inputArtifactIds:[]},ctx) as Promise<StartedAnalysis>;}
function resultArgs(started:StartedAnalysis){return {requestArtifactId:started.requestArtifactId,childSessionKey:started.admission.childSessionKey,childRunId:started.admission.runId,outputManifestIds:[]};}

test("no-goal analysis request cannot be adopted by a different human source in the same conversation",async()=>{
  const f=fixture(),ctx={...f.ctx,scope:{...f.ctx.scope,taskId:"conversation:"+f.ctx.scope.conversationId},native:{...f.ctx.native,goalId:null,goalStatus:null,objective:null}} as AnalysisFlowContext;
  const first=await startAnalysis(f,ctx,"analysis-before-new-human");
  const changed={...ctx,source:{id:"human-b",text:"Another request",sha256:sha("Another request")}};
  await assert.rejects(()=>f.service.execute("analysis.result",resultArgs(first),changed),/analysis_request_binding_invalid/);
  const changedText={...ctx,source:{...ctx.source,text:"Different source body",sha256:sha("Different source body")}};
  await assert.rejects(()=>f.service.execute("analysis.result",resultArgs(first),changedText),/analysis_request_binding_invalid/);
  const pending=await f.service.execute("analysis.result",resultArgs(first),ctx) as {verified:boolean};assert.equal(pending.verified,false);
});

test("two same-source sibling analyses cannot exchange their admitted request identities",async()=>{
  const f=fixture(),first=await startAnalysis(f,f.ctx,"analysis-sibling-first"),second=await startAnalysis(f,f.ctx,"analysis-sibling-second");
  await assert.rejects(()=>f.service.execute("analysis.result",{...resultArgs(first),childSessionKey:second.admission.childSessionKey,childRunId:second.admission.runId},f.ctx),/analysis_child_request_mismatch/);
  const secondChild={...f.ctx,execution:{...f.ctx.execution,agentId:"household-analysis",sessionKey:second.admission.childSessionKey,sessionId:"second-child-session",runId:second.admission.runId,sandboxed:true}};
  await assert.rejects(()=>f.service.execute("analysis.publish_output",{operationId:"wrong-sibling-publish",requestArtifactId:first.requestArtifactId,relativePath:"outputs/report.json"},secondChild),/analysis_child_request_mismatch/);
  await assert.rejects(()=>f.service.execute("analysis.result",{...resultArgs(first),childRunId:"invented-run"},f.ctx),/analysis_child_request_mismatch/);
  const pending=await f.service.execute("analysis.result",resultArgs(second),f.ctx) as {verified:boolean};assert.equal(pending.verified,false);
});

test("publisher observes the recorded parent and exact current child session", { skip: process.platform !== "linux" }, async () => {
  const f = fixture(), root = await mkdtemp(path.join(tmpdir(), "household-analysis-publish-"));
  try {
    const workspace = path.join(root, "child");
    await mkdir(path.join(workspace, "outputs"), { recursive: true });
    await writeFile(path.join(workspace, "outputs", "report.json"), '{"total":42}');
    f.ports.sandboxRoots = [root];
    const started = await startAnalysis(f, f.ctx, "analysis-publish-from-child");
    const { childSessionKey, runId } = started.admission;
    const childContext = { ...f.ctx, execution: {
      agentId: "household-analysis", sessionKey: childSessionKey, sessionId: "actual-child-session",
      runId, sandboxed: true, workspaceDir: workspace,
    } };
    const observe = f.ports.child;
    f.ports.child = async (context, identity) => {
      assert.deepEqual(identity, { childSessionKey, runId, parentSessionKey: "parent-key", parentAgentId: "main", expectedSessionId: "actual-child-session" });
      assert.notEqual(identity.parentSessionKey, context.execution.sessionKey);
      return observe(context, identity);
    };
    const published = await f.service.execute("analysis.publish_output", {
      requestArtifactId: started.requestArtifactId, relativePath: "outputs/report.json", operationId: "auto-publish-report",
    }, childContext) as { outputManifestId: string; artifact: ArtifactMetadata };
    assert.equal(published.artifact.filename, "report.json");
    const manifest = JSON.parse(f.values.get(published.outputManifestId)!.bytes.toString("utf8"));
    assert.equal(manifest.childSessionId, childContext.execution.sessionId);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("goal-free analysis accepts useful raster inputs beyond the old clerical envelope",async()=>{
  const f=fixture();f.ctx.native.goalId=null;f.ctx.native.goalStatus=null;
  const ids:string[]=[];
  for(let index=0;index<9;index++){
    const bytes=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(80*1024,index)]);
    const item=await f.ports.artifacts.put(f.ctx.scope,f.ctx.principal,{bytes,mimeType:"image/png",filename:"scan-"+index+".png",kind:"input"});ids.push(item.id);
  }
  await f.service.execute("analysis.start",{operationId:"analysis-images-0001",instruction:"Compare these image dimensions locally",inputArtifactIds:ids},f.ctx);
  assert.equal(f.spawned()!.attachments.length,9);assert.equal(f.spawned()!.attachments[0].mimeType,"image/png");
  const over=await f.ports.artifacts.put(f.ctx.scope,f.ctx.principal,{bytes:Buffer.alloc(16*1024*1024+1),mimeType:"text/csv",filename:"too-big.csv",kind:"input"});
  await assert.rejects(()=>f.service.execute("analysis.start",{operationId:"analysis-images-0002",instruction:"Read input",inputArtifactIds:[over.id]},f.ctx),/analysis_inputs_too_large/);
});
