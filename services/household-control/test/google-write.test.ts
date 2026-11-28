import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {ConnectionsService} from '../src/connections/service.ts';
import {ConnectionsError,presets} from '../src/connections/contracts.ts';
import type {ConnectionRecord,GoogleAuthorization,GoogleProvider} from '../src/connections/contracts.ts';
import {createGoogleProvider} from '../src/connections/google.ts';
import {googleWriteInput} from '../src/domains/google/write-input.ts';

for(const [operation,input,method,path,reply] of [
 ['gmail.draft.save',{draftId:'draft_a',subject:'Updated draft'},'PUT','/drafts/draft_a',{id:'draft_a',message:{id:'message_a'}}],
 ['gmail.draft.send',{draftId:'draft_a'},'POST','/drafts/send',{id:'message_a'}],
 ['gmail.draft.delete',{draftId:'draft_a'},'DELETE','/drafts/draft_a',null],
 ['gmail.label.save',{name:'Fixture label'},'POST','/labels',{id:'Label_a',name:'Fixture label'}],
 ['gmail.label.save',{labelId:'Label_a',name:'Renamed'},'PATCH','/labels/Label_a',{id:'Label_a',name:'Renamed'}],
 ['gmail.label.delete',{labelId:'Label_a'},'DELETE','/labels/Label_a',null],
 ['gmail.trash',{resourceId:'thread_a',kind:'thread'},'POST','/threads/thread_a/trash',{id:'thread_a'}],
 ['gmail.trash',{resourceId:'message_a',restore:true},'POST','/messages/message_a/untrash',{id:'message_a'}],
] as const)test('fixed provider route and committed receipt: '+operation+' '+path,async()=>{
 const provider=await createGoogleProvider(),prior=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url,options)=>{calls++;assert.equal(new URL(String(url)).origin,'https://gmail.googleapis.com');assert.ok(new URL(String(url)).pathname.endsWith(path));assert.equal(options?.method,method);return reply?new Response(JSON.stringify(reply)):new Response(null,{status:204});};
 try{const result:any=await provider.write!('synthetic-token',operation,{...input,operationId:'route-fixture-001'},{from:'owner@example.invalid',operationKey:'a'.repeat(64)});assert.equal(result.state,'committed');assert.equal(calls,1);}finally{globalThis.fetch=prior;}
});

test('recurring Calendar edits select one occurrence and preserve its current revision',async()=>{
 const provider=await createGoogleProvider(),prior=globalThis.fetch,calls:Array<{url:URL;method:string}>=[];
 globalThis.fetch=async(url,options)=>{const u=new URL(String(url));calls.push({url:u,method:String(options?.method)});
  if(calls.length===1)return new Response(JSON.stringify({id:'series_a',recurrence:['RRULE:FREQ=WEEKLY']}));
  if(calls.length===2){assert.equal(u.searchParams.get('originalStart'),'2026-12-01T12:00:00Z');return new Response(JSON.stringify({items:[{id:'instance_a',etag:'"revision-a"',originalStartTime:{dateTime:'2026-12-01T12:00:00Z'}}]}));}
  assert.ok(u.pathname.endsWith('/instance_a'));assert.equal((options?.headers as any)['if-match'],'"revision-a"');return new Response(JSON.stringify({id:'instance_a',summary:'Changed occurrence'}));
 };
 try{const result:any=await provider.write!('synthetic-token','calendar.update',{operationId:'calendar-instance-001',eventId:'series_a',scope:'single',originalStart:'2026-12-01T12:00:00Z',summary:'Changed occurrence'},{from:'owner@example.invalid',operationKey:'a'.repeat(64)});assert.equal(result.result.event.id,'instance_a');assert.deepEqual(calls.map(x=>x.method),['GET','GET','PATCH']);}finally{globalThis.fetch=prior;}
});

test('invalid all-day intervals are rejected before provider access',()=>{
 assert.throws(()=>googleWriteInput('calendar.create',{operationId:'invalid-date-001',summary:'Fixture',allDay:true,start:'2026-02-30',end:'2026-03-03'}));
});

