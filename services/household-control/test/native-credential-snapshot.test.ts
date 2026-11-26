import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {HouseholdDatabase} from "../src/database.ts";
import {ArtifactStore} from "../src/platform/artifacts.ts";
import {HouseholdDomainRuntime} from "../src/domain-runtime/runtime.ts";
import {ConnectedGoogleClient} from "../src/domain-runtime/connected-google.ts";
import {NativeDomainAuthorization} from "../src/domain-runtime/native-scope.ts";
import {fingerprint} from "../src/domain-runtime/common.ts";
import {createNativeCredentialConsumer,listenNativeCredentialConsumer} from "../src/connections/native-consumer.ts";
import {ConnectionsService} from "../src/connections/service.ts";
import {ConnectionRepository} from "../src/connections/repository.ts";
import type {ConnectionVault,GoogleProvider} from "../src/connections/contracts.ts";

async function fixture(goal=false,audience:"private"|"household"="private"){
 const root=await mkdtemp(path.join(tmpdir(),"hardy-native-credential-snapshot-")),workspace=path.join(root,"workspace"),skills=path.join(root,"skills");
 await mkdir(workspace);await mkdir(skills);await writeFile(path.join(skills,"household-domains.json"),JSON.stringify({schemaVersion:1,domains:{}}));
 const database=new HouseholdDatabase(":memory:"),sql=database.domainConnection();database.setProfileStatus("alex","available","Fixture");
 sql.prepare("INSERT INTO devices(id,profile_id,display_name,public_key_der_base64,status,enrolled_at) VALUES ('fixture-device','alex','Fixture','unused','active',?)").run(new Date().toISOString());
 const text="Fixture selected Gmail read",conversation={id:"fixture-conversation",ownerProfileId:"alex",agentId:"main",sessionKey:"hardy-home:fixture",title:"Fixture",presetId:null,audience,updatedAt:new Date().toISOString()};
 database.insertConversation(conversation);database.submissions.enqueue({submissionId:"fixture-source",conversationId:conversation.id,profileId:"alex",agentId:"main",
  textHash:createHash("sha256").update(text).digest("hex"),requestHash:"fixture-request",payload:{kind:"message",text},originDeviceId:"fixture-device"});
 const claim=database.submissions.claimNext(2,120000)!;database.submissions.accepted(claim.receipt.submissionId,claim.leaseToken!,{...claim.receipt,status:"running",runId:"fixture-run"});
 const native={sessionId:"fixture-session",runId:"fixture-run",goal:goal?{id:"fixture-goal",status:"active",objective:"Fixture"}:null};
 if(goal)sql.prepare("UPDATE submissions SET goal_id='fixture-goal',domain_goal_bound=1 WHERE id='fixture-source'").run();
 const grant={enabled:true,domains:["email","calendar"],scopes:["personal","household"],contactEditing:false,projectCodes:[],canManageProjects:false,canReviewReceipts:false,allowedAttendees:[],sharedDomains:["email","calendar"]};
 const configuration={version:1,profiles:{alex:grant},capture:{python:"/usr/bin/python3",script:"/fixture/capture.py",workspaces:{main:workspace}},
  google:{gogBinary:"/fixture/gog",account:"fixture@example.invalid",client:"fixture",calendarId:"fixture",timezone:"America/New_York"},
  memory:{workspaces:{main:workspace},sharedAgentId:"household-knowledge",wikiVaults:{main:path.join(root,"wiki")}},
  execution:{skillsRoot:skills,nativeConfigPath:"/fixture/openclaw.json",openclawBinary:"/fixture/openclaw",sandboxImage:"fixture",sandboxRoots:[root],nativeEntries:[],schedulingEnabled:false},
  documents:{python:"/usr/bin/python3",script:"/fixture/documents.py",cacheRoot:path.join(root,"documents")},
  uplift:{python:"/usr/bin/python3",moduleRoot:"/fixture/uplift",database:path.join(root,"uplift.sqlite"),vaultRoot:path.join(root,"uplift")}} as any;
 const values=new Map<string,string>();let vaultReads=0,refreshes=0,providerReads=0;
 const vault:ConnectionVault={configured:async()=>true,bootstrap:async()=>{},put:async(key,value)=>{values.set(key,value);return{secretId:key,revision:"fixture"};},
  read:async key=>{vaultReads++;return values.get(key)!;},replace:async(key,previous,value)=>{assert.equal(values.get(key),previous);values.set(key,value);return{secretId:key,revision:"fixture"};}};
 const provider:GoogleProvider={authorizationUrl:async input=>"https://accounts.google.com/?state="+input.state,
  exchange:async input=>({refreshToken:"fixture-refresh-secret",email:input.expectedEmail,accountId:"fixture-subject",scopes:input.scopes}),revoke:async()=>{},
  refresh:async()=>{refreshes++;return{accessToken:"fixture-access-secret",refreshToken:"fixture-rotated-secret"};},
  read:async(access,operation,input)=>{providerReads++;assert.equal(access,"fixture-access-secret");assert.equal(operation,"gmail.search");assert.deepEqual(input,{query:"newer_than:7d",limit:1});return{messages:[]};}};
 const service=new ConnectionsService({store:new ConnectionRepository(sql),vault,google:provider,securityReady:()=>true}),current=()=>{};
 await service.configureGoogle("alex",{operationId:"fixture-config-0001",clientId:"fixture.apps.googleusercontent.com",clientSecret:"fixture-client-secret",redirectUri:"http://localhost:8787/oauth2/callback"},current);
 const flow=await service.startGoogle("alex",{operationId:"fixture-google-0001",label:"Fixture",expectedEmail:"fixture@example.invalid",preset:"gmail_read"},current);
 await service.completeGoogle("alex",{flowId:flow.flowId,callbackUrl:"http://localhost:8787/oauth2/callback?state="+new URL(flow.authorizationUrl).searchParams.get("state")+"&code=fixture-code"},current);
 const connectionId=(await service.snapshot("alex")).connections.find(row=>row.kind==="google")!.id;vaultReads=0;
 const server=createNativeCredentialConsumer({database,service,configuration}),socket=path.join(root,"consumer.sock");await listenNativeCredentialConsumer(server,socket);
 const client=new ConnectedGoogleClient(socket);let observed:any;
 const connected={list(context:any){observed=context;return client.list(context);},read(id:string,tool:string,args:unknown,context:any){observed=context;return client.read(id,tool,args,context);}};
 const artifacts=new ArtifactStore({root:path.join(root,"artifacts")});await artifacts.initialize();
 const runtime=new HouseholdDomainRuntime({database,artifacts,configuration,connectedGoogle:connected,adapter:{getContext:async()=>({...native}),listMessages:async()=>[{id:"fixture-user",role:"user",text}]} as any});
 runtime.admission.authority.bind({sessionKey:conversation.sessionKey,rootSessionKey:conversation.sessionKey,sourceId:"fixture-source",parentSessionKey:null,agentId:"main",sessionId:"fixture-session",goalId:native.goal?.id??null,runId:"fixture-run",mode:"normal"});
 const context={agentId:"main",sessionKey:conversation.sessionKey,sessionId:"fixture-session",runId:"fixture-run",
  nativeSessionId:"old-discovery-session",nativeRunId:"old-discovery-run",nativeGoalId:"old-discovery-goal",nativeGoalStatus:"complete",assertInvocationCurrent(){}};
 const authorization=new NativeDomainAuthorization(database,configuration.profiles);
 async function invoke(name:string,args:unknown,patch:Record<string,unknown>={}){
  const bound={...context,...patch,toolCallId:"fixture-call-"+Math.random()};
  const identity={agentId:bound.agentId,sessionKey:bound.sessionKey,sessionId:bound.sessionId,toolCallId:bound.toolCallId,toolName:name,argumentHash:fingerprint(args)};
  runtime.admission.authority.invocations.bind(identity,"fixture-run",()=>{});
  return runtime.executeNativeInvocation(name,args,bound);
 }
 async function load(){await runtime.execute("household_task_select_domains",{domains:["email"]},context);}
 return{root,database,sql,runtime,context,native,grant,client,connectionId,authorization,invoke,load,observed:()=>observed,
  counts:()=>({vaultReads,refreshes,providerReads}),
  async close(){await runtime.close();service.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));database.close();await rm(root,{recursive:true,force:true});}};
}

