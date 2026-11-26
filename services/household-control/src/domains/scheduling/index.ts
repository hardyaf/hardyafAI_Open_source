import {scheduleDeliverySessionKey} from "./delivery-session.ts";
import type {QueuedNoticePolicy} from "./delivery-session.ts";
import { createHash } from "node:crypto";
import { descriptor, integerProperty, NativeDomainError, objectSchema, scopeProperty, textProperty } from "../native-contracts.ts";
import type { NativeDomainContext, NativeJson, NativeRpcPort } from "../native-contracts.ts";
import { boolean, closed, integer, operation, record, rfc3339Instant, scope, text, timezone } from "../native-validation.ts";

const at=objectSchema({kind:{const:"at"},at:{type:"string",format:"date-time",maxLength:40}},["kind","at"]);
const every=objectSchema({kind:{const:"every"},everyMs:integerProperty(60_000,31_536_000_000)},["kind","everyMs"]);
const cron=objectSchema({kind:{const:"cron"},expr:textProperty(160),timeZone:textProperty(100)},["kind","expr","timeZone"]);
const scheduleProperty={oneOf:[at,every,cron]};
const deliveryProperty=objectSchema({mode:{enum:["announce","none"]},destination:{enum:["current","notifications"]}},["mode"]);
export const scheduleTools=[
  descriptor("household_schedule_list","Read only scheduled household tasks owned by this authenticated profile and source conversation. The native scheduler remains authoritative.","schedule.read",{limit:integerProperty(1,100),offset:integerProperty(0,1_000_000)},[]),
  descriptor("household_schedule_get","Read an owned scheduled task by stable native ID, including its revision for subsequent updates.","schedule.read",{jobId:textProperty(200)},["jobId"]),
  descriptor("household_schedule_create","Declare an owned scheduled task with native delivery to the current conversation by default, or the protected notification route. Set delivery.mode none only for deliberately quiet work. No raw recipient is accepted. It remains disabled until scheduled-run authorization is configured.","schedule.write",{scope:scopeProperty,name:textProperty(180),message:textProperty(20_000),schedule:scheduleProperty,enabled:{type:"boolean"},delivery:deliveryProperty},["scope","name","message","schedule"],"write"),
  descriptor("household_schedule_update","Edit an owned scheduled task with its exact native configRevision. Delivery can select only the current trusted conversation or protected notifications. Cannot change agent, owner, tool policy or credential scope.","schedule.write",{jobId:textProperty(200),expectedConfigRevision:textProperty(128),name:textProperty(180),message:textProperty(20_000),schedule:scheduleProperty,enabled:{type:"boolean"},delivery:deliveryProperty},["jobId","expectedConfigRevision"],"write"),
  descriptor("household_schedule_cancel","Disable an owned scheduled task with an exact revision, retaining its native history. This does not roll back prior completed work.","schedule.write",{jobId:textProperty(200),expectedConfigRevision:textProperty(128)},["jobId","expectedConfigRevision"],"write"),
  descriptor("household_schedule_remove","Delete an exact owned native schedule only under a current destructive approval. Prefer cancel to retain its operational history.","schedule.write",{jobId:textProperty(200)},["jobId"],"write"),
];

