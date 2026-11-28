import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {request} from "node:http";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {googleMessageReadInput} from "../src/domains/google/message-read.ts";
import {projectGoogleMessage} from "../src/connections/google-message.ts";
import {createGoogleProvider} from "../src/connections/google.ts";
import {GoogleDomain,googleTools} from "../src/domains/google/index.ts";
import {HouseholdDatabase} from "../src/database.ts";
import {ConnectionsService} from "../src/connections/service.ts";
import {ConnectionRepository} from "../src/connections/repository.ts";
import {createNativeCredentialConsumer,listenNativeCredentialConsumer} from "../src/connections/native-consumer.ts";
import {ConnectedGoogleClient} from "../src/domain-runtime/connected-google.ts";
import type {ConnectionRecord,ConnectionVault,GoogleProvider} from "../src/connections/contracts.ts";

const scope="a".repeat(64);
function message(text:string):any{return{id:"fixture-message",threadId:"fixture-thread",snippet:"Fixture snippet",internalDate:"123",
 payload:{mimeType:"multipart/mixed",headers:[{name:"Subject",value:"Fixture subject"}],parts:[{mimeType:"text/plain",body:{data:Buffer.from(text).toString("base64url")}}]}};}
function project(value:unknown,input:unknown,selectedScope=scope){return projectGoogleMessage(value,googleMessageReadInput(input),selectedScope);}

