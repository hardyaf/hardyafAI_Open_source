import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { workshopAuthorized } from "../src/domain-runtime/workshop-authorization.ts";
import { buildWorkshopProfile, assertWorkshopProfile, workshopTools } from "../src/platform/workshop-profile.ts";
import { HouseholdTaskApplication } from "../src/domain-runtime/task-application.ts";
const configuration={ownerProfileId:"alex",image:"workshop@sha256:fixture",dataRoot:"/fixture/data",sandboxRoot:"/fixture/data/sandboxes"};
test("current personal owner can use the lab without an analysis domain or formal goal",()=>{
  const scope:any={principal:{profileId:"alex",audience:"private",assertCurrent(){}},conversation:{ownerProfileId:"alex"},mode:"normal",grant:{enabled:true,scopes:["personal"],domains:[]}};
  assert.equal(workshopAuthorized("alex",{id:"alex",role:"admin"},scope),true);
  for(const mutate of [(s:any)=>s.principal.audience="household",(s:any)=>s.conversation.ownerProfileId="another",(s:any)=>s.grant.enabled=false,(s:any)=>s.mode="diagnostic"]){
    const s={...scope,principal:{...scope.principal},conversation:{...scope.conversation},grant:{...scope.grant}};mutate(s);
    assert.equal(workshopAuthorized("alex",{id:"alex",role:"admin"},s),false);
  }
  scope.principal.assertCurrent=()=>{throw Error("revoked");};assert.throws(()=>workshopAuthorized("alex",{id:"alex",role:"admin"},scope),/revoked/);
});
test("native lab has no added quotas, offline policy, read-only OS, package ban or automatic pruning",()=>{
  const profile:any=buildWorkshopProfile(configuration),docker=profile.sandbox.docker;
  assert.equal(docker.network,"bridge");assert.equal(docker.readOnlyRoot,false);assert.equal(docker.user,"0:0");assert.equal(docker.gpus,"driver=cdi,device=nvidia.com/gpu=all");
  for(const key of ["memory","memorySwap","cpus","pidsLimit","setupCommand"])assert.equal(Object.hasOwn(docker,key),false);
  assert.deepEqual(profile.sandbox.prune,{idleHours:0,maxAgeDays:0});assert.equal(profile.tools.fs.workspaceOnly,false);assert.equal(profile.tools.exec.mode,"full");assert.equal(profile.tools.exec.strictInlineEval,false);
  const config={agents:{defaults:{model:"ollama/local"},entries:{main:{...profile,model:"ollama/local"}}}};assertWorkshopProfile(configuration,"main",JSON.parse(JSON.stringify(config)));
  for(const mutate of [(c:any)=>c.agents.entries.main.tools.exec.host="gateway",(c:any)=>c.agents.entries.main.sandbox.docker.binds.push("/:/host"),(c:any)=>c.agents.entries.main.sandbox.browser.allowHostControl=true,(c:any)=>c.agents.defaults.sandbox={docker:{memory:"8g"}}]){
    const bad=structuredClone(config);mutate(bad);assert.throws(()=>assertWorkshopProfile(configuration,"main",bad));
  }
});
function fixture(){
  let owner=true,proof=true,revoked=false;
  const binding:any={task:{principal:{profileId:"alex",canReadHousehold:true},scope:{ownerProfileId:"alex",conversationId:"conversation-a",taskId:"conversation:conversation-a",audience:"private"},native:{sessionId:"root",sessionKey:"root-key",goalId:null,goalStatus:null,objective:null,runId:"run-a"},source:{id:"human-a",text:"Explore",sha256:createHash("sha256").update("Explore").digest("hex"),human:true},mode:"normal",artifactIds:[],assertCurrent(){if(revoked)throw Error("revoked");}},execution:{agentId:"main",sessionKey:"root-key",sessionId:"root",runId:"run-a"}};
  const app=new HouseholdTaskApplication({database:{getCheckpoint:()=>null,updateCheckpoint(){throw Error("unneeded_checkpoint");}},artifacts:{} as any,resolveContext:async()=>binding,loadCatalog:()=>[],effectsEvidence:async()=>[],policies:{assertReady:async()=>{}},workshopAllowed:()=>owner,workshopToolPolicy:async()=>proof,spawn:async()=>{throw Error("unneeded_spawn");},child:async()=>{throw Error("unneeded_child");},sandboxRoots:[]});
  return{app,binding,setOwner:(v:boolean)=>owner=v,setProof:(v:boolean)=>proof=v,revoke:()=>revoked=true};
}
test("direct tools permit arbitrary scripts and packages without a helper",async()=>{
  const f=fixture(),command="python -c 'print(1)' && pip install example && apt-get install -y example";
  const result:any=await f.app.guard(f.binding,{toolName:"exec",params:{command,background:true}});assert.equal(result.allow,true);assert.equal(result.params.command,command);assert.equal(result.params.host,"sandbox");
  for(const toolName of workshopTools)assert.equal((await f.app.guard(f.binding,{toolName,params:{}})).allow,true);
  const prompt=await f.app.prompt(f.binding);for(const tool of workshopTools)assert.ok(prompt.toolsAllow?.includes(tool));assert.match(prompt.prependSystemContext,/no registration, approval, helper delegation or formal goal/);
});
test("actual deferred targets still recheck current owner and native environment",async()=>{
  const f=fixture();assert.equal((await f.app.guard(f.binding,{toolName:"tool_call",params:{}})).allow,true);
  for(const params of [{host:"gateway"},{node:"host"},{elevated:true}])assert.equal((await f.app.guard(f.binding,{toolName:"exec",params})).allow,false);
  assert.equal((await f.app.guard(f.binding,{toolName:"browser",params:{target:"host"}})).allow,false);
  f.setOwner(false);assert.equal((await f.app.guard(f.binding,{toolName:"exec",params:{command:"true"}})).allow,false);
  f.setOwner(true);f.setProof(false);assert.equal((await f.app.guard(f.binding,{toolName:"read",params:{path:"/etc/passwd"}})).allow,false);
  f.revoke();await assert.rejects(()=>f.app.guard(f.binding,{toolName:"exec",params:{command:"true"}}),/revoked/);
});
test("owner can choose local models and reasoning for native work without prescribed helper settings",async()=>{
  const f=fixture();
  assert.equal((await f.app.guard(f.binding,{toolName:"session_status",params:{model:"ollama/another-local"}})).allow,true);
  assert.equal((await f.app.guard(f.binding,{toolName:"session_status",params:{model:"openai/hosted"}})).allow,false);
  assert.equal((await f.app.guard(f.binding,{toolName:"sessions_spawn",params:{task:"Test a narrower method",model:"ollama/another-local",thinking:"low",runTimeoutSeconds:7200}})).allow,true);
  assert.equal((await f.app.guard(f.binding,{toolName:"sessions_spawn",params:{task:"Test",model:"openai/hosted"}})).allow,false);
  f.setOwner(false);assert.equal((await f.app.guard(f.binding,{toolName:"session_status",params:{model:"ollama/another-local"}})).allow,false);
});