function fixture(preset='gmail_read'){
 const now='2026-11-27T00:00:00Z',records=new Map<string,ConnectionRecord>(),values=new Map<string,string>(),calls={read:0,write:0,vault:0,refresh:0,exchange:0};let authorization:GoogleAuthorization|undefined,exchangeFailure:Error|undefined;
 const client:ConnectionRecord={id:'client-fixture',ownerProfileId:'alex',label:'Client',kind:'google_client',scopes:[],secretId:'client-secret',status:'connected',createdAt:now,updatedAt:now};
 const account:ConnectionRecord={id:'connection-fixture',ownerProfileId:'alex',label:'Fixture Google',kind:'google',account:'owner@example.invalid',accountId:'fixture-account',preset:preset as any,scopes:presets[preset as keyof typeof presets],secretId:'account-secret',status:'connected',createdAt:now,updatedAt:now};
 records.set(client.id,client);records.set(account.id,account);
 values.set('client-secret',JSON.stringify({clientId:'fixture.apps.googleusercontent.com',clientSecret:'fixture-client-secret',redirectUri:'http://localhost:8787/oauth2/callback'}));
 values.set('account-secret',JSON.stringify({type:'google_oauth_v1',email:account.account,accountId:account.accountId,clientId:'fixture.apps.googleusercontent.com',clientSecretId:'client-secret',refreshToken:'fixture-refresh'}));
 const store={list:(owner:string)=>[...records.values()].filter(x=>x.ownerProfileId===owner),get:(owner:string,id:string)=>{const r=records.get(id);return r?.ownerProfileId===owner?r:undefined;},save:(r:ConnectionRecord)=>{records.set(r.id,{...r});}};
 const provider:GoogleProvider={authorizationUrl:async value=>{authorization=value;return 'https://accounts.google.com/o/oauth2/auth?state='+value.state;},exchange:async()=>{calls.exchange++;if(exchangeFailure)throw exchangeFailure;return {email:account.account!,accountId:account.accountId!,refreshToken:'new-fixture-refresh',scopes:[...authorization!.scopes]};},refresh:async()=>{calls.refresh++;return {accessToken:'fixture-access'};},revoke:async()=>{},read:async()=>{calls.read++;return {id:'fixture-message'};},write:async(_token,_op,_input,context)=>{calls.write++;assert.equal(context.from,account.account);assert.match(context.operationKey,/^[a-f0-9]{64}$/);return {state:'committed',id:'written-fixture'};}};
 const service=new ConnectionsService({store,google:provider,securityReady:()=>true,vault:{configured:async()=>true,bootstrap:async()=>{},read:async id=>{calls.vault++;return values.get(id)!;},put:async(key,value)=>{const secretId=records.get(key)?.secretId||key+'-secret';values.set(secretId,value);return {secretId,revision:'fixture'};},replace:async(id,prior,value)=>{assert.equal(values.get(id),prior);values.set(id,value);return {secretId:id,revision:'fixture-rotate'};}}});
 const current=()=>{},send={operationId:'send-fixture-001',to:['target@example.invalid'],subject:'Fixture',text:'Synthetic only'};
 return {service,records,values,calls,current,send,account,getAuthorization:()=>authorization!,failExchange:(error:Error)=>exchangeFailure=error};
}
test('write profiles describe Gmail and Calendar access while existing read grants reject mutations before token access',async()=>{
 assert.ok(presets.gmail_manage.includes('https://www.googleapis.com/auth/gmail.modify'));assert.ok(presets.calendar_manage.includes('https://www.googleapis.com/auth/calendar.events'));
 const f=fixture();await assert.rejects(()=>f.service.writeGoogle('alex',f.account.id,'gmail.send',f.send,f.current),{code:'connection_operation_not_allowed'});assert.deepEqual(f.calls,{read:0,write:0,vault:0,refresh:0,exchange:0});
 await f.service.readGoogle('alex',f.account.id,'gmail.get',{messageId:'fixture-message'},f.current);assert.equal(f.calls.read,1);assert.equal(f.calls.write,0);
 await assert.rejects(()=>f.service.writeGoogle('other',f.account.id,'gmail.send',f.send,f.current));assert.equal(f.calls.write,0);
});
test('consent upgrades the same working connection and preserves default mailbox routing',async()=>{
 const f=fixture(),started=await f.service.startGoogle('alex',{operationId:'upgrade-fixture-001',connectionId:f.account.id,label:f.account.label,expectedEmail:f.account.account,preset:'gmail_manage'},f.current);
 assert.equal(f.records.get(f.account.id)!.preset,'gmail_read');assert.equal((await f.service.snapshot('alex')).connections[0].access,'read');
 await f.service.readDefaultGoogleEmail('alex',f.account.account!,'gmail.get',{messageId:'fixture-message'},f.current);assert.equal(f.calls.read,1);
 const result=await f.service.completeGoogle('alex',{flowId:started.flowId,callbackUrl:'http://localhost:8787/oauth2/callback?state='+f.getAuthorization().state+'&code=fixture-code'},f.current);
 assert.equal(result.connection.id,f.account.id);assert.equal(result.connection.access,'write');assert.equal([...f.records.values()].filter(x=>x.kind==='google').length,1);
 await f.service.writeDefaultGoogleEmail('alex',f.account.account!,'gmail.send',f.send,f.current);assert.equal(f.calls.write,1);
 assert.doesNotMatch(JSON.stringify(result),/fixture-refresh|client-secret|account-secret|secretId/);
});
test('a failed consent leaves the prior read connection usable',async()=>{
 const f=fixture(),started=await f.service.startGoogle('alex',{operationId:'upgrade-fixture-002',connectionId:f.account.id,label:f.account.label,expectedEmail:f.account.account,preset:'gmail_manage'},f.current);
 f.failExchange(new ConnectionsError('google_consent_denied',403));await assert.rejects(()=>f.service.completeGoogle('alex',{flowId:started.flowId,callbackUrl:'http://localhost:8787/oauth2/callback?state='+f.getAuthorization().state+'&code=fixture-code'},f.current));
 assert.equal(f.records.get(f.account.id)!.preset,'gmail_read');await f.service.readDefaultGoogleEmail('alex',f.account.account!,'gmail.get',{messageId:'fixture-message'},f.current);assert.equal(f.calls.read,1);
});
for(const preset of ['gmail_manage','calendar_manage','household_calendar_manage'])test('read-only downgrade immediately disables writes for '+preset,async()=>{
 const f=fixture(preset);await f.service.setGoogleReadOnly('alex',{operationId:'downgrade-fixture-001',connectionId:f.account.id},f.current);
 const record=f.records.get(f.account.id)!;assert.equal(record.scopes,f.account.scopes);assert.equal((await f.service.snapshot('alex')).connections[0].access,'read');
 const op=preset==='gmail_manage'?'gmail.send':'calendar.create',args=preset==='gmail_manage'?f.send:{operationId:'calendar-fixture-001',summary:'Synthetic',start:'2026-12-01T12:00:00Z',end:'2026-12-01T13:00:00Z'};
 await assert.rejects(()=>f.service.writeGoogle('alex',f.account.id,op,args,f.current),{code:'connection_operation_not_allowed'});assert.equal(f.calls.vault,0);assert.equal(f.calls.write,0);
 await f.service.readGoogle('alex',f.account.id,preset==='gmail_manage'?'gmail.get':'calendar.get',preset==='gmail_manage'?{messageId:'fixture-message'}:{eventId:'fixture-event'},f.current);assert.equal(f.calls.read,1);
});
test('a changed connection invalidates an older outstanding permission flow before code exchange',async()=>{
 const f=fixture('gmail_manage'),started=await f.service.startGoogle('alex',{operationId:'upgrade-fixture-003',connectionId:f.account.id,label:f.account.label,expectedEmail:f.account.account,preset:'gmail_manage'},f.current);
 await f.service.setGoogleReadOnly('alex',{operationId:'downgrade-fixture-002',connectionId:f.account.id},f.current);
 await assert.rejects(()=>f.service.completeGoogle('alex',{flowId:started.flowId,callbackUrl:'http://localhost:8787/oauth2/callback?state='+f.getAuthorization().state+'&code=fixture-code'},f.current),{code:'google_connection_changed'});assert.equal(f.calls.exchange,0);
});
test('malformed writes cannot choose credentials, sender, URL or host attachments',async()=>{
 const f=fixture('gmail_manage');
 for(const patch of [{from:'other@example.invalid'},{url:'http://localhost/private'},{accessToken:'forged'},{subject:'Subject\r\nBcc: attacker@example.invalid'},{attachments:[{filename:'x',path:'/var/lib/private'}]}]){
  await assert.rejects(()=>f.service.writeGoogle('alex',f.account.id,'gmail.send',{...f.send,...patch},f.current));
 }
 assert.equal(f.calls.vault,0);assert.equal(f.calls.write,0);
});
const context={from:'owner@example.invalid',operationKey:'a'.repeat(64)};
test('MIME composition preserves Unicode, Bcc and attachment bytes without SMTP or file access',async()=>{
 const provider=await createGoogleProvider(),previous=globalThis.fetch,bytes=Buffer.from([0,1,2,254,255]);let raw=Buffer.alloc(0),calls=0;
 globalThis.fetch=async(url,options)=>{calls++;assert.equal(String(url),'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');assert.equal(options?.method,'POST');assert.equal((options?.headers as any).authorization,'Bearer fixture-access');raw=Buffer.from(JSON.parse(String(options?.body)).raw,'base64url');return new Response(JSON.stringify({id:'sent-message',threadId:'thread'}));};
 try{
  const result=await provider.write!('fixture-access','gmail.send',{operationId:'send-fixture-004',to:['target@example.invalid'],bcc:['private@example.invalid'],subject:'Résumé 🚀',text:'Hello café',attachments:[{filename:'data.bin',mimeType:'application/octet-stream',data:bytes.toString('base64url')}]},context) as any;
  const script="import sys,email,json,hashlib\nfrom email import policy\nm=email.message_from_bytes(sys.stdin.buffer.read(),policy=policy.default)\na=list(m.iter_attachments())\nprint(json.dumps({'subject':str(m['Subject']),'from':str(m['From']),'bcc':str(m['Bcc']),'body':m.get_body(preferencelist=('plain',)).get_content().strip(),'attachment':hashlib.sha256(a[0].get_payload(decode=True)).hexdigest()}))";
  const parsed=JSON.parse(execFileSync('/usr/bin/python3',['-c',script],{input:raw,encoding:'utf8'}));assert.equal(parsed.subject,'Résumé 🚀');assert.equal(parsed.from,context.from);assert.equal(parsed.bcc,'private@example.invalid');assert.equal(parsed.body,'Hello café');assert.equal(parsed.attachment,createHash('sha256').update(bytes).digest('hex'));assert.equal(calls,1);assert.equal(result.state,'committed');assert.match(result.result.reconciliationQuery,/rfc822msgid/);
 }finally{globalThis.fetch=previous;}
});
test('mutation transport distinguishes rejection from uncertain network/provider effects and never retries',async()=>{
 const provider=await createGoogleProvider(),previous=globalThis.fetch;let calls=0;const input={operationId:'trash-fixture-001',resourceId:'message',kind:'message'};
 try{
  globalThis.fetch=async()=>{calls++;throw Error('fixture-provider-token-do-not-leak');};await assert.rejects(()=>provider.write!('fixture-access','gmail.trash',input,context),(error:any)=>error.outcome==='unknown'&&!String(error).includes('do-not-leak'));assert.equal(calls,1);
  globalThis.fetch=async()=>{calls++;return new Response('{}',{status:403});};await assert.rejects(()=>provider.write!('fixture-access','gmail.trash',input,context),(error:any)=>error.outcome==='not_sent');assert.equal(calls,2);
  globalThis.fetch=async()=>{calls++;return new Response('{}',{status:500});};await assert.rejects(()=>provider.write!('fixture-access','gmail.trash',input,context),(error:any)=>error.outcome==='unknown');assert.equal(calls,3);
 }finally{globalThis.fetch=previous;}
});
test('connected calendar creation uses deterministic identity, actual account/calendar and event fields',async()=>{
 const provider=await createGoogleProvider(),previous=globalThis.fetch;let posted:any;
 globalThis.fetch=async(url,options)=>{assert.match(String(url),/\/calendars\/shared%40group\.calendar\.google\.com\/events\?sendUpdates=all$/);posted=JSON.parse(String(options?.body));return new Response(JSON.stringify(posted));};
 try{const result=await provider.write!('fixture-access','calendar.create',{operationId:'calendar-fixture-002',calendarId:'shared@group.calendar.google.com',summary:'Synthetic only',start:'2026-12-01T12:00:00Z',end:'2026-12-01T13:00:00Z',timeZone:'Etc/UTC',attendees:['target@example.invalid']},context) as any;assert.equal(result.state,'committed');assert.equal(posted.id,'h'+context.operationKey);assert.equal(posted.extendedProperties.private.hardyOperation,context.operationKey);assert.equal(posted.start.dateTime,'2026-12-01T12:00:00Z');}finally{globalThis.fetch=previous;}
});
test('calendar edits use the actual revision and reject concurrent changes before claiming success',async()=>{
 const provider=await createGoogleProvider(),previous=globalThis.fetch;let calls=0;
 globalThis.fetch=async(_url,options)=>{calls++;if(options?.method==='GET')return new Response(JSON.stringify({id:'event',etag:'"revision-1"',summary:'Before'}));assert.equal((options?.headers as any)['if-match'],'"revision-1"');return new Response('{}',{status:412});};
 try{await assert.rejects(()=>provider.write!('fixture-access','calendar.update',{operationId:'calendar-fixture-003',eventId:'event',scope:'all',summary:'After'},context),(error:any)=>error.code==='google_revision_conflict'&&error.outcome==='not_sent');assert.equal(calls,2);}finally{globalThis.fetch=previous;}
});
test('batch mailbox changes encode exact IDs and label sets, with the provider’s 1000-message boundary',()=>{
 const input=googleWriteInput('gmail.modify',{operationId:'labels-fixture-001',messageIds:['a','b','a'],removeLabelIds:['UNREAD','INBOX']});assert.deepEqual(input.messageIds,['a','b']);assert.deepEqual(input.removeLabelIds,['UNREAD','INBOX']);
 assert.throws(()=>googleWriteInput('gmail.modify',{operationId:'labels-fixture-002',messageIds:Array.from({length:1001},(_,i)=>String(i)),addLabelIds:['STARRED']}));
});