test("Unicode code-point windows reconstruct one stable projection and preserve short full-read compatibility",()=>{
 const text="A😀e\u0301漢字🚀Z",value=message(text);
 const full=project(value,{messageId:"fixture-message"});
 assert.equal(full.body,text);assert.equal(full.bodySource,"text/plain");assert.equal(full.bodyTruncated,false);assert.equal(full.bodyComplete,true);assert.equal(full.bodyWindow.complete,true);
 let offset=0,version:string|undefined,joined="",last:any;
 do{last=project(value,{messageId:"fixture-message",bodyWindow:{offset,maxChars:2,...(version?{version}:{})}});
  assert.equal(Array.from(last.body).length,Math.min(2,Array.from(text).length-offset));
  assert.doesNotMatch(last.body,/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  if(version)assert.equal(last.bodyWindow.version,version);version=last.bodyWindow.version;joined+=last.body;offset=last.bodyWindow.nextOffset;
 }while(offset!==null);
 assert.equal(joined,text);assert.equal(last.bodyWindow.complete,true);assert.equal(last.bodyComplete,false);assert.equal(last.bodyWindow.totalChars,Array.from(text).length);
});
test("continuations bind message identity projected content and trusted connection scope",()=>{
 const value=message("First body section then the remainder"),first=project(value,{messageId:"fixture-message",bodyWindow:{maxChars:5}});
 const next={messageId:"fixture-message",bodyWindow:{offset:first.bodyWindow.nextOffset!,maxChars:8,version:first.bodyWindow.version}};
 assert.equal(project(value,next).body," body se");
 for(const changed of [message("Changed body"),{...value,threadId:"changed-thread"},{...value,payload:{...value.payload,headers:[{name:"Subject",value:"Changed subject"}]}}])
  assert.throws(()=>project(changed,next),/google_message_version_changed/);
 assert.throws(()=>project(value,next,"b".repeat(64)),/google_message_version_changed/);
 assert.throws(()=>project({...value,id:"different-message"},{...next,messageId:"different-message"}),/google_message_version_changed/);
 assert.throws(()=>project({...value,id:"wrong-message"},next),/google_message_identity_mismatch/);
 assert.throws(()=>project(value,{messageId:"fixture-message",bodyWindow:{offset:1000,maxChars:2,version:first.bodyWindow.version}}),/google_message_window_out_of_range/);
});
test("full bodies have no implicit 60000-character window",()=>{
 const value=message("😀".repeat(60_005)),first=project(value,{messageId:"fixture-message"});
 assert.equal(Array.from(first.body).length,60_005);assert.equal(first.bodyTruncated,false);assert.equal(first.bodyWindow.nextOffset,null);assert.equal(first.bodyWindow.complete,true);
 const tail=project(value,{messageId:"fixture-message",bodyWindow:{offset:60_000,maxChars:10,version:first.bodyWindow.version}});
 assert.equal(tail.body,"😀".repeat(5));assert.equal(tail.bodyWindow.nextOffset,null);assert.equal(tail.bodyWindow.complete,true);assert.equal(tail.bodyComplete,false);
});
test("MIME omissions are explicit and unavailable projection ends never claim completeness or loop",()=>{
 const value=message("Visible plain body");
 value.payload.parts.push({mimeType:"text/html",body:{data:Buffer.from("<script>hidden-html</script>").toString("base64url")}},{mimeType:"text/plain",filename:"private.txt",body:{data:Buffer.from("hidden-attachment").toString("base64url"),attachmentId:"hidden-id"}});
 const full=project(value,{messageId:"fixture-message"});
 assert.equal(full.body,"Visible plain body");assert.equal(full.bodyComplete,true);assert.equal(full.attachments.length,1);assert.equal(full.attachments[0].attachmentId,"hidden-id");
 assert.doesNotMatch(JSON.stringify(full),/hidden-html|hidden-attachment|payload/);
 for(const fixture of [
  {...value,payload:{parts:[{mimeType:"text/html",body:{data:"abc"}}]}},
  {...value,payload:{mimeType:"text/plain",body:{data:"a"}}},
  {...value,payload:{mimeType:"text/plain",body:{data:Buffer.from([0xff]).toString("base64url")}}},
 ]){
  const result=project(fixture,{messageId:"fixture-message"});
  assert.equal(result.bodyWindow.complete,false);assert.equal(result.bodyComplete,false);assert.equal(result.bodyWindow.nextOffset,null);assert.ok(result.omissions.length);
 }
 let deep:any={mimeType:"text/plain",body:{data:Buffer.from("deep body").toString("base64url")}};
 for(let i=0;i<40;i++)deep={parts:[deep]};
 assert.equal(project({...value,payload:deep},{messageId:"fixture-message"}).body,"deep body");
 const many={parts:Array.from({length:150},(_,i)=>({mimeType:"text/plain",body:{data:Buffer.from(String(i)).toString("base64url")}}))};
 assert.match(project({...value,payload:many},{messageId:"fixture-message"}).body,/149$/);
});
test("closed window validation rejects inconsistent offsets bounds format and caller scope overrides",()=>{
 const invalid=[
  {bodyWindow:{}},{bodyWindow:{maxChars:0}},{bodyWindow:{maxChars:1.5}},
  {bodyWindow:{offset:null,maxChars:1}},{bodyWindow:{offset:-1,maxChars:1}},{bodyWindow:{offset:1,maxChars:1}},
  {bodyWindow:{offset:0,maxChars:1,version:"untrusted"}},{bodyWindow:{offset:Number.MAX_SAFE_INTEGER+1,maxChars:1,version:"sha256-v1:"+"a".repeat(64)}},
  {bodyWindow:{maxChars:2,scope:"forged"}},{bodyWindow:{maxChars:2},format:"metadata"},{messageScope:scope},
 ];
 for(const input of invalid)assert.throws(()=>googleMessageReadInput({messageId:"fixture-message",...input}),/invalid_google_read/);
 const read=googleTools.find(x=>x.name==="household_email_read")!;
 assert.ok(JSON.stringify(read).includes("bodyWindow"));assert.ok(JSON.stringify(read).includes("Unicode code points"));
});
test("provider never forwards window offsets or fingerprints to Gmail and requires trusted scope before fetch",async()=>{
 const provider=await createGoogleProvider(),previous=globalThis.fetch;let calls=0;const value=message("Provider body");
 globalThis.fetch=async(url,options)=>{calls++;const parsed=new URL(String(url));assert.equal(parsed.origin,"https://gmail.googleapis.com");assert.equal(parsed.search,"?format=full");assert.equal((options?.headers as any).authorization,"Bearer fixture-access");return new Response(JSON.stringify(value));};
 try{
  await assert.rejects(provider.read("fixture-access","gmail.get",{messageId:"fixture-message",bodyWindow:{maxChars:3}}),/google_message_scope_required/);assert.equal(calls,0);
  const result=await provider.read("fixture-access","gmail.get",{messageId:"fixture-message",bodyWindow:{maxChars:3}},{messageScope:scope}) as any;
  assert.equal(result.body,"Pro");assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(result),new RegExp(scope));
  await assert.rejects(provider.read("fixture-access","gmail.get",{messageId:"fixture-message",bodyWindow:{offset:3,maxChars:2}},{messageScope:scope}),/invalid_google_read/);assert.equal(calls,1);
 }finally{globalThis.fetch=previous;}
});
test("provider transport supports valid message content beyond the former two-megabyte ceiling",async()=>{
 const provider=await createGoogleProvider(),previous=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify(message("x".repeat(2_100_000))));
 try{const value=await provider.read("fixture-access","gmail.get",{messageId:"fixture-message"},{messageScope:scope}) as any;assert.equal(value.body.length,2_100_000);assert.equal(value.bodyComplete,true);}
 finally{globalThis.fetch=previous;}
});

