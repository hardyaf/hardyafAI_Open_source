import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {execFileSync} from "node:child_process";
import {analysisAttachmentReadiness,normalizeNativeAnalysisAdmission} from "../../../plugins/household-domains/native-analysis.mjs";
import {buildNativeExecutionProfiles,nativeAnalysisAttachmentPolicy,nativeAnalysisToolAllowlist} from "../src/platform/native-execution.ts";

const config=()=>({tools:{sessions_spawn:{attachments:{...nativeAnalysisAttachmentPolicy}}}});
const attachment=(text="label,value\nA,10\n")=>({name:"input-0.csv",content:Buffer.from(text).toString("base64"),encoding:"base64",mimeType:"text/csv"});
test("analysis readiness reads actual bounded native attachment policy without changing it",()=>{
  const cfg=config(),before=JSON.stringify(cfg);
  assert.equal(analysisAttachmentReadiness(cfg,[attachment()]),null);
  assert.equal(JSON.stringify(cfg),before);
  assert.equal(analysisAttachmentReadiness({},[attachment()]),"analysis_attachments_disabled");
  assert.equal(analysisAttachmentReadiness({tools:{sessions_spawn:{attachments:{enabled:false}}}},[attachment()]),"analysis_attachments_disabled");
  assert.equal(analysisAttachmentReadiness({tools:{sessions_spawn:{attachments:{enabled:true}}}},[attachment()]),"analysis_attachment_policy_unavailable");
  assert.equal(analysisAttachmentReadiness({},[]),null,"No file input needs no attachment projection");
  assert.equal(analysisAttachmentReadiness(cfg,Array.from({length:33},()=>attachment())),"analysis_attachment_limit_exceeded");
  const smaller={tools:{sessions_spawn:{attachments:{...nativeAnalysisAttachmentPolicy,maxFiles:1}}}};
  assert.equal(analysisAttachmentReadiness(smaller,[attachment(),attachment()]),"analysis_attachment_limit_exceeded");
});
test("actual launcher refuses disabled runtime attachments despite an enabled factory config clone",{
  skip:!process.env.OPENCLAW_TEST_PACKAGE_ROOT&&"Set OPENCLAW_TEST_PACKAGE_ROOT for installed SDK verification",
},async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),"analysis-native-config-"));
  try{
    const filename=path.join(directory,"openclaw.json"),runtime={agents:{entries:{main:{workspace:directory}}},tools:{sessions_spawn:{attachments:{enabled:false}}}};
    await writeFile(filename,JSON.stringify(runtime),{mode:0o600});
    const launcher=pathToFileURL(path.resolve(import.meta.dirname,"../../../plugins/household-domains/native-analysis.mjs")).href;
    const request={requestArtifactId:"artifact-"+"a".repeat(64),task:"Do not launch: readiness-only probe",taskName:"readiness_probe",label:"Readiness",agentId:"household-analysis",runtime:"subagent",mode:"run",cleanup:"keep",sandbox:"require",context:"isolated",completionTarget:"parent",visible:false,thread:false,expectsCompletionMessage:true,attachments:[attachment()]};
    const code=`import {spawnNativeAnalysis} from ${JSON.stringify(launcher)};let fences=0;const result=await spawnNativeAnalysis({mode:"normal",execution:{agentId:"main"},assertCurrent(){fences++;}},${JSON.stringify(request)},{toolCallId:"readiness-probe",config:${JSON.stringify(config())}});console.log(JSON.stringify({result,fences}));`;
    const output=execFileSync(process.execPath,["--input-type=module","-e",code],{encoding:"utf8",timeout:30000,
      env:{PATH:process.env.PATH??"/usr/bin:/bin",LANG:"C.UTF-8",OPENCLAW_CONFIG_PATH:filename,OPENCLAW_STATE_DIR:directory},stdio:["ignore","pipe","pipe"]});
    const result=JSON.parse(output.trim().split("\n").at(-1)!);
    assert.deepEqual(result.result,{state:"rejected",childSessionKey:null,runId:null,rejectionCode:"analysis_attachments_disabled"});
    assert.equal(result.fences,2,"Readiness returns before tool construction or native execution");
  }finally{await rm(directory,{recursive:true,force:true});}
});
test("analysis admission recognizes only complete success or explicit refusal and never exposes native errors",()=>{
  const childSessionKey="agent:household-analysis:subagent:fixture-child",runId="fixture-child-run";
  assert.deepEqual(normalizeNativeAnalysisAdmission({details:{status:"accepted",childSessionKey,runId}}),{state:"accepted",childSessionKey,runId});
  assert.deepEqual(normalizeNativeAnalysisAdmission({details:{status:"forbidden",error:"attachments are disabled for sessions_spawn (enable tools.sessions_spawn.attachments.enabled)"}}),
    {state:"rejected",childSessionKey:null,runId:null,rejectionCode:"analysis_attachments_disabled"});
  const forbidden=normalizeNativeAnalysisAdmission({details:{status:"forbidden",error:"PRIVATE_ERROR_TOKEN fixture-secret"}});
  assert.equal(forbidden.state,"rejected");assert.equal(forbidden.rejectionCode,"analysis_native_forbidden");assert.doesNotMatch(JSON.stringify(forbidden),/PRIVATE_ERROR|fixture-secret/);
  for(const value of [undefined,{}, {status:"accepted",childSessionKey,runId},{details:{status:"error",error:"PRIVATE_ERROR_TOKEN"}},
    {details:{status:"accepted",childSessionKey}}, {details:{status:"forbidden",childSessionKey}},
    {details:{status:"forbidden",childSessionKey:"bad identity"}}, {details:{status:"forbidden",runId:123}},
    {details:{status:"accepted",childSessionKey,runId,sentBeforeError:true}}, {isError:true,details:{status:"accepted",childSessionKey,runId}},
    {details:{status:"accepted",childSessionKey,runId,admissionPending:true}}]){
    const result=normalizeNativeAnalysisAdmission(value);assert.equal(result.state,"unknown");assert.equal(result.rejectionCode,"analysis_native_outcome_unknown");assert.doesNotMatch(JSON.stringify(result),/PRIVATE_ERROR/);
  }
});
test("installed SDK attachment-disabled preflight agrees and returns before file or child effects",{
  skip:!process.env.OPENCLAW_TEST_PACKAGE_ROOT&&"Set OPENCLAW_TEST_PACKAGE_ROOT for installed SDK verification",
},async()=>{
  const root=process.env.OPENCLAW_TEST_PACKAGE_ROOT!,dist=path.join(root,"dist");
  // Deliberately pinned integration proof for installed OpenClaw2026.9.8.
  const {m:materialize}=await import(pathToFileURL(path.join(dist,"subagent-spawn-cleanup-Dooi9-Qf.mjs")).href);
  const runtime=await import(pathToFileURL(path.join(dist,"plugin-sdk/runtime-config-snapshot.js")).href);
  assert.equal(typeof runtime.getRuntimeConfig,"function");
  const input=attachment();let assertions=0;
  const disabled=await materialize({config:{},attachments:[input],targetAgentId:"household-analysis",sandboxed:true,
    get childSessionKey(){throw Error("Unexpected attachment filesystem access");},assertActive(){assertions++;}});
  assert.deepEqual(normalizeNativeAnalysisAdmission({details:disabled}),{state:"rejected",childSessionKey:null,runId:null,rejectionCode:"analysis_attachments_disabled"});
  assert.equal(assertions,0,"Disabled attachment policy rejects before materialization effects");
  assert.equal(analysisAttachmentReadiness({},[input]),"analysis_attachments_disabled");
});

