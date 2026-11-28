import {ConnectionsError} from './contracts.ts';
import type {GoogleWriteContext,GoogleWriteOperation} from './contracts.ts';
import {googleWriteInput,calendarId,providerId} from '../domains/google/write-input.ts';
import {googleHttp} from './google-http.ts';
const gmail='https://gmail.googleapis.com/gmail/v1/users/me/';
function message(value:any){return {id:value?.id,threadId:value?.threadId,...(Array.isArray(value?.labelIds)?{labelIds:value.labelIds}:{}),...(value?.historyId?{historyId:value.historyId}:{})};}
async function compose(input:Record<string,any>,context:GoogleWriteContext){
 const {default:MailComposer}=await import('nodemailer/lib/mail-composer/index.js');
 const messageId='<hardy-'+context.operationKey+'@hardyai.invalid>';
 const mail=new MailComposer({from:context.from,to:input.to,cc:input.cc,bcc:input.bcc,subject:input.subject??'',text:input.text,html:input.html,
  inReplyTo:input.inReplyTo,references:input.references,messageId,disableFileAccess:true,disableUrlAccess:true,
  attachments:input.attachments?.map((part:any)=>({filename:part.filename,contentType:part.mimeType,content:Buffer.from(part.data,'base64url')}))});
 const compiled=mail.compile();compiled.keepBcc=true;const bytes:Buffer=await compiled.build();
 if(bytes.length>35*1024*1024)throw new ConnectionsError('gmail_message_exceeds_provider_limit',400);
 return {messageId,body:{raw:bytes.toString('base64url'),...(input.threadId?{threadId:input.threadId}:{})}};
}
export async function writeGoogle(accessToken:string,operation:GoogleWriteOperation,value:unknown,context:GoogleWriteContext):Promise<unknown>{
 const input=googleWriteInput(operation,value);
 if(!context||!context.from||!/^[a-f0-9]{64}$/.test(context.operationKey))throw new ConnectionsError('connection_identity_mismatch',403);
 const call=(url:string|URL,method='GET',body?:unknown)=>googleHttp(accessToken,new URL(url),method,body,context.signal);
 const receipt=(result:unknown)=>({state:'committed',operationId:input.operationId,result});
 if(operation==='gmail.send'||operation==='gmail.draft.save'){
  const built=await compose(input,context),draft=operation==='gmail.draft.save';
  const url=draft?gmail+'drafts'+(input.draftId?'/'+providerId(input.draftId):''):gmail+'messages/send';
  const result=await call(url,draft&&input.draftId?'PUT':'POST',draft?{message:built.body}:built.body);
  const actual=draft?result?.message:result;if(!actual?.id||draft&&!result.id)throw new ConnectionsError('google_write_outcome_unknown',503,'unknown');
  return receipt({...message(actual),...(draft?{draftId:result.id}:{}),messageIdHeader:built.messageId,reconciliationQuery:'in:anywhere rfc822msgid:'+built.messageId});
 }
 if(operation==='gmail.draft.send'){
  const result=await call(gmail+'drafts/send','POST',{id:input.draftId});if(!result?.id)throw new ConnectionsError('google_write_outcome_unknown',503,'unknown');return receipt(message(result));
 }
 if(operation==='gmail.draft.delete'){await call(gmail+'drafts/'+input.draftId,'DELETE');return receipt({draftId:input.draftId,deleted:true});}
 if(operation==='gmail.label.save'){
  const {operationId,labelId,...body}=input;const result=await call(gmail+'labels'+(labelId?'/'+labelId:''),labelId?'PATCH':'POST',body);
  if(!result?.id)throw new ConnectionsError('google_write_outcome_unknown',503,'unknown');return receipt(result);
 }
 if(operation==='gmail.label.delete'){await call(gmail+'labels/'+input.labelId,'DELETE');return receipt({labelId:input.labelId,deleted:true});}
 if(operation==='gmail.modify'){
  await call(gmail+'messages/batchModify','POST',{ids:input.messageIds,addLabelIds:input.addLabelIds,removeLabelIds:input.removeLabelIds});return receipt({messageIds:input.messageIds,addLabelIds:input.addLabelIds,removeLabelIds:input.removeLabelIds,providerAccepted:true});
 }
 if(operation==='gmail.trash'){
  const result=await call(gmail+(input.kind==='thread'?'threads':'messages')+'/'+input.resourceId+'/'+(input.restore?'untrash':'trash'),'POST');
  return receipt({...message(result),resourceId:input.resourceId,kind:input.kind,trashed:!input.restore});
 }
 return writeCalendar(accessToken,operation,input,context);
}