test("runtime forwards the exact locally authorized native snapshot through real credential consumer",async()=>{
 const f=await fixture();try{
  const original={...f.context};await f.load();
  // Characterize the former wire: local observation succeeds while original SDK
  // native fields are stale and the isolated consumer correctly refuses them.
  const scope=await (f.runtime as any).scope(f.context);scope.principal.assertCurrent();
  assert.equal(scope.credentialAuthority.nativeSessionId,"fixture-session");assert.ok(Object.isFrozen(scope.credentialAuthority));
  const oldWire={profileId:"alex",agentId:"main",sessionKey:f.context.sessionKey,conversationId:"fixture-conversation",audience:"private",allowedScopes:["personal"],authorizedAttendees:[],credentialAuthority:{...f.context},assertCurrent(){}};
  delete (oldWire.credentialAuthority as any).assertInvocationCurrent;
  await assert.rejects(f.client.list(oldWire as any),/native_session_generation_changed/);
  const absentNativeFields={agentId:f.context.agentId,sessionKey:f.context.sessionKey,sessionId:f.context.sessionId,runId:f.context.runId};
  await assert.rejects(f.client.list({...oldWire,credentialAuthority:absentNativeFields} as any),/native_session_generation_changed/);
  assert.deepEqual(f.counts(),{vaultReads:0,refreshes:0,providerReads:0});
  const list=await f.invoke("household_email_connections",{}) as any;assert.equal(list.connections[0].id,f.connectionId);
  await f.invoke("household_email_connections",{},{nativeRunId:undefined,nativeSessionId:undefined,nativeGoalId:undefined,nativeGoalStatus:undefined});
  assert.deepEqual(f.observed().credentialAuthority,scope.credentialAuthority);assert.deepEqual(f.context,original);
  const result=await f.invoke("household_email_search",{connectionId:f.connectionId,query:"newer_than:7d",limit:1}) as any;
  assert.equal(result.source,"connected_google");assert.equal(result.result.connectionId,f.connectionId);
  assert.deepEqual(f.counts(),{vaultReads:2,refreshes:1,providerReads:1});
  assert.doesNotMatch(JSON.stringify(result),/fixture-access-secret|fixture-refresh-secret|fixture-rotated-secret|fixture-client-secret/);
 }finally{await f.close();}
});
test("goal-bound snapshot sends the same active native goal and rejects forged consumer run goal and generation",async()=>{
 const f=await fixture(true);try{
  await f.load();await f.invoke("household_email_connections",{});const observed=f.observed(),authority=observed.credentialAuthority;
  assert.equal(authority.nativeGoalId,"fixture-goal");assert.equal(authority.nativeGoalStatus,"active");
  for(const patch of [{sessionId:"stale-session"},{nativeSessionId:"stale-session"},{runId:"forged-run"},{nativeGoalId:"forged-goal"},{nativeGoalStatus:"complete"}])
   await assert.rejects(f.client.read(f.connectionId,"household_email_search",{query:"newer_than:7d",limit:1},{...observed,credentialAuthority:{...authority,...patch},assertCurrent(){}}));
  assert.deepEqual(f.counts(),{vaultReads:0,refreshes:0,providerReads:0});
 }finally{await f.close();}
});
test("snapshot forwarding does not normalize a stale SDK session or bypass an absent or revoked invocation guard",async()=>{
 const f=await fixture();try{
  await f.load();
  await assert.rejects(f.invoke("household_email_connections",{},{sessionId:"stale-sdk-session"}),/trusted_native_invocation_required|native_session_generation_changed/);
  await assert.rejects(f.invoke("household_email_connections",{},{assertInvocationCurrent:undefined}),/trusted_native_invocation_required/);
  await assert.rejects(f.invoke("household_email_connections",{},{assertInvocationCurrent(){throw Error("fixture-context-revoked");}}),/fixture-context-revoked/);
  assert.deepEqual(f.counts(),{vaultReads:0,refreshes:0,providerReads:0});
 }finally{await f.close();}
});
test("current canonical device profile source and audience fences still stop snapshot-based consumer access",async()=>{
 for(const revoke of [
  (f:any)=>f.sql.prepare("UPDATE devices SET status='revoked' WHERE id='fixture-device'").run(),
  (f:any)=>f.database.setProfileStatus("alex","paused","Fixture"),
  (f:any)=>{f.grant.enabled=false;},
  (f:any)=>f.database.submissions.failWithCode("fixture-source","fixture-run","operator_stop","cancelled"),
  (f:any)=>f.sql.prepare("UPDATE conversations SET audience='household' WHERE id='fixture-conversation'").run(),
 ]){
  const f=await fixture();try{
   await f.load();await f.invoke("household_email_connections",{});const observed=f.observed();revoke(f);
   await assert.rejects(f.client.read(f.connectionId,"household_email_search",{query:"newer_than:7d",limit:1},{...observed,assertCurrent(){}}));
   assert.deepEqual(f.counts(),{vaultReads:0,refreshes:0,providerReads:0});
  }finally{await f.close();}
 }
});
