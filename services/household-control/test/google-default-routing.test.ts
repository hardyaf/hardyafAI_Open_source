import assert from "node:assert/strict";
import test from "node:test";
import {request as httpRequest} from "node:http";
import {createHash} from "node:crypto";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {HouseholdDatabase} from "../src/database.ts";
import {ArtifactStore} from "../src/platform/artifacts.ts";
import {HouseholdDomainRuntime} from "../src/domain-runtime/runtime.ts";
import {ConnectedGoogleClient} from "../src/domain-runtime/connected-google.ts";
import {NativeDomainAuthorization} from "../src/domain-runtime/native-scope.ts";
import {GoogleDomain} from "../src/domains/google/index.ts";
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
 const values=new Map<string,string>();let vaultReads=0,refreshes=0,providerReads=0,legacyCalls=0;const providerCalls:Array<{operation:string;input:unknown}>=[];
 const vault:ConnectionVault={configured:async()=>true,bootstrap:async()=>{},put:async(key,value)=>{values.set(key,value);return{secretId:key,revision:"fixture"};},
  read:async key=>{vaultReads++;return values.get(key)!;},replace:async(key,previous,value)=>{assert.equal(values.get(key),previous);values.set(key,value);return{secretId:key,revision:"fixture"};}};
 const provider:GoogleProvider={authorizationUrl:async input=>"https://accounts.google.com/?state="+input.state,
  exchange:async input=>({refreshToken:"fixture-refresh-secret",email:input.expectedEmail,accountId:"fixture-subject",scopes:input.scopes}),revoke:async()=>{},
  refresh:async()=>{refreshes++;return{accessToken:"fixture-access-secret",refreshToken:"fixture-rotated-secret"};},
  read:async(access,operation,input)=>{providerReads++;assert.equal(access,"fixture-access-secret");providerCalls.push({operation,input});return operation==="gmail.search"?{messages:[{id:"fixture-message"}]}:{id:"fixture-message",payload:{headers:[]}};}};
 const store=new ConnectionRepository(sql);const service=new ConnectionsService({store,vault,google:provider,securityReady:()=>true}),current=()=>{};
 await service.configureGoogle("alex",{operationId:"fixture-config-0001",clientId:"fixture.apps.googleusercontent.com",clientSecret:"fixture-client-secret",redirectUri:"http://localhost:8787/oauth2/callback"},current);
 const flow=await service.startGoogle("alex",{operationId:"fixture-google-0001",label:"Fixture",expectedEmail:"fixture@example.invalid",preset:"gmail_read"},current);
 await service.completeGoogle("alex",{flowId:flow.flowId,callbackUrl:"http://localhost:8787/oauth2/callback?state="+new URL(flow.authorizationUrl).searchParams.get("state")+"&code=fixture-code"},current);
 const connectionId=(await service.snapshot("alex")).connections.find(row=>row.kind==="google")!.id;vaultReads=0;
 const server=createNativeCredentialConsumer({database,service,configuration}),socket=path.join(root,"consumer.sock");await listenNativeCredentialConsumer(server,socket);
 const client=new ConnectedGoogleClient(socket);let observed:any;
 const connected={readDefaultEmail(tool:string,args:unknown,context:any){observed=context;return client.readDefaultEmail(tool,args,context);},list(context:any){observed=context;return client.list(context);},read(id:string,tool:string,args:unknown,context:any){observed=context;return client.read(id,tool,args,context);}};
 const artifacts=new ArtifactStore({root:path.join(root,"artifacts")});await artifacts.initialize();
 const runtime=new HouseholdDomainRuntime({database,artifacts,configuration,connectedGoogle:connected,adapter:{getContext:async()=>({...native}),listMessages:async()=>[{id:"fixture-user",role:"user",text}]} as any});
 (runtime as any).runner.runJson=async()=>{legacyCalls++;throw Error("legacy_must_not_run");};
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
 return{root,database,sql,runtime,context,native,grant,client,connectionId,authorization,invoke,load,store,service,configuration,values,providerCalls,legacyCalls:()=>legacyCalls,observed:()=>observed,
  counts:()=>({vaultReads,refreshes,providerReads}),
  async close(){await runtime.close();service.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));database.close();await rm(root,{recursive:true,force:true});}};
}