async function writeCalendar(accessToken:string,operation:GoogleWriteOperation,input:Record<string,any>,context:GoogleWriteContext){
 const base='https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(calendarId(input.calendarId))+'/events';
 const request=(url:string,method='GET',body?:unknown,etag?:string)=>{
  // Conditional update headers are fixed by the adapter, never selected as arbitrary HTTP fields.
  if(!etag)return googleHttp(accessToken,new URL(url),method,body,context.signal);
  return calendarConditional(accessToken,new URL(url),method,body,etag,context.signal);
 };
 if(input.scope==='future')throw new ConnectionsError('calendar_future_requires_series_split',400);
 const event:Record<string,any>={};
 for(const k of ['summary','description','location','recurrence','visibility','transparency'])if(input[k]!==undefined)event[k]=input[k];
 if(input.attendees!==undefined)event.attendees=input.attendees.map((email:string)=>({email}));
 if(input.start!==undefined){event.start=input.allDay?{date:input.start}:{dateTime:input.start,...(input.timeZone?{timeZone:input.timeZone}:{})};event.end=input.allDay?{date:input.end}:{dateTime:input.end,...(input.timeZone?{timeZone:input.timeZone}:{})};}
 if(input.reminders!==undefined)event.reminders={useDefault:false,overrides:input.reminders.map((value:string)=>{const [,method,count,unit]=value.match(/^(popup|email):(\d+)(m|h|d|w)$/)!;return {method,minutes:Number(count)*({m:1,h:60,d:1440,w:10080}[unit]??1)};})};
 const updates=input.notifyAttendees??(operation==='calendar.create'&&!!input.attendees?.length)?'all':'none';
 let id=input.eventId,before:any;
 if(operation!=='calendar.create'){
  before=await request(base+'/'+providerId(id));
  if(input.scope==='all'&&before.recurringEventId){id=providerId(before.recurringEventId);before=await request(base+'/'+id);}
  if(input.scope==='single'&&Array.isArray(before.recurrence)){
   if(!input.originalStart)throw new ConnectionsError('calendar_original_start_required',400);
   const url=new URL(base+'/'+id+'/instances');url.searchParams.set('originalStart',input.originalStart);
   const result=await request(url.href);const items=Array.isArray(result.items)?result.items:[];
   const matches=items.filter((value:any)=>{const s=value.originalStartTime?.dateTime??value.originalStartTime?.date;return s===input.originalStart||s&&Number.isFinite(Date.parse(s))&&Date.parse(s)===Date.parse(input.originalStart);});
   if(matches.length!==1)throw new ConnectionsError('calendar_instance_not_unique',409);
   id=providerId(matches[0].id);before=matches[0];
  }
 }
 if(input.timeZone&&input.start===undefined&&operation==='calendar.update'){
  if(!before?.start?.dateTime||!before?.end?.dateTime)throw new ConnectionsError('calendar_interval_required',400);
  event.start={dateTime:before.start.dateTime,timeZone:input.timeZone};event.end={dateTime:before.end.dateTime,timeZone:input.timeZone};
 }
 if(operation==='calendar.delete'){
  await request(base+'/'+id+'?sendUpdates='+updates,'DELETE',undefined,input.expectedEtag??before?.etag);return {state:'committed',operationId:input.operationId,result:{calendarId:input.calendarId,eventId:id,deleted:true}};
 }
 let result:any;
 if(operation==='calendar.create'){
  id='h'+context.operationKey;event.id=id;event.extendedProperties={private:{hardyOperation:context.operationKey}};
  try{result=await request(base+'?sendUpdates='+updates,'POST',event);}
  catch(error){
   if((error as ConnectionsError).code!=='google_write_conflict')throw error;
   const saved=await request(base+'/'+id);if(saved.extendedProperties?.private?.hardyOperation!==context.operationKey)throw error;result=saved;
  }
 }else result=await request(base+'/'+id+'?sendUpdates='+updates,'PATCH',event,input.expectedEtag??before?.etag);
 if(!result?.id)throw new ConnectionsError('google_write_outcome_unknown',503,'unknown');
 return {state:'committed',operationId:input.operationId,result:{calendarId:input.calendarId,event:result}};
}
async function calendarConditional(token:string,url:URL,method:string,body:unknown,etag:string,signal?:AbortSignal){
 return googleHttp(token,url,method,body,signal,etag);
}
