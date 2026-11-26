import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";
import {HouseholdDatabase} from "../src/database.ts";
import {HouseholdDomainRuntime} from "../src/domain-runtime/runtime.ts";
import {NativeDomainAuthorization} from "../src/domain-runtime/native-scope.ts";
import {ExecutionAuthorityRepository} from "../src/request-context.ts";
import {ArtifactStore} from "../src/platform/artifacts.ts";
import {domainCatalog} from "../src/domain-runtime/catalog.ts";
import {taskToolDescriptors} from "../src/task-flow/catalog.ts";
import {analysisToolDescriptors} from "../src/analysis-flow/catalog.ts";
import {nativeToolName} from "../src/domain-runtime/common.ts";
import {registerHouseholdRuntime} from "../../../plugins/household-domains/native-runtime.mjs";

async function fixture(audience:"private"|"household"="private") {
 const root=await mkdtemp(path.join(tmpdir(),"hardy-native-catalog-")),workspace=path.join(root,"workspace");await mkdir(workspace);
 const database=new HouseholdDatabase(":memory:"),sql=database.domainConnection();database.setProfileStatus("alex","available","Fixture");
 const conversation={id:"fixture-conversation",ownerProfileId:"alex",agentId:"main",sessionKey:"hardy-home:fixture",title:"Fixture",presetId:null,audience,updatedAt:new Date().toISOString()};database.insertConversation(conversation);
 const grant={enabled:true,domains:["email","calendar","lists","diagnostics"],scopes:["personal","household"] as Array<"personal"|"household">,
  contactEditing:false,projectCodes:[],canManageProjects:false,canReviewReceipts:false,allowedAttendees:[],sharedDomains:["calendar","lists"]};
 const configuration={version:1,profiles:{alex:grant},capture:{python:"/usr/bin/python3",script:"/fixture/capture.py",workspaces:{main:workspace}},
  google:{gogBinary:"/fixture/gog",account:"fixture@example.invalid",client:"fixture",calendarId:"fixture",timezone:"America/New_York"},
  memory:{workspaces:{main:workspace},sharedAgentId:"household-knowledge",wikiVaults:{main:path.join(root,"wiki")}},
  execution:{skillsRoot:"/fixture/skills",nativeConfigPath:"/fixture/openclaw.json",openclawBinary:"/fixture/openclaw",sandboxImage:"fixture-image",sandboxRoots:[root],nativeEntries:[],schedulingEnabled:false},
  documents:{python:"/usr/bin/python3",script:"/fixture/documents.py",cacheRoot:path.join(root,"documents")},
  uplift:{python:"/usr/bin/python3",moduleRoot:"/fixture/uplift",database:path.join(root,"uplift.sqlite"),vaultRoot:path.join(root,"uplift")}} as any;
 const artifacts=new ArtifactStore({root:path.join(root,"artifacts")});await artifacts.initialize();
 const runtime=new HouseholdDomainRuntime({database,artifacts,configuration,adapter:{getContext:async()=>({sessionId:"fixture-session",goal:null,runId:"fixture-run"})} as any});
 let factory:any,service:any,effects=0;
 runtime.executeNativeInvocation=async()=>{effects++;throw Error("unexpected_execution");};
 const api={id:"hardy-household",config:{plugins:{entries:{"hardy-household":{hooks:{allowConversationAccess:true,allowPromptInjection:true}}}}},pluginConfig:{},runtime:{config:{current:()=>({})}},logger:{error(){},info(){}},
  on(){},registerHook(){},registerTrustedToolPolicy(){},registerTool(value:any){factory=value;},registerService(value:any){service=value;},registerGatewayMethod(){}};
 const fullDescriptors=[...domainCatalog,...[...taskToolDescriptors,...analysisToolDescriptors].map(tool=>({...tool,nativeName:nativeToolName(tool.name),domain:tool.name.split(".")[0]}))];
 registerHouseholdRuntime(api,{descriptors:fullDescriptors,createOwned:async()=>({runtime,close:async()=>runtime.close()}),spawnNativeAnalysis:async()=>{throw Error("unexpected_inference");},resolveSandboxRuntimeStatus(){throw Error("unexpected_sandbox");}});
 await service.start();
 const metadata={agentId:"main",sessionKey:conversation.sessionKey,sessionId:"fixture-session",assertInvocationCurrent(){throw Error("metadata_has_no_invocation_authority");}};
 return {root,database,sql,runtime,grant,conversation,factory,metadata,effects:()=>effects,authorization:new NativeDomainAuthorization(database,configuration.profiles),
  async close(){await service.stop();database.close();await rm(root,{recursive:true,force:true});}};
}
const required=["household_task_select_domains","household_email_connections","household_calendar_connections"];