async function fixture(){
 const root=await mkdtemp(path.join(tmpdir(),"hardy-message-window-")),database=new HouseholdDatabase(":memory:"),sql=database.domainConnection();
 database.setProfileStatus("alex","available","Fixture");
 sql.prepare("INSERT INTO devices(id,profile_id,display_name,public_key_der_base64,status,enrolled_at) VALUES ('fixture-device','alex','Fixture','unused','active',?)").run(new Date().toISOString());
 const conv={id:"fixture-conversation",ownerProfileId:"alex",agentId:"main",sessionKey:"hardy-home:fixture",title:"Fixture",presetId:null,audience:"private" as const,updatedAt:new Date().toISOString()};
 database.insertConversation(conv);database.submissions.enqueue({submissionId:"fixture-source",conversationId:conv.id,profileId:"alex",agentId:"main",textHash:createHash("sha256").update("Read fixture").digest("hex"),requestHash:"fixture-request",payload:{kind:"message",text:"Read fixture"},originDeviceId:"fixture-device"});
 const claim=database.submissions.claimNext(2,120000)!;database.submissions.accepted(claim.receipt.submissionId,claim.leaseToken!,{...claim.receipt,status:"running",runId:"fixture-run"});
 const values=new Map<string,string>(),counts={vault:0,refresh:0,fetch:0,legacy:0},store=new ConnectionRepository(sql);
 const vault:ConnectionVault={configured:async()=>true,bootstrap:async()=>{},put:async()=>{throw Error("unused");},read:async id=>{counts.vault++;return values.get(id)!;},replace:async()=>{throw Error("unused");}};
 const real=await createGoogleProvider(),provider:GoogleProvider={...real,refresh:async()=>{counts.refresh++;return{accessToken:"fixture-access"};}};
 const service=new ConnectionsService({store,vault,google:provider,securityReady:()=>true});
 const stamp=new Date().toISOString(),clientId="fixture.apps.googleusercontent.com";
 store.save({id:"fixture-client",ownerProfileId:"alex",label:"Fixture client",kind:"google_client",scopes:[],secretId:"client-secret",status:"connected",createdAt:stamp,updatedAt:stamp});
 values.set("client-secret",JSON.stringify({clientId,clientSecret:"fixture-client",redirectUri:"http://localhost:8787/oauth2/callback"}));
 const record:ConnectionRecord={id:"connection-fixture",ownerProfileId:"alex",label:"Fixture",kind:"google",account:"fixture@example.invalid",accountId:"fixture-account",preset:"gmail_read",scopes:["https://www.googleapis.com/auth/gmail.readonly"],secretId:"grant-secret",status:"connected",createdAt:stamp,updatedAt:stamp};
 store.save(record);values.set("grant-secret",JSON.stringify({type:"google_oauth_v1",email:record.account,accountId:record.accountId,clientId,clientSecretId:"client-secret",refreshToken:"fixture-refresh"}));
 const grant={enabled:true,domains:["email"],scopes:["personal"],contactEditing:false,projectCodes:[],canManageProjects:false,canReviewReceipts:false,allowedAttendees:[],sharedDomains:[]};
 const configuration={profiles:{alex:grant},google:{account:record.account},execution:{nativeEntries:[]}};
 const server=createNativeCredentialConsumer({database,service,configuration:configuration as any}),socket=path.join(root,"consumer.sock");await listenNativeCredentialConsumer(server,socket);
 const client=new ConnectedGoogleClient(socket),context={profileId:"alex",agentId:"main",conversationId:conv.id,sessionKey:conv.sessionKey,audience:"private",allowedScopes:["personal"],authorizedAttendees:[],
  credentialAuthority:{agentId:"main",sessionKey:conv.sessionKey,sessionId:"fixture-session",nativeSessionId:"fixture-session",runId:"fixture-run"},assertCurrent(){}} as any;
 const domain=new GoogleDomain({gogBinary:"/fixture/gog",account:record.account!,client:"fixture",calendarId:"primary",timeZone:"America/New_York"},{runJson:async()=>{counts.legacy++;throw Error("legacy_must_not_run");}},client);
 let value=message("Windowed private fixture content"),release:(()=>void)|undefined,entered:(()=>void)|undefined,hold:Promise<void>|undefined;
 const oldFetch=globalThis.fetch;
 globalThis.fetch=async()=>{counts.fetch++;entered?.();if(hold)await hold;return new Response(JSON.stringify(value));};
 return{root,database,sql,service,store,record,values,client,context,domain,socket,counts,grant,
  setMessage(v:any){value=v;},
  hold(){hold=new Promise<void>(resolve=>{release=resolve;});return new Promise<void>(resolve=>{entered=resolve;});},release(){release?.();},
  async close(){release?.();globalThis.fetch=oldFetch;service.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));database.close();await rm(root,{recursive:true,force:true});}};
}
async function rawIPC(socket:string,body:unknown){return new Promise<{status:number;value:any}>((resolve,reject)=>{
 const data=JSON.stringify(body),r=request({socketPath:socket,method:"POST",path:"/google",headers:{"content-type":"application/json","content-length":Buffer.byteLength(data)}},res=>{
 const chunks:Buffer[]=[];res.on("data",c=>chunks.push(c));res.on("end",()=>resolve({status:res.statusCode!,value:JSON.parse(Buffer.concat(chunks).toString("utf8"))}));});r.on("error",reject);r.end(data);});}