export type ScheduleDomainConfig={allowActivation:boolean;scheduledTools:readonly string[];queuedNoticePolicy?:QueuedNoticePolicy;deliveryScopeReady?:()=>boolean};
function hash(value:string):string{return createHash("sha256").update(value).digest("hex").slice(0,20);}
function ownershipPrefix(context:NativeDomainContext):string{return "household:"+hash(context.profileId)+":"+hash(context.conversationId)+":";}
function normalizeSchedule(value:unknown):NativeJson {
  const input=record(value);
  if(input.kind==="at") {
    closed(value,["kind","at"],["kind","at"]);const at=rfc3339Instant(input.at);
    return {kind:"at",at};
  }
  if(input.kind==="every") {closed(value,["kind","everyMs"],["kind","everyMs"]);return {kind:"every",everyMs:integer(input.everyMs,60_000,60_000,31_536_000_000)};}
  if(input.kind==="cron") {
    closed(value,["kind","expr","timeZone"],["kind","expr","timeZone"]);const expr=text(input.expr,160);
    if(!/^[0-9A-Za-z*,/\-?#LW\s]+$/.test(expr)||![5,6].includes(expr.trim().split(/\s+/).length))throw new NativeDomainError("invalid_cron_expression");
    return {kind:"cron",expr,tz:timezone(input.timeZone)};
  }
  throw new NativeDomainError("invalid_schedule_kind");
}
function jobFrom(value:unknown):NativeJson {
  const result=record(value);return result.job&&typeof result.job==="object"?record(result.job):result;
}
function isOwned(job:NativeJson,context:NativeDomainContext):boolean {
  const owner=job.owner&&typeof job.owner==="object"?record(job.owner):{};
  return owner.agentId===context.agentId&&owner.sessionKey===context.sessionKey&&job.agentId===context.agentId&&typeof job.declarationKey==="string"&&job.declarationKey.startsWith(ownershipPrefix(context));
}
function assertDelivery(job:NativeJson,expected:NativeJson):void {
  const actual=job.delivery&&typeof job.delivery==="object"?record(job.delivery):{};
  if(actual.mode!==expected.mode||expected.mode==="announce"&&["channel","to","accountId","threadId"].some(key=>String(actual[key]??"")!==String(expected[key]??"")))
    throw new NativeDomainError("schedule_delivery_readback_mismatch",502,"unknown");
}
function project(job:NativeJson):NativeJson {
  const result:NativeJson={};
  for(const key of ["id","name","description","enabled","schedule","configRevision","createdAtMs","updatedAtMs","nextRunAtMs","lastRunAtMs","lastRunStatus","lastDeliveryStatus"])if(job[key]!==undefined)result[key]=job[key];
  if(job.state&&typeof job.state==="object") {
    const state=record(job.state);
    for(const key of ["nextRunAtMs","lastRunAtMs","lastRunStatus","lastDeliveryStatus","lastDeliveredAtMs","lastDeliveryAttemptAtMs","deliverySuppressionReason"])
      if(state[key]!==undefined)result[key]=state[key];
  }
  if(job.delivery&&typeof job.delivery==="object") {
    const delivery=record(job.delivery),safe:NativeJson={mode:["none","announce"].includes(String(delivery.mode))?delivery.mode:"unsupported"};
    if(delivery.mode==="announce")for(const key of ["channel","to","accountId","threadId"])if(delivery[key]!==undefined)safe[key]=delivery[key];
    result.delivery=safe;
  }
  if(job.payload&&typeof job.payload==="object") {
    const payload=record(job.payload);
    if(payload.kind==="agentTurn"&&typeof payload.message==="string")result.message=payload.message;
  }
  return result;
}
export class ScheduleDomain {
  private readonly config:ScheduleDomainConfig;
  private readonly rpc:NativeRpcPort;
  constructor(config:ScheduleDomainConfig,rpc:NativeRpcPort){this.config=config;this.rpc=rpc;}
  private async owned(id:unknown,context:NativeDomainContext):Promise<NativeJson> {
    const jobId=text(id,200);
    const job=jobFrom(await this.rpc.request("cron.get",{id:jobId},context));
    if(!isOwned(job,context))throw new NativeDomainError("schedule_not_found",404);
    return job;
  }
  private activation(value:unknown):boolean {
    const enabled=boolean(value,false);
    if(enabled&&!this.config.allowActivation)throw new NativeDomainError("scheduled_authorization_not_configured",409);
    if(enabled&&this.config.queuedNoticePolicy==="recheck_each_attempt")throw new NativeDomainError("native_scheduled_delivery_retry_guard_unavailable",409);
    if(enabled&&this.config.deliveryScopeReady&&!this.config.deliveryScopeReady())throw new NativeDomainError("native_scheduled_delivery_scope_unavailable",409);
    return enabled;
  }
  private delivery(value:unknown,context:NativeDomainContext,selected:"personal"|"household"):NativeJson {
    const input=value===undefined?{mode:"announce"}:closed(value,["mode","destination"],["mode"]);
    if(input.mode==="none"){if(input.destination!==undefined)throw new NativeDomainError("quiet_schedule_has_no_destination");return {mode:"none"};}
    if(input.mode!=="announce"||input.destination!==undefined&&!["current","notifications"].includes(String(input.destination)))throw new NativeDomainError("invalid_schedule_delivery");
    const target=input.destination==="notifications"?context.notificationTarget:context.deliveryTarget;
    if(!target)throw new NativeDomainError("schedule_delivery_destination_unavailable",409);
    if(selected==="personal"&&target.audience!=="private")throw new NativeDomainError("private_schedule_shared_delivery_forbidden",403);
    context.assertCurrent();
    return {mode:"announce",channel:target.channel,to:target.to,...(target.accountId?{accountId:target.accountId}:{}),...(target.threadId?{threadId:target.threadId}:{})};
  }
  async execute(name:string,args:unknown,context:NativeDomainContext):Promise<unknown> {
    context.assertCurrent();
    if(name==="household_schedule_list") {
      const input=closed(args,["limit","offset"]);
      const raw=record(await this.rpc.request("cron.list",{agentId:context.agentId,includeDisabled:true,limit:integer(input.limit,50),offset:integer(input.offset,0,0,1_000_000),includeDeliveryPreviews:false},context));
      const jobs=(Array.isArray(raw.jobs)?raw.jobs:[]).map(record).filter(job=>isOwned(job,context)).map(project);
      const limit=integer(input.limit,50),offset=integer(input.offset,0,0,1_000_000);
      return {source:"native_scheduler",untrusted:true,jobs,count:jobs.length,nextOffset:Number.isSafeInteger(raw.nextOffset)&&Number(raw.nextOffset)>offset?Number(raw.nextOffset):raw.hasMore===true?(Array.isArray(raw.jobs)&&raw.jobs.length?offset+raw.jobs.length:null):(Array.isArray(raw.jobs)&&raw.jobs.length===limit?offset+limit:null)};
    }
    if(name==="household_schedule_get") {const input=closed(args,["jobId"],["jobId"]);return {source:"native_scheduler",untrusted:true,job:project(await this.owned(input.jobId,context))};}
    if(name==="household_schedule_create") {
      const input=closed(args,["operationId","scope","name","message","schedule","enabled","delivery"],["operationId","scope","name","message","schedule"]);
      const selected=scope(input.scope,context),op=operation(input.operationId),enabled=this.activation(input.enabled);
      const declarationKey=ownershipPrefix(context)+hash(op),delivery=this.delivery(input.delivery,context,selected);
      const authorizationReady=this.config.allowActivation&&this.config.queuedNoticePolicy!=="recheck_each_attempt"&&(!this.config.deliveryScopeReady||this.config.deliveryScopeReady());
      context.assertCurrent();
      const result=await this.rpc.request("cron.add",{name:text(input.name,180),declarationKey,owner:{agentId:context.agentId,sessionKey:context.sessionKey},agentId:context.agentId,sessionKey:scheduleDeliverySessionKey(context.agentId,declarationKey),description:"Household task; audience="+selected,schedule:normalizeSchedule(input.schedule),enabled,deleteAfterRun:false,sessionTarget:"isolated",wakeMode:"now",payload:{kind:"agentTurn",message:text(input.message,20_000),toolsAllow:[...this.config.scheduledTools],toolsAllowIsDefault:false},delivery,...(delivery.mode==="none"?{failureAlert:false}:{})},context);
      const job=jobFrom(result);if(!isOwned(job,context))throw new NativeDomainError("native_schedule_receipt_invalid",502,"unknown");assertDelivery(job,delivery);
      return {source:"native_scheduler",state:"committed",untrusted:true,job:project(job),activation:enabled?"enabled":"disabled",authorizationReady,deliveryAuthorizationBoundary:this.config.queuedNoticePolicy==="recheck_each_attempt"?"activation_blocked_retry_guard_unavailable":"native_preparation_then_committed_queue"};
    }
    if(!["household_schedule_update","household_schedule_cancel","household_schedule_remove"].includes(name))throw new NativeDomainError("unknown_tool",404);
    const remove=name==="household_schedule_remove",cancel=name==="household_schedule_cancel";
    const input=closed(args,["operationId","jobId",...(!remove?["expectedConfigRevision"]:[]),...(!remove&&!cancel?["name","message","schedule","enabled","delivery"]:[])],["operationId","jobId",...(!remove?["expectedConfigRevision"]:[])]);
    operation(input.operationId);const job=await this.owned(input.jobId,context);
    if(remove) {
      if(!context.destructiveApproved)throw new NativeDomainError("destructive_approval_required",403);
      context.assertCurrent();return {source:"native_scheduler",state:"provider_acknowledged",jobId:text(input.jobId,200),result:await this.rpc.request("cron.remove",{id:text(input.jobId,200)},context)};
    }
    const revision=text(input.expectedConfigRevision,128);
    if(job.configRevision!==revision)throw new NativeDomainError("schedule_revision_conflict",409);
    const patch:NativeJson={};
    if(cancel)patch.enabled=false;
    else {
      if(input.name!==undefined)patch.name=text(input.name,180);
      if(input.message!==undefined)patch.payload={kind:"agentTurn",message:text(input.message,20_000)};
      if(input.schedule!==undefined)patch.schedule=normalizeSchedule(input.schedule);
      if(input.enabled!==undefined){
        patch.enabled=this.activation(input.enabled);
        if(patch.enabled===true){
          if(job.sessionTarget!=="isolated"||record(job.payload).kind!=="agentTurn")throw new NativeDomainError("schedule_delivery_namespace_upgrade_required",409);
          patch.sessionKey=scheduleDeliverySessionKey(context.agentId,text(job.declarationKey,200));
        }
      }
      if(input.delivery!==undefined){
        if(typeof job.description!=="string"||!/^Household task; audience=(personal|household)$/.test(job.description))throw new NativeDomainError("schedule_audience_metadata_missing",409);
        const selected=job.description.endsWith("audience=personal")?"personal":"household";
        patch.delivery=this.delivery(input.delivery,context,selected);
      }
      if(patch.enabled===true||job.enabled===true&&patch.enabled!==false&&input.delivery!==undefined){
        this.activation(true);
        const delivery=record(patch.delivery??job.delivery);
        if(!["none","announce"].includes(String(delivery.mode)))throw new NativeDomainError("unsupported_schedule_delivery",409);
        if(delivery.mode==="announce"){
          const destinations=[context.deliveryTarget,context.notificationTarget].filter((target):target is NonNullable<NativeDomainContext["deliveryTarget"]>=>Boolean(target));
          if(!destinations.some(target=>target.channel===delivery.channel&&(target.to===delivery.to||target.channel==="discord"&&target.to==="channel:"+delivery.to)&&
            (target.accountId===undefined||target.accountId===delivery.accountId)&&String(target.threadId??"")===String(delivery.threadId??"")))throw new NativeDomainError("schedule_delivery_destination_not_authorized",403);
        }
      }
      if(!Object.keys(patch).length)throw new NativeDomainError("empty_schedule_update");
    }
    context.assertCurrent();
    try {
      await this.rpc.request("cron.update",{id:text(input.jobId,200),patch,expectedConfigRevision:revision},context);
      const saved=await this.owned(input.jobId,context);
      if(patch.delivery)assertDelivery(saved,record(patch.delivery));
      return {source:"native_scheduler",state:"committed",untrusted:true,job:project(saved)};
    }catch{throw new NativeDomainError("schedule_write_outcome_unknown",502,"unknown");}
  }
}