const search={query:"AYSO newer_than:7d",limit:50};
const unchangedCounts={vaultReads:0,refreshes:0,providerReads:0};
test("ordinary Gmail search and read omit IDs and use the protected configured mailbox through real IPC",async()=>{
 const f=await fixture();try{
  f.configuration.google.account="  FIXTURE@EXAMPLE.INVALID  ";
  await f.load();
  const found=await f.invoke("household_email_search",search) as any;
  assert.equal(found.source,"connected_google");assert.equal(found.result.connectionId,f.connectionId);
  assert.equal(found.result.account,"fixture@example.invalid");
  const read=await f.invoke("household_email_read",{messageId:"fixture-message",format:"metadata"}) as any;
  assert.equal(read.result.connectionId,f.connectionId);
  assert.deepEqual(f.providerCalls,[{operation:"gmail.search",input:search},{operation:"gmail.get",input:{messageId:"fixture-message",format:"metadata"}}]);
  assert.equal(f.legacyCalls(),0);
  assert.doesNotMatch(JSON.stringify([found,read]),/fixture-access-secret|fixture-refresh-secret|fixture-rotated-secret|fixture-client-secret/);
  const discovery=await f.invoke("household_email_connections",{}) as any;
  assert.equal(discovery.connections[0].connectionId,discovery.connections[0].id);
 }finally{await f.close();}
});
test("another connected personal account does not replace the configured default and explicit selection remains available",async()=>{
 const f=await fixture();try{
  await f.load();const original=f.store.get("alex",f.connectionId)!;
  f.store.save({...original,id:"connection-other-personal",account:"personal@example.invalid",accountId:"personal-subject",secretId:"other-fixture-secret"});
  const grant=JSON.parse(f.values.get(original.secretId)!);
  f.values.set("other-fixture-secret",JSON.stringify({...grant,email:"personal@example.invalid",accountId:"personal-subject"}));
  const ordinary=await f.invoke("household_email_search",search) as any;
  assert.equal(ordinary.result.connectionId,f.connectionId);
  const explicit=await f.invoke("household_email_search",{...search,connectionId:"connection-other-personal"}) as any;
  assert.equal(explicit.result.connectionId,"connection-other-personal");assert.equal(explicit.result.account,"personal@example.invalid");assert.equal(f.legacyCalls(),0);
 }finally{await f.close();}
});
test("reconnection retains disconnected history without making a unique current default ambiguous",async()=>{
 const f=await fixture();try{
  await f.load();f.store.save({...f.store.get("alex",f.connectionId)!,id:"connection-retained-history",status:"disconnected"});
  const result=await f.invoke("household_email_search",search) as any;
  assert.equal(result.result.connectionId,f.connectionId);assert.equal(f.legacyCalls(),0);
 }finally{await f.close();}
});
test("multiple current binding IDs stay ambiguous while a refresh is unknown instead of switching defaults",async()=>{
 for(const status of ["connected","unknown","needs_reauthorization"] as const){
  const f=await fixture();try{
   await f.load();f.store.save({...f.store.get("alex",f.connectionId)!,id:"connection-duplicate-current",status});
   await assert.rejects(f.invoke("household_email_search",search),/google_default_mailbox_ambiguous/);
   assert.deepEqual(f.counts(),unchangedCounts);assert.equal(f.legacyCalls(),0);
  }finally{await f.close();}
 }
});
test("missing wrong-owner wrong-account wrong-preset and alias guesses never select another personal mailbox",async()=>{
 for(const patch of [
  {ownerProfileId:"natasha"},{account:"another@example.invalid"},{preset:"calendar_read"},
  {account:"fix.ture@example.invalid"},{account:"fixture+alias@example.invalid"},
 ]){
  const f=await fixture();try{
   await f.load();const original=f.store.get("alex",f.connectionId)!;
   f.sql.prepare("DELETE FROM credential_connections WHERE id=?").run(f.connectionId);
   f.store.save({...original,...patch,id:"connection-nonmatching"} as any);
   await assert.rejects(f.invoke("household_email_search",search),/google_default_mailbox_not_connected/);
   assert.deepEqual(f.counts(),unchangedCounts);assert.equal(f.legacyCalls(),0);
  }finally{await f.close();}
 }
 const f=await fixture();try{await f.load();f.sql.prepare("DELETE FROM credential_connections WHERE id=?").run(f.connectionId);
  await assert.rejects(f.invoke("household_email_search",search),/google_default_mailbox_not_connected/);assert.deepEqual(f.counts(),unchangedCounts);
 }finally{await f.close();}
});
test("disconnected uncertain reauthorization and missing-scope defaults stop before vault or providers",async()=>{
 for(const [patch,code]of [
  [{status:"disconnected"},"google_default_mailbox_unavailable"],
  [{status:"unknown"},"google_default_mailbox_unavailable"],
  [{status:"needs_reauthorization"},"google_default_mailbox_needs_reauthorization"],
  [{scopes:[]},"connection_operation_not_allowed"],
 ] as Array<[Record<string,unknown>,string]>){
  const f=await fixture();try{
   await f.load();f.store.save({...f.store.get("alex",f.connectionId)!,...patch} as any);
   await assert.rejects(f.invoke("household_email_search",search),new RegExp(code));assert.deepEqual(f.counts(),unchangedCounts);assert.equal(f.legacyCalls(),0);
  }finally{await f.close();}
 }
});
test("default IPC accepts only email operations and derives its account from protected configuration",async()=>{
 const f=await fixture();try{
  await f.load();await f.invoke("household_email_connections",{});const context=f.observed();
  await assert.rejects(f.client.readDefaultEmail("household_calendar_list",{from:"2026-11-25",to:"2026-11-26"},context),/connection_operation_not_allowed/);
  f.configuration.google.account="";await assert.rejects(f.client.readDefaultEmail("household_email_search",search,context),/google_default_mailbox_not_configured/);
  assert.deepEqual(f.counts(),unchangedCounts);assert.equal(f.legacyCalls(),0);
 }finally{await f.close();}
});
test("ordinary default requests preserve private audience source generation device grant and cancellation fences",async()=>{
 for(const patch of [
  (f:any)=>{f.context.sessionId="stale-sdk-session";},
  (f:any)=>{f.context.assertInvocationCurrent=()=>{throw Error("fixture-revoked");};},
  (f:any)=>f.sql.prepare("UPDATE devices SET status='revoked' WHERE id='fixture-device'").run(),
  (f:any)=>f.database.setProfileStatus("alex","paused","Fixture"),
  (f:any)=>{f.grant.enabled=false;},
  (f:any)=>f.database.submissions.failWithCode("fixture-source","fixture-run","operator_stop","cancelled"),
  (f:any)=>f.sql.prepare("UPDATE conversations SET audience='household' WHERE id='fixture-conversation'").run(),
 ]){
  const f=await fixture();try{
   await f.load();patch(f);await assert.rejects(f.invoke("household_email_search",search));assert.deepEqual(f.counts(),unchangedCounts);assert.equal(f.legacyCalls(),0);
  }finally{await f.close();}
 }
 const shared=await fixture(false,"household");try{await shared.load();await assert.rejects(shared.invoke("household_email_search",search),/private_connection_context_required/);assert.deepEqual(shared.counts(),unchangedCounts);assert.equal(shared.legacyCalls(),0);}finally{await shared.close();}
});
test("a connected-port failure never falls back to the legacy CLI",async()=>{
 let legacy=0;const current=()=>{};
 const context={profileId:"alex",agentId:"main",sessionKey:"fixture",conversationId:"fixture",audience:"private",allowedScopes:["personal"],authorizedAttendees:[],assertCurrent:current} as any;
 const config={gogBinary:"/fixture/gog",account:"fixture@example.invalid",client:"fixture",calendarId:"fixture",timeZone:"America/New_York"};
 const broken={list:async()=>({connections:[]}),read:async()=>{throw Error("unexpected_explicit");},readDefaultEmail:async()=>{throw Error("connected_google_unavailable");}};
 const domain=new GoogleDomain(config,{runJson:async()=>{legacy++;return{};}} as any,broken);
 await assert.rejects(domain.execute("household_email_search",search,context),/connected_google_unavailable/);
 assert.equal(legacy,0);
 const compatibility=new GoogleDomain(config,{runJson:async()=>{legacy++;return{messages:[]};}} as any);
 const result=await compatibility.execute("household_email_search",search,context) as any;
 assert.equal(result.source,"bot_gmail");assert.equal(legacy,1);
});

test("default consumer wire rejects caller account and connection-ID overrides before vault access",async()=>{
 const f=await fixture();try{
  await f.load();await f.invoke("household_email_connections",{});const authority=f.observed().credentialAuthority;
  for(const override of [{account:"different@example.invalid"},{connectionId:"connection-caller-override"}]){
   const value=await new Promise<{status:number;body:any}>((resolve,reject)=>{
    const body=JSON.stringify({action:"read_default_email",tool:"household_email_search",args:search,context:authority,...override});
    const request=httpRequest({socketPath:path.join(f.root,"consumer.sock"),method:"POST",path:"/google",headers:{"content-type":"application/json","content-length":Buffer.byteLength(body)}},response=>{
     const chunks:Buffer[]=[];response.on("data",chunk=>chunks.push(chunk));response.on("end",()=>resolve({status:response.statusCode!,body:JSON.parse(Buffer.concat(chunks).toString("utf8"))}));
    });request.on("error",reject);request.end(body);
   });
   assert.equal(value.status,400);assert.equal(value.body.error,"invalid_connection_request");
  }
  assert.deepEqual(f.counts(),unchangedCounts);assert.equal(f.legacyCalls(),0);
 }finally{await f.close();}
});