test("installed SDK retains the full enabled bounded attachment policy without config fallback",{
  skip:!process.env.OPENCLAW_TEST_PACKAGE_ROOT&&"Set OPENCLAW_TEST_PACKAGE_ROOT for installed SDK verification",
},async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),"analysis-enabled-config-"));
  try{
    const filename=path.join(directory,"openclaw.json"),expected={...nativeAnalysisAttachmentPolicy};
    const native={agents:{entries:{main:{workspace:directory}}},tools:{sessions_spawn:{attachments:expected}}};
    await writeFile(filename,JSON.stringify(native),{mode:0o600});
    const runtime=pathToFileURL(path.join(process.env.OPENCLAW_TEST_PACKAGE_ROOT!,"dist/plugin-sdk/runtime-config-snapshot.js")).href;
    const code=`import {getRuntimeConfig} from ${JSON.stringify(runtime)};const config=getRuntimeConfig();console.log(JSON.stringify({attachments:config.tools?.sessions_spawn?.attachments,workspace:config.agents?.entries?.main?.workspace}));`;
    const output=execFileSync(process.execPath,["--input-type=module","-e",code],{encoding:"utf8",timeout:30000,
      env:{PATH:process.env.PATH??"/usr/bin:/bin",LANG:"C.UTF-8",OPENCLAW_CONFIG_PATH:filename,OPENCLAW_STATE_DIR:directory},stdio:["ignore","pipe","pipe"]});
    const actual=JSON.parse(output.trim().split("\n").at(-1)!);
    assert.deepEqual(actual.attachments,expected,"Actual native config schema/read must preserve every bounded field; defaults cannot pass");
    assert.equal(actual.workspace,directory,"The native reader must use this exact isolated candidate, not a default config");
    assert.deepEqual(JSON.parse(await readFile(filename,"utf8")),native,"Readiness does not mutate prepared configuration");
  }finally{await rm(directory,{recursive:true,force:true});}
});


test("installed native sandbox policy requires the exact helper publisher allow",{
  skip:!process.env.OPENCLAW_TEST_PACKAGE_ROOT&&"Set OPENCLAW_TEST_PACKAGE_ROOT for installed sandbox policy verification",
},async()=>{
  const dist=path.join(process.env.OPENCLAW_TEST_PACKAGE_ROOT!,"dist");
  const {r:resolve,t:classify}=await import(pathToFileURL(path.join(dist,"tool-policy-CQANCgET.mjs")).href);
  const helper="household-analysis",publisher="household_analysis_publish_output";
  const entries=buildNativeExecutionProfiles({analysisWorkspace:"/fixture/analysis",diagnosticWorkspace:"/fixture/diagnostic",image:"fixture-image",sandboxUser:"1001:1001"});
  const {sandbox:omitted,...legacyTools}=entries[helper].tools;
  const before={agents:{entries:{...entries,[helper]:{...entries[helper],tools:legacyTools}}}};
  const after={agents:{entries}};
  assert.ok(legacyTools.allow.includes(publisher),"The old top-level helper allow already included publication");
  assert.equal(classify(publisher,resolve(before,helper)).blockedByAllow,true);
  const effective=resolve(after,helper);
  assert.deepEqual([...effective.allow].sort(),[...nativeAnalysisToolAllowlist,"view_image"].sort());
  assert.ok(!legacyTools.allow.includes("view_image"),"The SDK sandbox default does not expand the helper agent allowlist");
  const permitted=classify(publisher,effective);
  assert.equal(permitted.blockedByDeny,false);
  assert.equal(permitted.blockedByAllow,false);
  const denied=resolve({...after,tools:{sandbox:{tools:{deny:[publisher]}}}},helper);
  assert.equal(classify(publisher,denied).blockedByDeny,true,"An explicit sandbox deny still wins");
  assert.equal(classify(publisher,resolve(after,"household-diagnostics")).blockedByAllow,true);
});
