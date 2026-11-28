import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {deliverEmailResult} from '../src/domain-runtime/email-delivery.ts';
import {ArtifactStore} from '../src/platform/artifacts.ts';
import {googleHtmlText} from '../src/connections/google-html.ts';
import {createGoogleProvider} from '../src/connections/google.ts';

test('HTML extraction decodes text and links without script, CSS or resource execution',()=>{
 const text=googleHtmlText('<head><style>private-style</style></head><p>Hello &amp; welcome</p><script>private-script</script><a href="https://example.invalid/file">link</a><img src="http://localhost/private" alt="diagram">');
 assert.match(text,/Hello & welcome/);assert.match(text,/https:\/\/example.invalid\/file/);assert.match(text,/diagram/);assert.doesNotMatch(text,/private-script|private-style|localhost/);
});

test('attachment retrieval supports provider and inline parts with cancellation and no new consent',async()=>{
 const provider=await createGoogleProvider(),previous=globalThis.fetch,bytes=Buffer.from('arbitrary attachment bytes');let calls:string[]=[];
 globalThis.fetch=async(url,options)=>{calls.push(String(url));assert.equal((options?.headers as any).authorization,'Bearer fixture-access');return new Response(JSON.stringify(calls.length===1?{id:'mail',payload:{parts:[{partId:'1',filename:'report.bin',mimeType:'application/octet-stream',body:{attachmentId:'part',size:bytes.length}}]}}:{data:bytes.toString('base64url')}));};
 try{
  const result=await provider.read('fixture-access','gmail.get',{messageId:'mail',format:'attachment',partId:'1'},{messageScope:'a'.repeat(64)}) as any;
  assert.equal(result.filename,'report.bin');assert.equal(result.data,bytes.toString('base64url'));assert.equal(result.sha256,createHash('sha256').update(bytes).digest('hex'));assert.match(calls[1],/\/messages\/mail\/attachments\/part$/);
  const controller=new AbortController();controller.abort();globalThis.fetch=async(_url,options)=>{options?.signal?.throwIfAborted();throw Error('unexpected_fetch');};
  await assert.rejects(provider.read('fixture-access','gmail.get',{messageId:'mail'},{messageScope:'a'.repeat(64),signal:controller.signal}));
 }finally{globalThis.fetch=previous;}
});

test('large attachments materialize once with exact bytes, scoped custody and no base64 in model results',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'email-delivery-'));
 try{
  const artifacts=new ArtifactStore({root,maxBytes:1024});await artifacts.initialize();
  const bytes=Buffer.alloc(3*1024*1024,85),scope={ownerProfileId:'alex',conversationId:'conversation-email',taskId:'conversation:conversation-email',audience:'private' as const},principal={profileId:'alex',canReadHousehold:true};
  const input={source:'connected_google',result:{operation:'gmail.get',connectionId:'connection-a',result:{kind:'attachment',messageId:'mail-a',attachmentId:'part-a',filename:'../../report.bin',mimeType:'application/octet-stream',data:bytes.toString('base64url'),sha256:createHash('sha256').update(bytes).digest('hex')}}};
  const options={value:input,input:{format:'attachment'},artifacts,scope,principal,assertCurrent(){}};
  const delivered=await deliverEmailResult(options) as any,replay=await deliverEmailResult(options) as any;
  assert.equal(delivered.result.result.data,undefined);assert.equal(delivered.result.result.file.filename,'report.bin');assert.equal(delivered.result.result.file.byteLength,bytes.length);assert.equal(replay.result.result.file.artifactId,delivered.result.result.file.artifactId);
  const file=await artifacts.openDownload(delivered.result.result.file.artifactId,principal);let count=0;const digest=createHash('sha256');for await(const chunk of file.stream){count+=chunk.length;digest.update(chunk);}assert.equal(count,bytes.length);assert.equal(digest.digest('hex'),input.result.result.sha256);
  await assert.rejects(()=>artifacts.get(delivered.result.result.file.artifactId,{profileId:'other',canReadHousehold:true}));
  await assert.rejects(()=>deliverEmailResult({...options,assertCurrent(){throw Error('revoked');}}),/revoked/);
  await assert.rejects(()=>deliverEmailResult({...options,value:{...input,result:{...input.result,result:{...input.result.result,sha256:'0'.repeat(64)}}}}),/email_attachment_invalid/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('body file delivery reports exact coverage while keeping inline context optional',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'email-body-file-'));
 try{
  const artifacts=new ArtifactStore({root});await artifacts.initialize();const body='large body '.repeat(10000),window={offset:0,endOffset:body.length,totalChars:body.length,nextOffset:null,complete:true};
  const options={value:{source:'connected_google',result:{operation:'gmail.get',connectionId:'a',result:{id:'mail',body,bodyWindow:window,bodyComplete:true,omissions:[]}}},input:{delivery:'file'},artifacts,scope:{ownerProfileId:'alex',conversationId:'conversation-email',taskId:'conversation:conversation-email',audience:'private' as const},principal:{profileId:'alex',canReadHousehold:true},assertCurrent(){}};
  const delivered=await deliverEmailResult(options) as any;assert.equal(delivered.result.result.body,'');assert.equal(delivered.result.result.bodyComplete,false);assert.equal(delivered.result.result.bodyFile.complete,true);assert.equal(delivered.result.result.bodyFile.byteLength,Buffer.byteLength(body));assert.equal(delivered.result.result.bodyWindow.nextOffset,0);
  const both=await deliverEmailResult({...options,input:{delivery:'both'}}) as any;assert.equal(both.result.result.body,body);assert.equal(both.result.result.bodyComplete,true);
 }finally{await rm(root,{recursive:true,force:true});}
});
