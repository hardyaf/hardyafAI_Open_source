import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {HouseholdDatabase} from "../src/database.ts";
import {ArtifactStore} from "../src/platform/artifacts.ts";
import {HouseholdDomainRuntime} from "../src/domain-runtime/runtime.ts";
import {DomainError,fingerprint} from "../src/domain-runtime/common.ts";
import {LocalSystemStatusReader,projectSystemStatus,readSystemStatus} from "../src/domain-runtime/system-status.ts";

function snapshot(){
 return{version:1,observedAt:"2026-11-26T17:00:00.000Z",durationMs:100,status:"ok",
  gpus:{status:"ok",devices:[{index:0,name:"NVIDIA GeForce RTX 3090",memoryUsedMiB:12000,memoryTotalMiB:24576,memoryFreeMiB:12576,utilizationPercent:50,temperatureC:55,powerDrawW:300,powerLimitW:420}]},
  cpu:{status:"ok",logicalCores:32,load1:1,load5:0.5,load15:0.2},
  ram:{status:"ok",totalMiB:64000,availableMiB:32000,usedMiB:32000},
  disk:{status:"ok",path:"/",totalGiB:1000,availableGiB:600,usedGiB:400},
  services:[{id:"native_gateway",scope:"system",status:"active"},{id:"credential_ingress",scope:"system",status:"active"},{id:"household_control",scope:"user",status:"activating"}],
  models:{status:"ok",items:[{name:"qwen3.8:27b-q4_K_M",contextTokens:131072,modelSizeBytes:26000000000,modelVramBytes:26000000000}]}};
}
async function fixture(audience:"private"|"household"="private"){
 const root=await mkdtemp(path.join(tmpdir(),"hardy-system-status-")),workspace=path.join(root,"workspace"),skills=path.join(root,"skills");
 await mkdir(workspace);await mkdir(skills);
 await writeFile(path.join(skills,"diagnostics.md"),"DIAGNOSTICS-FIXTURE: system status is a private read; evidence retains explicit diagnostic mode.");
 await writeFile(path.join(skills,"household-domains.json"),JSON.stringify({schemaVersion:1,domains:{diagnostics:{path:"diagnostics.md"}}}));
 const database=new HouseholdDatabase(":memory:"),sql=database.domainConnection();database.setProfileStatus("alex","available","Fixture");
 sql.prepare("INSERT INTO devices(id,profile_id,display_name,public_key_der_base64,status,enrolled_at) VALUES('fixture-device','alex','Fixture','unused','active',?)").run(new Date().toISOString());
 const text="Show the current system status",conversation={id:"fixture-conversation",ownerProfileId:"alex",agentId:"main",sessionKey:"hardy-home:system-status",title:"Fixture",presetId:null,audience,updatedAt:new Date().toISOString()};
 database.insertConversation(conversation);database.submissions.enqueue({submissionId:"fixture-source",conversationId:conversation.id,profileId:"alex",agentId:"main",textHash:createHash("sha256").update(text).digest("hex"),requestHash:"fixture-request",payload:{kind:"message",text},originDeviceId:"fixture-device"});
 const claim=database.submissions.claimNext(2,120000)!;database.submissions.accepted(claim.receipt.submissionId,claim.leaseToken!,{...claim.receipt,status:"running",runId:"fixture-run"});
 const grant={enabled:true,domains:["diagnostics"],scopes:["personal","household"],contactEditing:false,projectCodes:[],canManageProjects:false,canReviewReceipts:false,allowedAttendees:[],sharedDomains:["diagnostics"]};
 const configuration={version:1,profiles:{alex:grant},capture:{python:"/usr/bin/python3",script:"/fixture/capture.py",workspaces:{main:workspace}},
  google:{gogBinary:"/fixture/gog",account:"fixture@example.invalid",client:"fixture",calendarId:"fixture",timezone:"UTC"},
  memory:{workspaces:{main:workspace},sharedAgentId:"household-knowledge",wikiVaults:{main:path.join(root,"wiki")}},
  execution:{skillsRoot:skills,nativeConfigPath:"/fixture/openclaw.json",openclawBinary:"/fixture/openclaw",sandboxImage:"fixture",sandboxRoots:[root],nativeEntries:[],schedulingEnabled:false},
  documents:{python:"/usr/bin/python3",script:"/fixture/documents.py",cacheRoot:path.join(root,"documents")},
  uplift:{python:"/usr/bin/python3",moduleRoot:"/fixture/uplift",database:path.join(root,"uplift.sqlite"),vaultRoot:path.join(root,"uplift")}} as any;
 let reads=0,nextRead=async()=>snapshot();const native={sessionId:"fixture-session",runId:"fixture-run",goal:null};
 const artifacts=new ArtifactStore({root:path.join(root,"artifacts")});await artifacts.initialize();
 const runtime=new HouseholdDomainRuntime({database,artifacts,configuration,systemStatus:{read:async context=>{context.assertCurrent();reads++;return nextRead();}},
  adapter:{getContext:async()=>({...native}),listMessages:async()=>[{id:"fixture-user",role:"user",text}],getProgress:async()=>null}as any});
 runtime.admission.authority.bind({sessionKey:conversation.sessionKey,rootSessionKey:conversation.sessionKey,sourceId:"fixture-source",parentSessionKey:null,agentId:"main",sessionId:"fixture-session",goalId:null,runId:"fixture-run",mode:"normal"});
 const context={agentId:"main",sessionKey:conversation.sessionKey,sessionId:"fixture-session",runId:"fixture-run",assertInvocationCurrent(){}};
 let call=0;
 async function invoke(name="household_diagnostics_system_status",args:unknown={},patch:Record<string,unknown>={}){
  const bound={...context,...patch,toolCallId:"fixture-call-"+(++call)};
  runtime.admission.authority.invocations.bind({agentId:bound.agentId,sessionKey:bound.sessionKey,sessionId:bound.sessionId,toolCallId:bound.toolCallId,toolName:name,argumentHash:fingerprint(args)},"fixture-run",()=>{});
  return runtime.executeNativeInvocation(name,args,bound);
 }
 return{database,sql,runtime,configuration,grant,context,native,conversation,invoke,reads:()=>reads,
  setRead:(fn:()=>Promise<any>)=>{nextRead=fn;},load:()=>runtime.execute("household_task_select_domains",{domains:["diagnostics"]},context),
  close:async()=>{await runtime.close();database.close();await rm(root,{recursive:true,force:true});}};
}
test("ordinary private operator invocation returns safe live status without creating a goal or effects",async()=>{
 const f=await fixture();try{
  await f.load();const before=f.sql.prepare("SELECT COUNT(*) AS n FROM domain_effects").get()as any;
  assert(f.runtime.catalog(f.context).some(t=>t.nativeName==="household_diagnostics_system_status"));
  const raw=snapshot()as any;raw.secret="private-sentinel";raw.gpus.devices[0].uuid="private-sentinel";raw.models.items[0].environment="private-sentinel";f.setRead(async()=>raw);
  const result=await f.invoke()as any;assert.equal(result.gpus.devices[0].memoryTotalMiB,24576);assert.equal(result.models.items[0].contextTokens,131072);
  assert.equal(JSON.stringify(result).includes("private-sentinel"),false);assert.equal(f.reads(),1);assert.equal(f.native.goal,null);
  assert.equal(f.database.getSubmissionDomainBinding("fixture-source")?.goalBound,false);
  assert.deepEqual(f.sql.prepare("SELECT COUNT(*) AS n FROM domain_effects").get(),before);
 }finally{await f.close();}
});
test("existing task evidence still requires explicit diagnostic mode",async()=>{
 const f=await fixture();try{await f.load();await assert.rejects(f.invoke("household_diagnostics_evidence"),/explicit_diagnostic_task_required/);assert.equal(f.reads(),0);}finally{await f.close();}
});
test("strict empty input rejects commands URLs paths and malformed containers before collection",async()=>{
 const f=await fixture();try{await f.load();for(const args of [{command:"nvidia-smi"},{url:"http://example.invalid"},{path:"/etc/shadow"},null,[]])
  await assert.rejects(f.invoke("household_diagnostics_system_status",args),/domain_tool_arguments_invalid/);
  assert.equal(f.reads(),0);
 }finally{await f.close();}
});
test("a shared conversation cannot expose operator telemetry even with diagnostics shared",async()=>{
 const f=await fixture("household");try{await f.load();assert.equal(f.runtime.catalog(f.context).some(t=>t.name==="diagnostics.system_status"),false);
  await assert.rejects(f.invoke(),/diagnostic_private_conversation_required/);assert.equal(f.reads(),0);
 }finally{await f.close();}
});
test("nonoperators missing capabilities and missing current grants never collect or expose metadata",async()=>{
 for(const mutate of [
  (f:any)=>f.sql.prepare("UPDATE profiles SET role='adult' WHERE id='alex'").run(),
  (f:any)=>f.sql.prepare("UPDATE profiles SET capabilities_json=? WHERE id='alex'").run(JSON.stringify(["chat"])),
  (f:any)=>{f.grant.enabled=false;},
  (f:any)=>{f.grant.domains=[];},
  (f:any)=>{f.grant.scopes=[];},
 ]){
  const f=await fixture();try{await f.load();mutate(f);assert.equal(f.runtime.catalog(f.context).some(t=>t.name==="diagnostics.system_status"),false);
   await assert.rejects(f.invoke());assert.equal(f.reads(),0);
  }finally{await f.close();}
 }
});
test("absent forged stale and revoked native authority cannot reach the reader",async()=>{
 const f=await fixture();try{await f.load();
  await assert.rejects(f.runtime.executeNativeInvocation("household_diagnostics_system_status",{},f.context),/trusted_native_invocation_required/);
  await assert.rejects(f.invoke("household_diagnostics_system_status",{},{assertInvocationCurrent:undefined}),/trusted_native_invocation_required/);
  await assert.rejects(f.invoke("household_diagnostics_system_status",{},{sessionId:"stale-session"}));
  await assert.rejects(f.invoke("household_diagnostics_system_status",{},{agentId:"forged-agent"}));
  await assert.rejects(f.invoke("household_diagnostics_system_status",{},{assertInvocationCurrent(){throw new DomainError("native_invocation_not_current");}}),/native_invocation_not_current/);
  assert.equal(f.reads(),0);
 }finally{await f.close();}
});
test("mid-flight device profile grant source and audience revocation drops collected status",async()=>{
 for(const mutate of [
  (f:any)=>f.sql.prepare("UPDATE devices SET status='revoked' WHERE id='fixture-device'").run(),
  (f:any)=>f.sql.prepare("UPDATE profiles SET role='adult' WHERE id='alex'").run(),
  (f:any)=>f.sql.prepare("UPDATE profiles SET capabilities_json=? WHERE id='alex'").run(JSON.stringify(["chat"])),
  (f:any)=>{f.configuration.profiles.alex={...f.grant,enabled:false};},
  (f:any)=>{f.configuration.profiles.alex={...f.grant,domains:[]};},
  (f:any)=>f.database.submissions.failWithCode("fixture-source","fixture-run","operator_stop","cancelled"),
  (f:any)=>f.sql.prepare("UPDATE conversations SET audience='household' WHERE id='fixture-conversation'").run(),
 ]){
  const f=await fixture();try{await f.load();f.setRead(async()=>{mutate(f);return snapshot();});await assert.rejects(f.invoke());assert.equal(f.reads(),1);}finally{await f.close();}
 }
});
test("collector failures expose fixed timeout or unavailable codes without raw process text",async()=>{
 for(const [error,expected]of[[new DomainError("dependency_timeout"),"system_status_timeout"],[Error("password=private-sentinel /etc/private"),"system_status_unavailable"]]as const){
  const f=await fixture();try{await f.load();f.setRead(async()=>{throw error;});await assert.rejects(f.invoke(),e=>{assert.equal((e as DomainError).code,expected);assert.equal(String(e).includes("private-sentinel"),false);return true;});}finally{await f.close();}
 }
});
test("partial and unavailable sections remain explicit and unmeasured",()=>{
 const raw=snapshot()as any;raw.status="partial";raw.gpus={status:"unavailable",errorCode:"command_missing",devices:[{secret:"private-sentinel"}]};raw.models={status:"unavailable",errorCode:"ollama_unavailable"};
 const result=projectSystemStatus(raw);assert.deepEqual(result.gpus,{status:"unavailable",errorCode:"command_missing"});assert.deepEqual(result.models,{status:"unavailable",errorCode:"ollama_unavailable"});
});
test("invalid measurements service identifiers unknown errors and oversized row counts fail closed",()=>{
 for(const mutate of [
  (x:any)=>{x.gpus.devices[0].memoryUsedMiB=30000;},(x:any)=>{x.gpus.devices[0].utilizationPercent=101;},
  (x:any)=>{x.gpus.devices[0].temperatureC=201;},(x:any)=>{x.gpus.devices[0].powerDrawW=100001;},
  (x:any)=>{x.cpu.load1=Infinity;},(x:any)=>{x.ram.availableMiB=70000;},(x:any)=>{x.disk.usedGiB=1001;},
  (x:any)=>{x.disk.path="/private";},(x:any)=>{x.durationMs=6001;},(x:any)=>{x.services[0].id="unrestricted-service";},
  (x:any)=>{x.gpus={status:"unavailable",errorCode:"private-sentinel"};},(x:any)=>{x.models.items=Array(17).fill(x.models.items[0]);},
  (x:any)=>{x.models.items[0].name="private\ninjection";},
 ]){
  const raw=snapshot();mutate(raw);assert.throws(()=>projectSystemStatus(raw),/system_status_invalid_response/);
 }
});
test("typed process adapter uses only fixed executable script arguments and clean bounded options",async()=>{
 let captured:any;
 const reader=new LocalSystemStatusReader({async runJson(binary,args,options){captured={binary,args,options};return snapshot();}});
 const context={assertCurrent(){}};const result=await readSystemStatus(reader,context);
 assert.equal(result.version,1);assert.equal(captured.binary,"/usr/bin/python3");assert.equal(captured.args[0],"-I");
 assert.equal(captured.args[1],path.resolve(import.meta.dirname,"../../../tools/read-system-status.py"));assert.equal(captured.args.length,2);
 assert.equal(captured.options.maxBytes,32768);assert.equal(captured.options.timeoutMs,7000);assert.equal(captured.options.effect,false);
 assert.deepEqual(captured.options.env,{PATH:"/usr/bin:/bin",HOME:"/nonexistent",LANG:"C.UTF-8"});assert.equal(captured.options.assertCurrent,context.assertCurrent);
});

test("cancellation before or during a status read cannot return a snapshot",async()=>{
 const controller=new AbortController();let reads=0;
 const reader={async read(){reads++;return snapshot();}};
 controller.abort();await assert.rejects(readSystemStatus(reader,{assertCurrent(){},signal:controller.signal}),/operation_cancelled/);assert.equal(reads,0);
 const during=new AbortController();
 await assert.rejects(readSystemStatus({async read(){during.abort();return snapshot();}},{assertCurrent(){},signal:during.signal}),/operation_cancelled/);
});
