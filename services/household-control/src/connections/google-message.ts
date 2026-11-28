import {createHash} from 'node:crypto';
import {ConnectionsError,object} from './contracts.ts';
import {googleHtmlText} from './google-html.ts';
import type {GoogleMessageReadInput} from '../domains/google/message-read.ts';
const projection='gmail-plain-text-v1';
type Part={value:Record<string,unknown>;path:string};
export function googleMessageParts(payload:unknown):Part[]{
  const stack:Part[]=[{value:payload&&typeof payload==='object'&&!Array.isArray(payload)?payload as Record<string,unknown>:{},path:'0'}],result:Part[]=[],seen=new Set<object>();
  while(stack.length){const part=stack.pop()!;if(seen.has(part.value))continue;seen.add(part.value);result.push(part);
    if(Array.isArray(part.value.parts))for(let i=part.value.parts.length-1;i>=0;i--){const child=part.value.parts[i];if(child&&typeof child==='object'&&!Array.isArray(child))stack.push({value:child,path:part.path+'.'+i});}}
  return result;
}
function decode(data:unknown):Buffer{
  if(typeof data!=='string'||!/^[A-Za-z0-9_-]*={0,2}$/.test(data))throw new Error('invalid_base64');
  const bytes=Buffer.from(data,'base64url');if(bytes.toString('base64url')!==data.replace(/=+$/,''))throw new Error('invalid_base64');return bytes;
}
export function projectGoogleAttachment(value:unknown,input:GoogleMessageReadInput){
  const body=object(value);let bytes:Buffer;try{bytes=decode(body.data);}catch{throw new ConnectionsError('google_attachment_invalid',503);}
  return {kind:'attachment',messageId:input.messageId,attachmentId:input.attachmentId??null,partId:input.partId??null,
    filename:input.filename??'attachment.bin',mimeType:input.mimeType??'application/octet-stream',size:bytes.length,
    sha256:createHash('sha256').update(bytes).digest('hex'),data:bytes.toString('base64url')};
}
export function projectGoogleMessage(value:unknown,input:GoogleMessageReadInput,messageScope:string){
  const message=object(value);if(message.id!==input.messageId)throw new ConnectionsError('google_message_identity_mismatch',503);
  if(!/^[a-f0-9]{64}$/.test(messageScope))throw new ConnectionsError('google_message_scope_required',403);
  const payload=message.payload&&typeof message.payload==='object'&&!Array.isArray(message.payload)?object(message.payload):{};
  const omissions=new Set<string>();
  const headers=(Array.isArray(payload.headers)?payload.headers:[]).filter(h=>h&&typeof h==='object'&&typeof h.name==='string'&&typeof h.value==='string')
    .map(h=>({name:String(h.name),value:String(h.value).replace(/[\u0000-\u001f\u007f]/g,' ')}));
  const plain:string[]=[],html:string[]=[],attachments:Record<string,unknown>[]=[];let projectionComplete=input.format!=='metadata';
  if(input.format==='metadata')omissions.add('body_not_requested');
  for(const part of googleMessageParts(payload)){
    const body=part.value.body&&typeof part.value.body==='object'&&!Array.isArray(part.value.body)?object(part.value.body):{};
    if(part.value.filename||typeof body.attachmentId==='string'){
      attachments.push({partId:typeof part.value.partId==='string'&&part.value.partId?part.value.partId:'path:'+part.path,
        ...(typeof body.attachmentId==='string'?{attachmentId:body.attachmentId}:{}),filename:typeof part.value.filename==='string'&&part.value.filename?part.value.filename:'attachment.bin',
        mimeType:typeof part.value.mimeType==='string'?part.value.mimeType:'application/octet-stream',size:typeof body.size==='number'?body.size:null});
      continue;
    }
    if(input.format==='metadata'||!['text/plain','text/html'].includes(String(part.value.mimeType)))continue;
    if(body.size===0&&body.data===undefined){(part.value.mimeType==='text/html'?html:plain).push('');continue;}
    try{
      const header=(Array.isArray(part.value.headers)?part.value.headers:[]).find(h=>typeof h?.name==='string'&&h.name.toLowerCase()==='content-type');
      const charset=typeof header?.value==='string'?header.value.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1]:undefined;
      const text=new TextDecoder(charset??'utf-8',{fatal:true}).decode(decode(body.data));
      if(part.value.mimeType==='text/html')html.push(googleHtmlText(text));else plain.push(text);
    }catch{projectionComplete=false;omissions.add('invalid_text_encoding');}
  }
  const snippet=typeof message.snippet==='string'?message.snippet:'';
  const bodySource=plain.length?'text/plain':html.length?'text/html':'snippet';
  if(!plain.length&&!html.length&&input.format!=='metadata'){projectionComplete=false;omissions.add('snippet_only');}
  const text=plain.length?plain.join('\n'):html.length?html.join('\n'):snippet;
  const version='sha256-v1:'+createHash('sha256').update(JSON.stringify({projection,messageScope,id:message.id,threadId:message.threadId??'',headers,snippet,internalDate:message.internalDate??'',bodySource,text,attachments,projectionComplete,omissions:[...omissions].sort()})).digest('hex');
  const offset=input.bodyWindow?.offset??0,chars=Array.from(text),totalChars=chars.length;
  if(input.bodyWindow?.version!==undefined&&input.bodyWindow.version!==version)throw new ConnectionsError('google_message_version_changed',409);
  if(offset>totalChars)throw new ConnectionsError('google_message_window_out_of_range',400);
  const endOffset=input.bodyWindow?Math.min(totalChars,offset+input.bodyWindow.maxChars):totalChars;
  if(offset>0||endOffset<totalChars)omissions.add('body_window');
  const complete=projectionComplete&&endOffset===totalChars;
  return {id:String(message.id),threadId:typeof message.threadId==='string'?message.threadId:'',headers,snippet,body:chars.slice(offset,endOffset).join(''),bodySource,
    bodyTruncated:!projectionComplete||offset>0||endOffset<totalChars,bodyComplete:complete&&offset===0,
    bodyWindow:{projection,version,offset,endOffset,totalChars,nextOffset:endOffset<totalChars?endOffset:null,complete},attachments,omissions:[...omissions],
    ...(typeof message.internalDate==='string'?{internalDate:message.internalDate}:{})};
}
