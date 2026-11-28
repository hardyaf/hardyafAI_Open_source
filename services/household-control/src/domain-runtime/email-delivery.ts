import {createHash} from 'node:crypto';
import {writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import type {ArtifactStore,ArtifactScope,ArtifactPrincipal} from '../platform/artifacts.ts';
import type {WorkshopConfiguration} from '../platform/workshop-profile.ts';
import {selectWorkshopContainer} from './workshop-deliveries.ts';
import {DomainError} from './common.ts';
const run=promisify(execFile);
function filename(value:unknown){
  const chars=Array.from(path.posix.basename(String(value??'attachment.bin').replace(/\\/g,'/')).replace(/[\x00-\x1f\x7f]/g,'_'));
  while(Buffer.byteLength(chars.join(''))>200)chars.pop();return chars.join('')||'attachment.bin';
}
/** Materialized provider results remain owned by the existing artifact service. */
export async function deliverEmailResult(options:{value:unknown;input:Record<string,unknown>;artifacts:ArtifactStore;
  scope:ArtifactScope;principal:ArtifactPrincipal;workshop?:WorkshopConfiguration;assertCurrent():void}){
  const value=options.value as any,receipt=value?.result,message=receipt?.result;
  if(value?.source!=='connected_google'||receipt?.operation!=='gmail.get'||!message||typeof message!=='object')return options.value;
  const attachment=message.kind==='attachment';
  if(!attachment&&(!['file','both'].includes(String(options.input.delivery))||typeof message.body!=='string'))return options.value;
  options.assertCurrent();
  let bytes:Buffer;
  if(attachment){
    if(typeof message.data!=='string'||!/^[A-Za-z0-9_-]*$/.test(message.data))throw new DomainError('email_attachment_invalid');
    bytes=Buffer.from(message.data,'base64url');
    if(bytes.toString('base64url')!==message.data||createHash('sha256').update(bytes).digest('hex')!==message.sha256)throw new DomainError('email_attachment_invalid');
  }else bytes=Buffer.from(message.body,'utf8');
  const digest=createHash('sha256').update(bytes).digest('hex'),name=attachment?filename(message.filename):filename(message.id+'.txt');
  const mimeType=attachment?(typeof message.mimeType==='string'&&/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(message.mimeType)?message.mimeType:'application/octet-stream'):'text/plain';
  let workspacePath:string|undefined,workspaceDelivery:'available'|'unavailable'|'not_requested'=options.workshop?'unavailable':'not_requested';
  const metadata=await options.artifacts.importOutput(options.scope,options.principal,{filename:name,mimeType,
    idempotencyKey:'email:'+createHash('sha256').update(JSON.stringify([receipt.connectionId,message.messageId??message.id,message.attachmentId??message.partId??null,name,digest])).digest('hex')},async destination=>{
    await writeFile(destination,bytes);options.assertCurrent();
  },options.assertCurrent);
    if(options.workshop){
      let temporary:string|undefined;
      try{
        const ids=(await run('/usr/bin/docker',['ps','-q','--no-trunc','--filter','label=openclaw.sandbox=1'])).stdout.trim().split(/\s+/).filter(Boolean);
        if(!ids.length)throw new DomainError('workshop_delivery_environment_unavailable');
        const rows=JSON.parse((await run('/usr/bin/docker',['inspect',...ids],{maxBuffer:4*1024*1024})).stdout);
        const container=selectWorkshopContainer(rows,options.workshop),directory='/workspace/attachments/'+digest;
        temporary=await mkdtemp(path.join(tmpdir(),'hardy-email-delivery-'));const destination=path.join(temporary,'content');
        await writeFile(destination,bytes,{mode:0o600});
        options.assertCurrent();await run('/usr/bin/docker',['exec',container,'mkdir','-p',directory]);
        await run('/usr/bin/docker',['cp',destination,container+':'+directory+'/'+name]);options.assertCurrent();
        workspacePath=directory+'/'+name;workspaceDelivery='available';
      }catch{options.assertCurrent();/* Scoped artifact delivery still succeeds when no native workspace is running. */}
      finally{if(temporary)await rm(temporary,{recursive:true,force:true});}
    }
  const file={artifactId:metadata.id,filename:metadata.filename,mimeType:metadata.mimeType,byteLength:metadata.byteLength,sha256:metadata.sha256,workspaceDelivery,...(workspacePath?{workspacePath}:{})};
  if(attachment){const {data,...description}=message;return {...value,result:{...receipt,result:{...description,file}}};}
  if(options.input.delivery==='both')return {...value,result:{...receipt,result:{...message,bodyFile:{...file,...message.bodyWindow}}}};
  const window=message.bodyWindow;
  return {...value,result:{...receipt,result:{...message,body:'',bodyComplete:false,bodyTruncated:true,
    bodyFile:{...file,...window},bodyWindow:window?{...window,endOffset:window.offset,nextOffset:window.offset,complete:false}:window,
    omissions:[...new Set([...(message.omissions??[]),'body_delivered_as_file'])]}}};
}
