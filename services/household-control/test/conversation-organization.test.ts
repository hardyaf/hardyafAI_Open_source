import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {randomUUID,createHash} from "node:crypto";
import {HouseholdDatabase} from "../src/database.ts";
import {SqliteHouseholdStore} from "../src/sqlite-household-store.ts";
import {MockHouseholdAgentAdapter} from "../src/mock-adapter.ts";
import {DeviceAuthenticator} from "../src/device-auth.ts";
import {createHouseholdServer} from "../src/server.ts";
import {NativeDomainAuthorization} from "../src/domain-runtime/native-scope.ts";
import {createNativeCredentialConsumer,listenNativeCredentialConsumer} from "../src/connections/native-consumer.ts";
import {ConnectedGoogleClient} from "../src/domain-runtime/connected-google.ts";

const folder=()=>"folder-"+randomUUID();
async function fixture(){
 const root=await mkdtemp(path.join(tmpdir(),"hardy-conversation-organization-")),filename=path.join(root,"household.sqlite");
 const database=new HouseholdDatabase(filename),adapter=new MockHouseholdAgentAdapter([]),store=new SqliteHouseholdStore(database,adapter,{dispatcherEnabled:false});
 const original=adapter.getContext.bind(adapter);let observe:any=original;
 adapter.getContext=async conversation=>observe(conversation);
 const server=createHouseholdServer({database,store,authenticator:new DeviceAuthenticator({developmentDevices:new Map([["fixture-alex","alex"],["fixture-natasha","natasha"]])})});
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));const base="http://127.0.0.1:"+(server.address() as any).port;
 async function request(url:string,method="GET",body?:unknown,actor="alex"){
  const response=await fetch(base+url,{method,headers:{"content-type":"application/json","x-device-id":"fixture-"+actor},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return{status:response.status,body:await response.json() as any};
 }
 const alex=database.getProfile("alex")!,natasha=database.getProfile("natasha")!;
 return{root,filename,database,sql:database.domainConnection(),adapter,store,request,alex,natasha,
  observe(fn:any){observe=fn;},original,
  async conversation(owner=alex,audience:"private"|"household"="private"){return store.createConversation(owner,"Fixture chat",null,audience);},
  async close(remove=true){await server.shutdown();if(remove)await rm(root,{recursive:true,force:true});}};
}
function enqueue(f:any,conversation:any,id="fixture-source"){
 return f.database.submissions.enqueue({submissionId:id,conversationId:conversation.id,profileId:"alex",agentId:"main",
  textHash:createHash("sha256").update("Fixture").digest("hex"),requestHash:"fixture-request",payload:{kind:"message",text:"Fixture"},originDeviceId:"fixture-device"});
}

test("signed profile folders are durable idempotent private placements without changing shared chat access",async()=>{
 const f=await fixture();let closed=false;try{
  const shared=await f.conversation(f.alex,"household"),privateChat=await f.conversation(),id=folder(),other=folder();
  assert.equal((await f.request("/v1/conversation-folders","POST",{folderId:id,name:"  Projects  "})).status,201);
  assert.equal((await f.request("/v1/conversation-folders","POST",{folderId:id,name:"Projects"})).status,200);
  assert.equal((await f.request("/v1/conversation-folders","POST",{folderId:id,name:"Different"})).status,409);
  assert.equal((await f.request("/v1/conversation-folders","GET",undefined,"natasha")).body.folders.length,0);
  assert.equal((await f.request("/v1/conversation-folders/"+id,"PUT",{name:"Stolen"},"natasha")).status,404);
  assert.equal((await f.request("/v1/conversation-folders/"+id,"DELETE",undefined,"natasha")).status,404);
  assert.equal((await f.request("/v1/conversations/"+shared.id+"/folder","PUT",{folderId:id},"natasha")).status,404);
  await f.request("/v1/conversation-folders","POST",{folderId:other,name:"Personal"},"natasha");
  assert.equal((await f.request("/v1/conversations/"+privateChat.id+"/folder","PUT",{folderId:other},"natasha")).status,404);
  assert.equal((await f.request("/v1/conversations/"+shared.id+"/folder","PUT",{folderId:id})).status,200);
  assert.equal((await f.request("/v1/conversations/"+shared.id+"/folder","PUT",{folderId:other},"natasha")).status,200);
  assert.equal(f.store.getConversation(f.alex,shared.id)?.folderId,id);assert.equal(f.store.getConversation(f.natasha,shared.id)?.folderId,other);
  assert.equal(f.database.getConversation(shared.id)?.audience,"household");
  await f.request("/v1/conversation-folders/"+other,"DELETE",undefined,"natasha");
  assert.equal(f.store.getConversation(f.natasha,shared.id)?.folderId,null);assert.equal(f.store.getConversation(f.alex,shared.id)?.folderId,id);
  assert.equal((await f.request("/v1/conversation-folders/"+other,"DELETE",undefined,"natasha")).status,200);
  assert.equal((await f.request("/v1/conversation-folders","POST",{folderId:other,name:"Personal"},"natasha")).status,409);
  await f.request("/v1/conversation-folders/"+id,"PUT",{name:"Renamed"});
  await f.close(false);closed=true;
  const reopened=new HouseholdDatabase(f.filename),reopenedStore=new SqliteHouseholdStore(reopened,new MockHouseholdAgentAdapter([]),{dispatcherEnabled:false});
  try{assert.equal(reopenedStore.listConversationFolders(f.alex)[0].name,"Renamed");assert.equal(reopenedStore.getConversation(f.alex,shared.id)?.folderId,id);assert.equal(reopenedStore.getConversation(f.natasha,shared.id)?.folderId,null);}
  finally{await reopenedStore.close();}
 }finally{if(!closed)await f.close(false);await rm(f.root,{recursive:true,force:true});}
});
test("inline title-only rename preserves current tags and existing explicit tag edits remain compatible",async()=>{
 const f=await fixture();try{
  const conversation=await f.conversation(),folderId=folder();f.store.createConversationFolder(f.alex,folderId,"Fixture");
  f.store.moveConversationToFolder(f.alex,conversation.id,folderId);f.store.updateConversationMetadata(f.alex,conversation.id,"Initial",["fresh","other"]);
  const renamed=await f.request("/v1/conversations/"+conversation.id+"/metadata","PUT",{title:"Inline rename"});
  assert.equal(renamed.status,200);assert.deepEqual(renamed.body.conversation.tags,["fresh","other"]);assert.equal(renamed.body.conversation.folderId,folderId);
  const changed=await f.request("/v1/conversations/"+conversation.id+"/metadata","PUT",{title:"Updated",tags:["next"]});
  assert.deepEqual(changed.body.conversation.tags,["next"]);
  assert.equal((await f.request("/v1/conversations/"+conversation.id+"/metadata","PUT",{title:"Invalid",tags:null})).status,400);
 }finally{await f.close();}
});
test("conversation removal is owner-only idempotent and retains history audit and native session identity",async()=>{
 const f=await fixture();try{
  const conversation=await f.conversation(f.alex,"household");
  f.sql.prepare("INSERT INTO devices(id,profile_id,display_name,public_key_der_base64,status,enrolled_at) VALUES('fixture-device','alex','Fixture','unused','active',?)").run(new Date().toISOString());
  enqueue(f,conversation);f.sql.prepare("UPDATE submissions SET status='complete',run_id='fixture-run' WHERE id='fixture-source'").run();
  assert.equal((await f.request("/v1/conversations/"+conversation.id,"DELETE",undefined,"natasha")).status,404);
  const result=await f.request("/v1/conversations/"+conversation.id,"DELETE");assert.equal(result.status,200);assert.deepEqual(result.body,{deleted:true,retained:true});
  assert.equal((await f.request("/v1/conversations/"+conversation.id,"DELETE")).status,200);
  assert.ok(f.database.getConversation(conversation.id)?.deletedAt);assert.equal(f.database.getConversation(conversation.id)?.sessionKey,conversation.sessionKey);
  assert.equal(f.database.submissions.get("fixture-source")?.receipt.status,"complete");
  assert.equal(f.store.getConversation(f.alex,conversation.id),undefined);assert.equal(f.store.getConversation(f.natasha,conversation.id),undefined);
  assert.equal(f.store.findBySessionKey(conversation.sessionKey),undefined);
  assert.equal((await f.request("/v1/conversations/"+conversation.id+"/messages")).status,404);
  assert.equal((await f.request("/v1/conversations/"+conversation.id+"/messages","POST",{submissionId:"new-deleted-source",text:"Blocked"})).status,404);
  assert.throws(()=>enqueue(f,conversation,"raw-deleted-source"),/conversation_deleted/);
  assert.throws(()=>(f.store as any).enqueue(f.alex,conversation,"cached-deleted-source",{kind:"message",text:"Blocked"}),/conversation_not_found/);
 }finally{await f.close();}
});
test("delete fails closed for active queued waiting uncertain or live native work, while stopped idle goals can be removed",async()=>{
 const f=await fixture();try{
  for(const status of ["queued","dispatching","running","waiting_for_user"]){
   const conversation=await f.conversation();enqueue(f,conversation,"fixture-"+status);
   f.sql.prepare("UPDATE submissions SET status=? WHERE id=?").run(status,"fixture-"+status);
   const result=await f.request("/v1/conversations/"+conversation.id,"DELETE");assert.equal(result.status,409);assert.equal(result.body.error,"conversation_active");
  }
  const uncertain=await f.conversation();enqueue(f,uncertain,"fixture-unknown");
  f.sql.prepare("UPDATE submissions SET status='failed',recovery_required=1 WHERE id='fixture-unknown'").run();
  assert.equal((await f.request("/v1/conversations/"+uncertain.id,"DELETE")).status,409);
  const native=await f.conversation();f.observe(async(c:any)=>({...await f.original(c),goal:{id:"goal",status:"active",objective:"Fixture",updatedAt:Date.now()}}));
  assert.equal((await f.request("/v1/conversations/"+native.id,"DELETE")).status,409);
  f.observe(async(c:any)=>({...await f.original(c),goal:null,continuationPending:true}));
  assert.equal((await f.request("/v1/conversations/"+native.id,"DELETE")).status,409);
  f.observe(async()=>{throw Error("private provider diagnostic");});
  const failed=await f.request("/v1/conversations/"+native.id,"DELETE");assert.equal(failed.status,503);assert.deepEqual(failed.body,{error:"conversation_state_unavailable"});
  f.observe(async(c:any)=>({...await f.original(c),goal:{id:"stopped-goal",status:"paused",objective:"Fixture",updatedAt:Date.now()},continuationPending:false}));
  assert.equal((await f.request("/v1/conversations/"+native.id,"DELETE")).status,200);
 }finally{await f.close();}
});
test("a source admitted during native deletion inspection prevents the atomic tombstone",async()=>{
 const f=await fixture();try{
  const conversation=await f.conversation();let enter!:()=>void,release!:()=>void;
  const entered=new Promise<void>(resolve=>enter=resolve),hold=new Promise<void>(resolve=>release=resolve);
  f.observe(async(c:any)=>{enter();await hold;return f.original(c);});
  const removal=f.store.deleteConversation(f.alex,conversation.id);await entered;
  const admitted=await f.store.submitMessage({profile:f.alex,conversationId:conversation.id,submissionId:"racing-source",text:"Fixture"});
  assert.equal(admitted?.status,"queued");release();
  await assert.rejects(removal,/conversation_active/);assert.equal(f.database.getConversation(conversation.id)?.deletedAt,null);
 }finally{await f.close();}
});
test("tombstones invalidate existing native scopes catalogs and credential receiver before any private provider call",async()=>{
 const f=await fixture();let consumer:any;try{
  const conversation=await f.conversation();
  f.sql.prepare("INSERT INTO devices(id,profile_id,display_name,public_key_der_base64,status,enrolled_at) VALUES('fixture-device','alex','Fixture','unused','active',?)").run(new Date().toISOString());
  enqueue(f,conversation);const claim=f.database.submissions.claimNext(2,120000)!;f.database.submissions.accepted("fixture-source",claim.leaseToken!,{...claim.receipt,status:"running",runId:"fixture-run"});
  const grant={enabled:true,domains:["email"],scopes:["personal"],contactEditing:false,projectCodes:[],canManageProjects:false,canReviewReceipts:false,allowedAttendees:[],sharedDomains:[]};
  const authorization=new NativeDomainAuthorization(f.database,{alex:grant} as any);
  const authority={agentId:"main",sessionKey:conversation.sessionKey,sessionId:"fixture-session",nativeSessionId:"fixture-session",runId:"fixture-run",assertInvocationCurrent(){}};
  const scope=authorization.resolve(authority);scope.principal.assertCurrent();assert.ok(authorization.catalogGrant(authority));
  let privateCalls=0;
  consumer=createNativeCredentialConsumer({database:f.database,configuration:{profiles:{alex:grant},execution:{nativeEntries:[]}} as any,
   service:{assertSecure(){},async snapshot(){privateCalls++;return{connections:[]};},async readGoogle(){privateCalls++;throw Error("must not read");}} as any});
  const socket=path.join(f.root,"credentials.sock");await listenNativeCredentialConsumer(consumer,socket);
  const client=new ConnectedGoogleClient(socket),context={profileId:"alex",agentId:"main",sessionKey:conversation.sessionKey,conversationId:conversation.id,audience:"private",allowedScopes:["personal"],authorizedAttendees:[],credentialAuthority:{...authority},assertCurrent(){}} as any;
  delete context.credentialAuthority.assertInvocationCurrent;
  await client.list(context);assert.equal(privateCalls,1);
  // Simulate independent canonical revocation to prove already-captured scopes
  // cannot retain authority even if the normal active-delete guard is bypassed.
  f.sql.prepare("UPDATE conversations SET deleted_at=? WHERE id=?").run(new Date().toISOString(),conversation.id);
  assert.throws(()=>scope.principal.assertCurrent(),/domain_authority_revoked/);assert.equal(authorization.catalogGrant(authority),null);
  assert.throws(()=>authorization.resolve(authority),/native_conversation_not_authorized/);
  await assert.rejects(client.list(context),/native_conversation_not_authorized/);assert.equal(privateCalls,1);
 }finally{if(consumer){consumer.closeAllConnections();await new Promise<void>(resolve=>consumer.close(()=>resolve()));}await f.close();}
});
test("schema7 migration adds empty folder placement and tombstones without rewriting existing chat metadata",async()=>{
 const root=await mkdtemp(path.join(tmpdir(),"hardy-conversation-migration-")),filename=path.join(root,"household.sqlite");
 let database=new HouseholdDatabase(filename);try{
  database.insertConversation({id:"legacy-chat",ownerProfileId:"alex",agentId:"main",sessionKey:"hardy-home:legacy",title:"Retained title",tags:[],presetId:null,audience:"private",updatedAt:"2026-11-01T00:00:00Z"});
  const sql=database.domainConnection();sql.prepare("UPDATE conversations SET tags_json=? WHERE id='legacy-chat'").run(JSON.stringify(["kept"]));
  sql.exec("DROP TRIGGER submissions_reject_deleted_conversation; DROP TABLE conversation_folder_placements; DROP TABLE conversation_folders; ALTER TABLE conversations DROP COLUMN deleted_at; DELETE FROM schema_migrations WHERE version=8;");
  database.close();database=new HouseholdDatabase(filename);
  assert.equal(database.schemaVersion,8);const conversation=database.listConversations("alex").find(row=>row.id==="legacy-chat")!;
  assert.equal(conversation.title,"Retained title");assert.deepEqual(conversation.tags,["kept"]);assert.equal(conversation.folderId,null);assert.equal(conversation.deletedAt,null);
 }finally{database.close();await rm(root,{recursive:true,force:true});}
});

test("in-flight app message and context reads are fenced when the idle conversation is removed",async()=>{
 for(const kind of ["messages","context"]){
  const f=await fixture();try{
   const conversation=await f.conversation();let enter!:()=>void,release!:()=>void,calls=0;
   const entered=new Promise<void>(resolve=>enter=resolve),hold=new Promise<void>(resolve=>release=resolve);
   if(kind==="messages")f.adapter.listMessages=async()=>{enter();await hold;return[{id:"retained-message",conversationId:conversation.id,role:"user",text:"retained-private-text",createdAt:new Date().toISOString()}];};
   else f.observe(async(c:any)=>{if(++calls===1){enter();await hold;}return f.original(c);});
   const pending=kind==="messages"?f.store.listMessages(f.alex,conversation.id):f.store.getContext(f.alex,conversation.id);
   await entered;assert.equal(await f.store.deleteConversation(f.alex,conversation.id),true);release();
   assert.equal(await pending,undefined);
  }finally{await f.close();}
 }
});
test("native deletion inspection rechecks current device and profile authority after awaiting",async()=>{
 for(const revoke of [
  (f:any)=>f.sql.prepare("UPDATE devices SET status='revoked' WHERE id='fixture-device'").run(),
  (f:any)=>f.sql.prepare("UPDATE profiles SET capabilities_json='[]' WHERE id='alex'").run(),
 ]){
  const f=await fixture();try{
   const conversation=await f.conversation();f.sql.prepare("INSERT INTO devices(id,profile_id,display_name,public_key_der_base64,status,enrolled_at) VALUES('fixture-device','alex','Fixture','unused','active',?)").run(new Date().toISOString());
   let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(resolve=>enter=resolve),hold=new Promise<void>(resolve=>release=resolve);
   f.observe(async(c:any)=>{enter();await hold;return f.original(c);});
   const pending=f.store.deleteConversation(f.alex,conversation.id,"fixture-device");await entered;revoke(f);release();
   await assert.rejects(pending,/conversation_not_allowed/);assert.equal(f.database.getConversation(conversation.id)?.deletedAt,null);
  }finally{await f.close();}
 }
});
