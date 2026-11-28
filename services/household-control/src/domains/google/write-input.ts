import {NativeDomainError} from '../native-contracts.ts';
import {record,closed} from '../native-validation.ts';
export type GoogleWriteOperation = 'gmail.send'|'gmail.draft.save'|'gmail.draft.send'|'gmail.draft.delete'|'gmail.label.save'|'gmail.label.delete'|'gmail.modify'|'gmail.trash'|'calendar.create'|'calendar.update'|'calendar.delete';
const object=record,fields=(value:Record<string,unknown>,keys:string[])=>{closed(value,keys,[]);};
const fail=():never=>{throw new NativeDomainError('invalid_google_write',400);};
export function providerId(value:unknown):string{if(typeof value!=='string'||!/^[A-Za-z0-9_-]+$/.test(value))return fail();return value;}
export function calendarId(value:unknown='primary'):string{if(typeof value!=='string'||!value||/[\x00-\x20\x7f/\\?#%]/.test(value)||value==='.'||value==='..')return fail();return value;}
function text(value:unknown,empty=false):string{if(typeof value!=='string'||!empty&&!value)return fail();return value;}
function header(value:unknown,empty=false):string{const s=text(value,empty);if(/[\r\n\x00]/.test(s))return fail();return s;}
function emails(value:unknown):string[]{if(!Array.isArray(value))return fail();return [...new Set(value.map(x=>{const s=header(x);if(!/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(s))return fail();return s;}))];}
function ids(value:unknown):string[]{if(!Array.isArray(value))return fail();return [...new Set(value.map(providerId))];}
const compose=['to','cc','bcc','subject','text','html','threadId','inReplyTo','references','attachments'];
const eventFields=['calendarId','summary','start','end','timeZone','allDay','description','location','attendees','recurrence','reminders','visibility','transparency','scope','originalStart','notifyAttendees','expectedEtag'];
/** Validate canonical, typed provider input before touching account credentials. */
export function googleWriteInput(operation:GoogleWriteOperation,value:unknown):Record<string,any>{
 const input=object(value),result:Record<string,any>={};
 const keys:Record<GoogleWriteOperation,string[]>={
  'gmail.send':compose,'gmail.draft.save':['draftId',...compose],'gmail.draft.send':['draftId'],'gmail.draft.delete':['draftId'],
  'gmail.label.save':['labelId','name','labelListVisibility','messageListVisibility','color'],'gmail.label.delete':['labelId'],
  'gmail.modify':['messageIds','addLabelIds','removeLabelIds'],'gmail.trash':['resourceId','kind','restore'],
  'calendar.create':eventFields,'calendar.update':['eventId',...eventFields],'calendar.delete':['eventId','calendarId','scope','originalStart','notifyAttendees','expectedEtag'],
 };
 if(!Object.hasOwn(keys,operation))return fail();fields(input,['operationId',...keys[operation]]);
 if(typeof input.operationId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(input.operationId))return fail();result.operationId=input.operationId;
 if(operation==='gmail.send'||operation==='gmail.draft.save'){
  for(const k of ['to','cc','bcc'])if(input[k]!==undefined)result[k]=emails(input[k]);
  if(operation==='gmail.send'&&!['to','cc','bcc'].some(k=>result[k]?.length))return fail();
  for(const k of ['subject','inReplyTo'])if(input[k]!==undefined)result[k]=header(input[k],k==='subject');
  if(input.references!==undefined){if(!Array.isArray(input.references))return fail();result.references=input.references.map(x=>header(x));}
  for(const k of ['text','html'])if(input[k]!==undefined)result[k]=text(input[k],true);
  for(const k of ['threadId','draftId'])if(input[k]!==undefined)result[k]=providerId(input[k]);
  if(input.attachments!==undefined){
   if(!Array.isArray(input.attachments))return fail();result.attachments=input.attachments.map(value=>{
    const part=object(value);fields(part,['filename','mimeType','data']);const filename=header(part.filename),mimeType=header(part.mimeType),data=text(part.data,true);
    if(/[\/\\]/.test(filename)||filename==='.'||filename==='..'||!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mimeType)||!/^[A-Za-z0-9_-]*$/.test(data)||Buffer.from(data,'base64url').toString('base64url')!==data)return fail();
    return {filename,mimeType,data};
   });
  }
 }else if(operation.startsWith('gmail.draft.'))result.draftId=providerId(input.draftId);
 else if(operation==='gmail.label.save'){
  if(input.labelId!==undefined)result.labelId=providerId(input.labelId);
  if(input.name!==undefined)result.name=header(input.name);
  if(!result.labelId&&!result.name)return fail();
  for(const [key,choices] of [['labelListVisibility',['labelShow','labelShowIfUnread','labelHide']],['messageListVisibility',['show','hide']]] as const){if(input[key]!==undefined){if(!choices.includes(input[key] as never))return fail();result[key]=input[key];}}
  if(input.color!==undefined){const c=object(input.color);fields(c,['backgroundColor','textColor']);result.color={};for(const key of ['backgroundColor','textColor'])if(c[key]!==undefined){if(typeof c[key]!=='string'||!/^#[a-f0-9]{6}$/i.test(c[key] as string))return fail();result.color[key]=c[key];}}
 }else if(operation==='gmail.label.delete')result.labelId=providerId(input.labelId);
 else if(operation==='gmail.modify'){
  result.messageIds=ids(input.messageIds);if(!result.messageIds.length||result.messageIds.length>1000)return fail();
  result.addLabelIds=input.addLabelIds===undefined?[]:ids(input.addLabelIds);result.removeLabelIds=input.removeLabelIds===undefined?[]:ids(input.removeLabelIds);
  if(!result.addLabelIds.length&&!result.removeLabelIds.length||result.addLabelIds.some((x:string)=>result.removeLabelIds.includes(x)))return fail();
 }else if(operation==='gmail.trash'){
  result.resourceId=providerId(input.resourceId);result.kind=input.kind??'message';if(!['message','thread'].includes(result.kind))return fail();
  if(input.restore!==undefined&&typeof input.restore!=='boolean')return fail();result.restore=input.restore??false;
 }else{
  result.calendarId=calendarId(input.calendarId);if(operation!=='calendar.create')result.eventId=providerId(input.eventId);
  for(const k of ['summary','timeZone','location','expectedEtag','originalStart'])if(input[k]!==undefined)result[k]=header(input[k],k==='summary'||k==='location');
  if(input.description!==undefined)result.description=text(input.description,true);
  for(const k of ['allDay','notifyAttendees'])if(input[k]!==undefined){if(typeof input[k]!=='boolean')return fail();result[k]=input[k];}
  if(input.attendees!==undefined)result.attendees=emails(input.attendees);
  if(input.scope!==undefined){if(!['single','future','all'].includes(String(input.scope)))return fail();result.scope=input.scope;}
  for(const k of ['start','end'])if(input[k]!==undefined){const s=header(input[k]);if(input.allDay?(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s):!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(s)||!Number.isFinite(Date.parse(s)))return fail();result[k]=s;}
  if((result.start!==undefined)!==(result.end!==undefined)||result.start&&Date.parse(result.end)<=Date.parse(result.start))return fail();
  if(operation==='calendar.create'&&(!result.summary||!result.start))return fail();
  if(input.recurrence!==undefined){if(!Array.isArray(input.recurrence)||input.recurrence.some(x=>typeof x!=='string'||!/^(RRULE|EXRULE|RDATE|EXDATE):[A-Za-z0-9:;,=+\-TZ]+$/.test(x)))return fail();result.recurrence=input.recurrence;}
  if(input.reminders!==undefined){if(!Array.isArray(input.reminders)||input.reminders.some(x=>typeof x!=='string'||!/^(popup|email):\d+(m|h|d|w)$/.test(x)))return fail();result.reminders=input.reminders;}
  for(const [k,choices] of [['visibility',['default','private','public','confidential']],['transparency',['opaque','transparent']]] as const)if(input[k]!==undefined){if(!choices.includes(input[k] as never))return fail();result[k]=input[k];}
  if(operation==='calendar.update'&&!['summary','start','timeZone','description','location','attendees','recurrence','reminders','visibility','transparency'].some(k=>result[k]!==undefined))return fail();
 }
 return result;
}
