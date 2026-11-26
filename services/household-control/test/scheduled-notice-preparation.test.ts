import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {registerNativeTaskBridge} from "../../../plugins/household-domains/native-task-hooks.mjs";
import {HouseholdDatabase} from "../src/database.ts";
import {NativeAdmission} from "../src/domain-runtime/native-admission.ts";
import {HouseholdDomainRuntime} from "../src/domain-runtime/runtime.ts";
import {ArtifactStore} from "../src/platform/artifacts.ts";
import {scheduleDeliveryIdentity,scheduleDeliverySessionKey} from "../src/domains/scheduling/delivery-session.ts";
import {ScheduleDomain} from "../src/domains/scheduling/index.ts";
import type {NativeAdmissionOptions,NativeEntryRule} from "../src/domain-runtime/native-admission.ts";
import type {OpenClawAgentAdapter} from "../src/openclaw-adapter.ts";
import type {NativeDomainContext,NativeRpcPort} from "../src/domains/native-contracts.ts";
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
function fixture(){
  const database=new HouseholdDatabase(":memory:");database.setProfileStatus("alex","available","Fixture");
  const origin={id:"notice-origin",ownerProfileId:"alex",agentId:"main",sessionKey:"agent:main:discord:fixture-origin",title:"Private fixture",presetId:null,audience:"private" as const,updatedAt:new Date().toISOString()};database.insertConversation(origin);
  const rule:NativeEntryRule={profileId:"alex",externalUserId:"fixture-owner",channelId:"fixture-private",agentId:"main",audience:"private",brainDump:false};
  const rules=[rule,{...rule,channelId:"fixture-ops"}];
  const grant={enabled:true,domains:["schedule","lists"],scopes:["personal","household"] as ("personal"|"household")[],contactEditing:false,projectCodes:[],canManageProjects:false,canReviewReceipts:false,allowedAttendees:[],sharedDomains:["schedule","lists"]};
  const options:NativeAdmissionOptions={schedulingEnabled:true,scheduledToolNames:[],profileGrants:{alex:grant},queuedNoticePolicy:"finish_accepted",notificationTargets:{alex:{channel:"discord",to:"channel:fixture-ops",audience:"private"}}};
  const declarationKey="household:"+hash("alex").slice(0,20)+":"+hash(origin.id).slice(0,20)+":"+hash("fixture-operation").slice(0,20),sessionKey=scheduleDeliverySessionKey("main",declarationKey);
  const job={id:"fixture-notice-job",agentId:"main",owner:{agentId:"main",sessionKey:origin.sessionKey},sessionKey,sessionTarget:"isolated",declarationKey,description:"Household task; audience=personal",delivery:{mode:"announce",channel:"discord",to:"channel:fixture-private"},payload:{kind:"agentTurn",message:"Private household result"}};
  const calls:any[]=[];
  const adapter={requestDomainCapability:async(method:string,params:unknown)=>{calls.push({method,params});return {jobs:[job]};}} as unknown as OpenClawAgentAdapter;
  const admission=new NativeAdmission(database,adapter,rules,new ArtifactStore({root:"/unused/notice-artifacts"}),options);
  const event={to:"fixture-private",content:"Private household result"},context={sessionKey,channelId:"discord",accountId:"default"};
  const policy:any={profiles:options.profileGrants,execution:{schedulingEnabled:true,queuedNoticePolicy:"finish_accepted",nativeEntries:rules,notificationTargets:options.notificationTargets}};
  const runtime=Object.create(HouseholdDomainRuntime.prototype) as HouseholdDomainRuntime;Object.assign(runtime,{database,adapter,admission,config:policy,closed:false});runtime.configureNativePolicyReader(()=>({session:{scope:"per-sender"}}));
  return {database,origin,rule,rules,options,job,adapter,admission,event,context,policy,runtime,calls};
}
test("delivery lane is opaque, stable and separate from the originating conversation",()=>{
  const f=fixture();try{assert.equal(scheduleDeliveryIdentity(f.context.sessionKey)?.agentId,"main");assert.notEqual(f.job.sessionKey,f.job.owner.sessionKey);assert.equal(scheduleDeliverySessionKey("main",f.job.declarationKey),f.job.sessionKey);assert.equal(scheduleDeliveryIdentity("agent:main:discord:fixture-origin"),null);}finally{f.database.close();}
});
test("initial notice preparation checks current job owner, profile and route without reading message bodies",()=>{
  const f=fixture();try{
    const event=Object.defineProperty({to:f.event.to},"content",{get(){throw Error("message_body_inspected");}});
    assert.equal(f.admission.authorizeScheduledNotice(f.job,event,f.context,f.options,f.rules),true);
    assert.equal(f.admission.authorizeScheduledNotice(f.job,event,f.context,{...f.options,schedulingEnabled:false},f.rules),false);
    assert.equal(f.admission.authorizeScheduledNotice(f.job,event,f.context,{...f.options,queuedNoticePolicy:"recheck_each_attempt"},f.rules),false);
    assert.equal(f.admission.authorizeScheduledNotice(f.job,event,f.context,f.options,f.rules.filter(rule=>rule.channelId!=="fixture-private")),false);
    assert.equal(f.admission.authorizeScheduledNotice(f.job,{to:"channel:someone-else"},f.context,f.options,f.rules),false);
    f.database.setProfileStatus("alex","paused","Revoked fixture profile");assert.equal(f.admission.authorizeScheduledNotice(f.job,event,f.context,f.options,f.rules),false);
  }finally{f.database.close();}
});
test("operational notices use only the current protected notification destination",()=>{
  const f=fixture();try{
    assert.equal(f.admission.authorizeScheduledNotice(f.job,{to:"fixture-ops"},f.context,f.options,f.rules),true);
    assert.equal(f.admission.authorizeScheduledNotice(f.job,{to:"fixture-ops"},f.context,{...f.options,notificationTargets:{}},f.rules),false);
    assert.equal(f.admission.authorizeScheduledNotice({...f.job,declarationKey:"foreign-owner",sessionKey:f.context.sessionKey},f.event,f.context,f.options,f.rules),false);
  }finally{f.database.close();}
});
test("runtime notice veto reads fresh protected policy after exact native job lookup",async()=>{
  const f=fixture();try{
    let current=f.policy;f.runtime.configureScheduledDeliveryPolicyReader(async()=>current);
    assert.equal(await f.runtime.guardScheduledDelivery(f.event,f.context),undefined);
    assert.equal(f.calls[0].method,"cron.list");assert.equal((f.calls[0].params as any).sessionKey,f.context.sessionKey);
    current={...f.policy,execution:{...f.policy.execution,nativeEntries:[],notificationTargets:{}}};
    assert.equal((await f.runtime.guardScheduledDelivery(f.event,f.context))?.cancel,true);
    f.runtime.configureNativePolicyReader(()=>({session:{scope:"global"}}));
    assert.equal((await f.runtime.guardScheduledDelivery(f.event,f.context))?.cancel,true);
  }finally{f.database.close();}
});
test("strict retry authorization cannot activate through the installed preparation-only SDK",async()=>{
  const rpc:NativeRpcPort={async request(_method,params){return {job:{id:"fixture-created",...params}};}};
  const schedules=new ScheduleDomain({allowActivation:true,scheduledTools:[],queuedNoticePolicy:"recheck_each_attempt"},rpc);
  const context:NativeDomainContext={profileId:"alex",agentId:"main",sessionKey:"agent:main:fixture",conversationId:"fixture-conversation",audience:"private",allowedScopes:["personal"],authorizedAttendees:[],deliveryTarget:{channel:"discord",to:"channel:fixture-private",audience:"private"},assertCurrent(){}};
  const args={operationId:"notice-policy-001",scope:"personal",name:"Notice",message:"Prepare result",schedule:{kind:"at",at:"2026-12-01T12:00:00-05:00"},enabled:true};
  await assert.rejects(()=>schedules.execute("household_schedule_create",args,context),{code:"native_scheduled_delivery_retry_guard_unavailable"});
  const global=new ScheduleDomain({allowActivation:true,scheduledTools:[],queuedNoticePolicy:"finish_accepted",deliveryScopeReady:()=>false},rpc);
  await assert.rejects(()=>global.execute("household_schedule_create",args,context),{code:"native_scheduled_delivery_scope_unavailable"});
});
test("owner-filtered list pagination advances past unrelated native delivery lanes",async()=>{
  const f=fixture();try{
    const rpc:NativeRpcPort={async request(_method,params){assert.equal(params.sessionKey,undefined);return {jobs:[{...f.job,declarationKey:"unrelated"}],hasMore:true,nextOffset:1};}};
    const schedules=new ScheduleDomain({allowActivation:false,scheduledTools:[]},rpc),context:NativeDomainContext={profileId:"alex",agentId:"main",sessionKey:f.origin.sessionKey,conversationId:f.origin.id,audience:"private",allowedScopes:["personal"],authorizedAttendees:[],assertCurrent(){}};
    const read=await schedules.execute("household_schedule_list",{limit:1},context) as any;assert.equal(read.jobs.length,0);assert.equal(read.nextOffset,1);
  }finally{f.database.close();}
});