test("real domain IPC service provider windows preserve default selection and reject changed account binding",async()=>{
 const f=await fixture();try{
  const first=await f.domain.execute("household_email_read",{messageId:"fixture-message",bodyWindow:{maxChars:8}},f.context) as any;
  const body=first.result.result;assert.equal(first.source,"connected_google");assert.equal(first.result.connectionId,f.record.id);assert.equal(body.body,"Windowed");
  const next={messageId:"fixture-message",bodyWindow:{offset:body.bodyWindow.nextOffset,maxChars:8,version:body.bodyWindow.version}};
  const second=await f.domain.execute("household_email_read",next,f.context) as any;assert.equal(second.result.result.body," private");assert.equal(f.counts.legacy,0);
  const other={...f.record,id:"connection-other",account:"other@example.invalid",accountId:"other-account",secretId:"other-secret"};f.store.save(other);
  f.values.set(other.secretId,JSON.stringify({...JSON.parse(f.values.get(f.record.secretId)!),email:other.account,accountId:other.accountId}));
  await assert.rejects(f.domain.execute("household_email_read",{...next,connectionId:other.id},f.context),/google_message_version_changed/);
  const changed=message("Changed private content");f.setMessage(changed);
  await assert.rejects(f.domain.execute("household_email_read",next,f.context),/google_message_version_changed/);
  assert.equal(f.counts.legacy,0);assert.doesNotMatch(JSON.stringify([first,second]),/fixture-access|fixture-refresh|client-secret|grant-secret/);
 }finally{await f.close();}
});
test("malformed windows fail at domain client raw IPC service and provider before token or provider calls",async()=>{
 const f=await fixture();try{
  const bad={messageId:"fixture-message",bodyWindow:{offset:4,maxChars:2}};
  await assert.rejects(f.domain.execute("household_email_read",bad,f.context),/invalid_google_read/);
  await assert.rejects(async()=>f.client.read(f.record.id,"household_email_read",bad,f.context),/invalid_google_read/);
  const wire=await rawIPC(f.socket,{action:"read_default_email",tool:"household_email_read",args:bad,context:f.context.credentialAuthority});
  assert.equal(wire.status,400);assert.equal(wire.value.error,"invalid_google_read");
  await assert.rejects(f.service.readGoogle("alex",f.record.id,"gmail.get",bad,()=>{}),/invalid_google_read/);
  assert.deepEqual(f.counts,{vault:0,refresh:0,fetch:0,legacy:0});
  const forged=await rawIPC(f.socket,{action:"read",connectionId:f.record.id,tool:"household_email_read",args:{messageId:"fixture-message",bodyWindow:{maxChars:2},messageScope:scope},context:f.context.credentialAuthority});
  assert.equal(forged.status,400);assert.deepEqual(f.counts,{vault:0,refresh:0,fetch:0,legacy:0});
 }finally{await f.close();}
});
test("continuations retain live generation device grant private-audience and post-await revocation fences",async()=>{
 for(const revoke of [
  (f:any)=>{f.context.credentialAuthority.runId="unrelated-run";},
  (f:any)=>{f.sql.prepare("UPDATE devices SET status='revoked' WHERE id='fixture-device'").run();},
  (f:any)=>{f.grant.enabled=false;},
  (f:any)=>{f.sql.prepare("UPDATE conversations SET audience='household' WHERE id='fixture-conversation'").run();},
 ]){
  const f=await fixture();try{
   const first=await f.domain.execute("household_email_read",{messageId:"fixture-message",bodyWindow:{maxChars:3}},f.context) as any;
   const before={...f.counts};revoke(f);
   await assert.rejects(f.domain.execute("household_email_read",{messageId:"fixture-message",bodyWindow:{offset:3,maxChars:3,version:first.result.result.bodyWindow.version}},f.context));
   assert.deepEqual(f.counts,before);
  }finally{await f.close();}
 }
 const f=await fixture();try{
  const entered=f.hold(),pending=f.domain.execute("household_email_read",{messageId:"fixture-message",bodyWindow:{maxChars:3}},f.context);
  await entered;f.sql.prepare("UPDATE devices SET status='revoked' WHERE id='fixture-device'").run();f.release();
  await assert.rejects(pending,error=>{assert.doesNotMatch(String(error),/Windowed private fixture content/);return/domain_authority_revoked/.test(String(error));});
 }finally{await f.close();}
});
test("legacy-only compatibility never silently ignores a requested body window",async()=>{
 let calls=0;const domain=new GoogleDomain({gogBinary:"/fixture/gog",account:"fixture@example.invalid",client:"fixture",calendarId:"primary",timeZone:"America/New_York"},{runJson:async()=>{calls++;return{};}});
 const context={assertCurrent(){}} as any;
 await assert.rejects(domain.execute("household_email_read",{messageId:"fixture-message",bodyWindow:{maxChars:2}},context),/connected_google_window_unavailable/);assert.equal(calls,0);
});
