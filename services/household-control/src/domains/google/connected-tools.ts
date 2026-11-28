import {descriptor,textProperty,integerProperty,NativeDomainError} from '../native-contracts.ts';
import type {NativeDomainContext} from '../native-contracts.ts';
import {closed,record,timezone,dateOnly} from '../native-validation.ts';
import {calendarInstant} from './calendar-time.ts';
import {googleWriteInput} from './write-input.ts';
import type {ConnectedGooglePort} from './connections-port.ts';
const connectionId={type:'string',minLength:1,description:'An approved private Google connection. Email defaults to the configured mailbox when omitted.'};
const id={type:'string',minLength:1},addresses={type:'array',items:{type:'string',format:'email'}},attachment={type:'object',additionalProperties:false,properties:{artifactId:id,workspacePath:{type:'string',minLength:1},filename:{type:'string',minLength:1}},oneOf:[{properties:{artifactId:id},required:['artifactId']},{properties:{workspacePath:id},required:['workspacePath']}]};
const compose={to:addresses,cc:addresses,bcc:addresses,subject:{type:'string'},text:{type:'string'},html:{type:'string'},threadId:id,inReplyTo:{type:'string'},references:{type:'array',items:{type:'string'}},attachments:{type:'array',items:attachment}};
const email=(name:string,description:string,props:Record<string,unknown>,required:string[],write=false)=>descriptor('household_email_'+name,description,write?'email.write':'email.read',{connectionId,...props},required,write?'write':'read');
export const connectedGoogleTools=[
 email('send','Send a message from an approved write-enabled Gmail connection. Compose plain text or HTML, recipients, replies and optional scoped artifact/workshop attachments. The app supplies effect identity; credentials are never returned.',compose,[],true),
 email('draft_save','Create or replace a Gmail draft. Omit draftId to create; use its returned draftId to replace. Requires write access; saving does not send.',{draftId:id,...compose},[],true),
 email('draft_send','Send the specified existing draft through its approved write-enabled Gmail connection.',{draftId:id},['draftId'],true),
 email('draft_delete','Delete the exact saved draft under the connection’s write permission.',{draftId:id},['draftId'],true),
 email('drafts','List drafts from the intended private Gmail account with optional Gmail query and provider pagination.',{query:{type:'string'},limit:integerProperty(1,500),pageToken:id},[]),
 email('draft_get','Read the exact draft, including message identity, text and attachment handles.',{draftId:id},['draftId']),
 email('labels','Read available Gmail system and user labels, including the IDs used by mailbox changes.',{},[]),
 email('label_save','Create or edit a user label with its supported name, visibility and color fields.',{
  labelId:id,name:{type:'string',minLength:1},labelListVisibility:{type:'string',enum:['labelShow','labelShowIfUnread','labelHide']},messageListVisibility:{type:'string',enum:['show','hide']},
  color:{type:'object',additionalProperties:false,properties:{backgroundColor:{type:'string',pattern:'^#[A-Fa-f0-9]{6}$'},textColor:{type:'string',pattern:'^#[A-Fa-f0-9]{6}$'}}}
 },[],true),
 email('label_delete','Delete a user label from the intended write-enabled Gmail connection.',{labelId:id},['labelId'],true),
 email('modify','Add or remove labels on selected messages. Compose archive, mark read/unread, star and filing with system/user label IDs. Gmail accepts up to 1000 message IDs per request.',{messageIds:{type:'array',minItems:1,maxItems:1000,items:id},addLabelIds:{type:'array',items:id},removeLabelIds:{type:'array',items:id}},['messageIds'],true),
 email('trash','Move a message or thread to Gmail Trash, or restore it with restore:true. Uses the selected account’s write permission.',{resourceId:id,kind:{type:'string',enum:['message','thread']},restore:{type:'boolean'}},['resourceId'],true),
 descriptor('household_calendar_calendars','List calendars accessible through an approved private Google connection. Returned IDs/access roles support choosing a calendar for reads and event changes.','calendar.read',{connectionId,limit:integerProperty(1,250),pageToken:id},['connectionId']),
];
const reads=new Set(['household_email_drafts','household_email_draft_get','household_email_labels','household_calendar_calendars']);
export async function executeConnectedExtra(port:ConnectedGooglePort|undefined,name:string,args:unknown,context:NativeDomainContext){
 if(!port)throw new NativeDomainError('connected_google_unavailable',503);const input=record(args),{connectionId,...body}=input;
 context.assertCurrent();
 if(reads.has(name)){
  const allowed=name==='household_email_drafts'?['query','limit','pageToken']:name==='household_email_draft_get'?['draftId']:name==='household_calendar_calendars'?['limit','pageToken']:[];
  closed(body,allowed,name==='household_email_draft_get'?['draftId']:[]);
  if(connectionId!==undefined)return port.read(String(connectionId),name,body,context);
  if(name==='household_calendar_calendars'||!port.readDefaultEmail)throw new NativeDomainError('connection_required');return port.readDefaultEmail(name,body,context);
 }
 if(!port.write)throw new NativeDomainError('connected_google_unavailable',503);
 const operations:Record<string,any>={household_email_send:'gmail.send',household_email_draft_save:'gmail.draft.save',household_email_draft_send:'gmail.draft.send',household_email_draft_delete:'gmail.draft.delete',household_email_label_save:'gmail.label.save',household_email_label_delete:'gmail.label.delete',household_email_modify:'gmail.modify',household_email_trash:'gmail.trash'};
 const normalized=googleWriteInput(operations[name],body);
 if(connectionId!==undefined)return port.write(String(connectionId),name,normalized,context);
 if(!port.writeDefaultEmail)throw new NativeDomainError('connected_google_unavailable',503);return port.writeDefaultEmail(name,normalized,context);
}
export async function executeConnectedCalendar(port:ConnectedGooglePort,name:string,args:unknown,context:NativeDomainContext,defaultZone:string){
 const {connectionId,...body}=record(args);if(typeof connectionId!=='string'||!port.write)throw new NativeDomainError('connected_google_unavailable',503);
 const kind=name.replace('household_calendar_',''),zone=timezone(body.timeZone??defaultZone);
 if(body.start!==undefined){body.start=body.allDay?dateOnly(body.start):calendarInstant(body.start,zone);body.end=body.allDay?dateOnly(body.end):calendarInstant(body.end,zone);if(!body.allDay)body.timeZone=zone;}
 if(body.attendees!==undefined&&!context.ownerAutonomy){const allowed=new Set(context.authorizedAttendees.map(x=>x.toLowerCase()));if(!Array.isArray(body.attendees)||body.attendees.some(x=>typeof x!=='string'||!allowed.has(x.toLowerCase())))throw new NativeDomainError('attendee_not_authorized',403);}
 if(kind==='delete'&&!context.destructiveApproved)throw new NativeDomainError('destructive_approval_required',403);
 if(body.notifyAttendees===true&&!context.ownerAutonomy){
  const envelope:any=await port.read(connectionId,'household_calendar_get',{eventId:body.eventId,...(body.calendarId?{calendarId:body.calendarId}:{})},context);
  const event=envelope?.result?.result??envelope?.result??envelope;
  const allowed=new Set(context.authorizedAttendees.map(x=>x.toLowerCase()));
  if(!Array.isArray(event?.attendees)||event.attendees.some((x:any)=>typeof x.email!=='string'||!allowed.has(x.email.toLowerCase())))throw new NativeDomainError('attendee_not_authorized',403);
 }
 if(body.scope==='future')throw new NativeDomainError('calendar_future_requires_series_split');
 const normalized=googleWriteInput(('calendar.'+kind) as any,body);return port.write(connectionId,name,normalized,context);
}