test("initialized household runtime catalogs current owner schemas without run execution authority",async()=>{
 const f=await fixture();try{
  const names=f.factory.create(f.metadata).map((tool:any)=>tool.name);for(const name of required)assert.ok(names.includes(name),name);
  assert.equal(f.effects(),0);assert.ok(f.authorization.catalogGrant({agentId:"main",sessionKey:f.conversation.sessionKey}));
  const tool=f.factory.create(f.metadata).find((tool:any)=>tool.name==="household_task_select_domains");
  assert.equal((await tool.execute("standalone-call",{domains:["email"]})).isError,true);assert.equal(f.effects(),0);
  const absent=f.factory.create({agentId:"main",sessionKey:f.conversation.sessionKey}).find((tool:any)=>tool.name==="household_task_select_domains");
  assert.equal((await absent.execute("missing-authority",{domains:["email"]})).isError,true);assert.equal(f.effects(),0);
 }finally{await f.close();}
});
test("metadata discovery rejects unknown mismatched child disabled paused and nonchat principals",async()=>{
 const f=await fixture();try{
  for(const context of [{...f.metadata,agentId:"natasha"},{...f.metadata,sessionKey:"unmapped"},{...f.metadata,sessionKey:"agent:main:subagent:hardy-home:fixture"}])assert.equal(f.authorization.catalogGrant(context),null);
  f.grant.enabled=false;assert.equal(f.authorization.catalogGrant(f.metadata),null);f.grant.enabled=true;
  f.database.setProfileStatus("alex","paused","Fixture");assert.equal(f.authorization.catalogGrant(f.metadata),null);f.database.setProfileStatus("alex","available","Fixture");
  f.sql.prepare("UPDATE profiles SET role='child' WHERE id='alex'").run();assert.equal(f.authorization.catalogGrant(f.metadata),null);
  f.sql.prepare("UPDATE profiles SET role='admin',capabilities_json='[]' WHERE id='alex'").run();assert.equal(f.authorization.catalogGrant(f.metadata),null);
 }finally{await f.close();}
});
test("optional metadata session generation must match canonical projection and never grants execution",async()=>{
 const f=await fixture();try{
  f.database.submissions.enqueue({submissionId:"fixture-source",conversationId:f.conversation.id,profileId:"alex",agentId:"main",textHash:"0".repeat(64),requestHash:"fixture-request",payload:{kind:"message",text:"Fixture"}});
  new ExecutionAuthorityRepository(f.sql).bind({sessionKey:f.conversation.sessionKey,rootSessionKey:f.conversation.sessionKey,sourceId:"fixture-source",parentSessionKey:null,agentId:"main",sessionId:"fixture-session",goalId:null,runId:"fixture-run",mode:"normal"});
  assert.ok(f.authorization.catalogGrant(f.metadata));assert.equal(f.authorization.catalogGrant({...f.metadata,sessionId:"stale-session"}),null);
  assert.ok(f.authorization.catalogGrant({agentId:"main",sessionKey:f.conversation.sessionKey}));
  assert.throws(()=>f.authorization.resolve(f.metadata),/trusted_native_context_required/);assert.equal(f.effects(),0);
 }finally{await f.close();}
});
test("household metadata remains in shared scopes and sandbox helper catalogs retain their roles",async()=>{
 const f=await fixture("household");try{
  const names=f.factory.create(f.metadata).map((tool:any)=>tool.name);
  assert.ok(names.includes("household_calendar_connections"));assert.equal(names.includes("household_email_connections"),false);
  f.grant.scopes=["personal"];assert.equal(f.authorization.catalogGrant(f.metadata),null);
  assert.deepEqual(f.runtime.catalog({agentId:"household-analysis"}).map(tool=>tool.nativeName),["household_analysis_publish_output"]);
  assert.deepEqual(f.runtime.catalog({agentId:"household-diagnostics"}),[]);
 }finally{await f.close();}
});
test("plugin manifest declares every full runtime descriptor with matching optional metadata",async()=>{
 const manifest=JSON.parse(await readFile(new URL("../../../plugins/household-domains/openclaw.plugin.json",import.meta.url),"utf8"));
 const names=[...domainCatalog,...[...taskToolDescriptors,...analysisToolDescriptors].map(tool=>({...tool,nativeName:nativeToolName(tool.name)}))].map(tool=>tool.nativeName).sort();
 assert.deepEqual([...manifest.contracts.tools].sort(),names);assert.deepEqual(Object.keys(manifest.toolMetadata).sort(),names);
 for(const name of names)assert.equal(manifest.toolMetadata[name].optional,true,name);
});
test("official installed SDK V2 metadata factory discovers owner tools and denies retained execution without authority",{
 skip:!process.env.OPENCLAW_TEST_PACKAGE_ROOT&&"Set OPENCLAW_TEST_PACKAGE_ROOT for installed SDK factory verification",
},async()=>{
 const f=await fixture();const symbol="hardy-native-catalog-fixture",pluginId="hardy-catalog-probe";
 try{
  const plugin=path.join(f.root,"plugin");await mkdir(plugin);
  (globalThis as any)[Symbol.for(symbol)]={create:(context:any)=>{(globalThis as any)[Symbol.for(symbol)].context=context;return f.factory.create(context);}};
  await writeFile(path.join(plugin,"package.json"),JSON.stringify({name:pluginId,version:"0.0.1",type:"module",openclaw:{extensions:["./index.mjs"]}}));
  await writeFile(path.join(plugin,"openclaw.plugin.json"),JSON.stringify({id:pluginId,name:pluginId,version:"0.0.1",contracts:{tools:required},toolMetadata:Object.fromEntries(required.map(name=>[name,{optional:true}])),configSchema:{type:"object",additionalProperties:false,properties:{}}}));
  await writeFile(path.join(plugin,"index.mjs"),`export default {id:${JSON.stringify(pluginId)},name:${JSON.stringify(pluginId)},register(api){api.registerTool({contextVersion:2,create(context){return globalThis[Symbol.for(${JSON.stringify(symbol)})].create(context);}},{names:${JSON.stringify(required)},optional:true});}};`);
  const require=createRequire(path.join(process.env.OPENCLAW_TEST_PACKAGE_ROOT!,"package.json"));
  const {createOpenClawCodingTools}=await import(pathToFileURL(require.resolve("openclaw/plugin-sdk/agent-harness")).href);
  const config={agents:{defaults:{workspace:path.join(f.root,"workspace")},entries:{main:{workspace:path.join(f.root,"workspace"),tools:{allow:required}}}},tools:{toolSearch:false},plugins:{allow:[pluginId],load:{paths:[plugin]},entries:{[pluginId]:{enabled:true}}}};
  const tools=createOpenClawCodingTools({config,agentId:"main",sessionKey:f.conversation.sessionKey,sessionId:"fixture-session",workspaceDir:path.join(f.root,"workspace"),includeCoreTools:false,
    toolConstructionPlan:{includeBaseCodingTools:false,includeShellTools:false,includeChannelTools:false,includeOpenClawTools:false,includePluginTools:true}});
  for(const name of required)assert.ok(tools.some((tool:any)=>tool.name===name),name);
  const captured=(globalThis as any)[Symbol.for(symbol)].context;
  assert.equal(captured.runId,undefined);assert.throws(()=>captured.assertInvocationCurrent(),/outside an admitted run or request/);
  const selected=tools.find((tool:any)=>tool.name==="household_task_select_domains");
  await assert.rejects(async()=>selected.execute("unadmitted-call",{domains:["email"]}),/outside an admitted run or request/);assert.equal(f.effects(),0);
 }finally{delete (globalThis as any)[Symbol.for(symbol)];await f.close();}
});