test("installed native preparation suppresses revoked scheduled notices before provider eligibility",{
  skip:!process.env.OPENCLAW_TEST_PACKAGE_ROOT&&"Set OPENCLAW_TEST_PACKAGE_ROOT for installed SDK preparation verification",
},async()=>{
  const f=fixture();let platformCalls=0;
  try{
    const dist=path.join(process.env.OPENCLAW_TEST_PACKAGE_ROOT!,"dist");
    // Private chunk names deliberately pin this integration proof to installed 2026.9.8.
    const {t:prepare}=await import(pathToFileURL(path.join(dist,"deliver-prepare-dnJ48fDC.mjs")).href);
    const {u:scoped}=await import(pathToFileURL(path.join(dist,"gateway-request-scope-Da9jAC9_.mjs")).href);
    const {createHookRunner}=await import(pathToFileURL(path.join(dist,"hooks-DDz9qHFx.mjs")).href);
    const hooks=new Map<string,Function>();
    const api={id:"hardy-household",config:{plugins:{entries:{"hardy-household":{hooks:{allowConversationAccess:true,allowPromptInjection:true}}}}},
      on(name:string,handler:Function){hooks.set(name,handler);},registerHook(){},registerTool(){},registerTrustedToolPolicy(){},logger:{error(){},info(){}}};
    registerNativeTaskBridge(api,{catalog:()=>[],isManagedAgent:()=>true,guardScheduledDelivery:(event:any,context:any)=>f.runtime.guardScheduledDelivery(event,context)});
    let observed:any,current=f.policy;f.runtime.configureScheduledDeliveryPolicyReader(async()=>current);
    const registry={channels:[{plugin:{id:"discord",outbound:{sendText:async()=>{platformCalls++;throw Error("unexpected_platform_send");}}}}],
      typedHooks:[{pluginId:"hardy-household",hookName:"message_sending",handler:async(event:any,context:any)=>{observed={event,context};return hooks.get("message_sending")!(event,context);}}],hooks:[],plugins:[]};
    const run=()=>scoped(registry,()=>prepare({cfg:{},channel:"discord",to:"channel:fixture-private",session:{key:f.context.sessionKey},payloads:[{text:"Fixture scheduled result"}]},{hookRunner:createHookRunner(registry,{catchErrors:false})}));
    const allowed=await run();assert.equal(observed.context.sessionKey,f.context.sessionKey);assert.equal(platformCalls,0);
    assert.equal(allowed.entries.length,1);assert.notEqual(allowed.entries[0].status,"suppressed");
    current={...f.policy,execution:{...f.policy.execution,nativeEntries:[],notificationTargets:{}}};
    const denied=await run();assert.equal(platformCalls,0);assert.equal(observed.event.to,"channel:fixture-private");
    assert.equal(denied.entries.length,1);assert.equal(denied.entries[0].status,"suppressed");assert.equal(denied.entries[0].reason,"cancelled_by_message_sending_hook");
    // Preparation only: no provider send, native durable queue write, or retry is exercised here.
  }finally{f.database.close();}
});
