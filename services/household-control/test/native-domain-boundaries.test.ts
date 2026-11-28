// Written for the consolidated post-Slice-3 campaign; not executed during Slice 2.
import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,rm,symlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {GoogleDomain,ListDomain,MemoryDomain,ScheduleDomain,WorkspaceMemorySources,googleTools,listTools,memoryTools,scheduleTools,resolveCalendarTime} from "../src/domains/native-domains.ts";
import type {NativeDomainContext,NativeJsonRunner,NativeRpcPort} from "../src/domains/native-contracts.ts";

function context(overrides:Partial<NativeDomainContext>={}):NativeDomainContext {
  return {profileId:"adult-example",agentId:"main",sessionKey:"agent:main:example",conversationId:"conversation-example",audience:"private",allowedScopes:["personal","household"],authorizedAttendees:[],assertCurrent(){},...overrides};
}
const googleConfig={gogBinary:"/trusted/gog",account:"bot@example.test",client:"house",calendarId:"house@example.test",timeZone:"America/New_York"};

test("all native domain effects require operation identity and expose closed schemas",()=>{
  const tools=[...listTools,...googleTools,...memoryTools,...scheduleTools];
  assert.equal(new Set(tools.map(tool=>tool.name)).size,tools.length);
  for(const tool of tools) {
    assert.equal(tool.inputSchema.additionalProperties,false);
    const properties=tool.inputSchema.properties as Record<string,unknown>;
    for(const forbidden of ["shell","command","account","client","agentId","sessionKey","accessToken","token","path"])assert.equal(properties[forbidden],undefined,tool.name+":"+forbidden);
    if(properties.calendarId)assert.ok(properties.connectionId,tool.name+":calendar_requires_connection");
    if(tool.effect==="write")assert.ok((tool.inputSchema.required as string[]).includes("operationId"));
  }
});

test("calendar local-time resolution distinguishes DST gap and overlap",()=>{
  assert.equal(resolveCalendarTime("2026-03-08T02:30:00","America/New_York").status,"nonexistent");
  const overlap=resolveCalendarTime("2026-11-01T01:30:00","America/New_York");
  assert.equal(overlap.status,"ambiguous");assert.equal(overlap.candidates.length,2);
  assert.equal(resolveCalendarTime("2026-11-03T16:00:00","America/New_York").status,"unique");
});

test("Google adapter pins identity, scopes mailbox reads and accepts provider queries as data",async()=>{
  const calls:{binary:string;args:readonly string[];options:unknown}[]=[];
  const runner:NativeJsonRunner={async runJson(binary,args,options){calls.push({binary,args,options});return {threads:[]};}};
  const google=new GoogleDomain(googleConfig,runner);
  await google.execute("household_email_search",{query:"-is:read subject:school",limit:30},context());
  assert.equal(calls[0].binary,"/trusted/gog");
  assert.ok(calls[0].args.includes("--account=bot@example.test"));
  assert.ok(calls[0].args.includes("--client=house"));assert.ok(calls[0].args.includes("--readonly"));assert.ok(calls[0].args.includes("--gmail-no-send"));
  assert.deepEqual(calls[0].args.slice(-2),["--","-is:read subject:school"]);
  await assert.rejects(()=>google.execute("household_calendar_list",{from:"2026-11-01",to:"2026-12-01",calendarId:"other@example.test"},context()),{code:"invalid_arguments"});
  assert.equal(calls.length,1);
});

test("calendar attendees cannot be authorized by model input",async()=>{
  let commands=0;const runner:NativeJsonRunner={async runJson(){commands++;return {};}};
  const google=new GoogleDomain(googleConfig,runner);
  await assert.rejects(()=>google.execute("household_calendar_create",{operationId:"calendar-op-001",summary:"School event",start:"2026-11-03T16:00:00-05:00",end:"2026-11-03T17:00:00-05:00",attendees:["person@example.test"]},context()),{code:"attendee_not_authorized"});
  assert.equal(commands,0);
});

test('private owner authority removes a separate attendee ceremony while tool arguments cannot mint it',async()=>{
 let commands=0;const google=new GoogleDomain(googleConfig,{async runJson(){commands++;throw Error('synthetic_provider_stop');}});
 const args={operationId:'calendar-owner-001',summary:'Owner experiment',start:'2026-11-03T16:00:00-05:00',end:'2026-11-03T17:00:00-05:00',attendees:['person@example.test']};
 await assert.rejects(()=>google.execute('household_calendar_create',args,{...context(),ownerAutonomy:true}),/synthetic_provider_stop/);assert.ok(commands>0);
 const before=commands;await assert.rejects(()=>google.execute('household_calendar_create',{...args,ownerAutonomy:true},context()),{code:'invalid_arguments'});assert.equal(commands,before);
});

test("calendar create with unknown write result remains unknown instead of safe-to-retry",async()=>{
  const runner:NativeJsonRunner={async runJson(_binary,args){if(args.includes("events"))return {events:[]};return {unexpected:true};}};
  const google=new GoogleDomain(googleConfig,runner);
  await assert.rejects(()=>google.execute("household_calendar_create",{operationId:"calendar-op-002",summary:"School event",start:"2026-11-03T16:00:00-05:00",end:"2026-11-03T17:00:00-05:00"},context()),{code:"calendar_write_outcome_unknown",deliveryOutcome:"unknown"});
});

test("list adapter rejects private access in household context and removes operational paths",async()=>{
  const calls:{args:readonly string[];effect?:boolean}[]=[];
  const runner:NativeJsonRunner={async runJson(_binary,args,options){calls.push({args,effect:options.effect});return {ok:true,saved:[{id:"H-20261103-0001",path:"/private/native/path",text:"milk"}]};}};
  const lists=new ListDomain({python:"/trusted/python3",script:"/trusted/capture.py",workspaces:{main:"/native/main"}},runner);
  await assert.rejects(()=>lists.execute("household_lists_read",{scope:"personal"},context({audience:"household"})),{code:"scope_not_authorized"});
  assert.equal(calls.length,0);
  const result=await lists.execute("household_lists_capture",{operationId:"list-op-0001",items:[{kind:"shopping",scope:"household",text:"milk"}]},context());
  assert.equal(calls[0].effect,true);
  assert.equal(JSON.stringify(result).includes("/private/native/path"),false);
  assert.ok(calls[0].args.includes("--workspace"));
});

test("memory source quote grounding requires verified source text, not a source ID alone",async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),"native-memory-source-"));
  try {
    const sources=new WorkspaceMemorySources({main:directory});
    const bound=context({confirmedSourceIds:["user:source-1"],confirmedSourceText:{"user:source-1":"Please remember that Casey likes apples."}});
    const source=await sources.save("main","personal",{operationId:"memory-source-001",title:"Casey preference",text:"Casey likes apples.",sourceIds:["user:source-1"],certainty:"fact"},bound);
    assert.equal(source.certainty,"confirmed");
    const invented=await sources.save("main","personal",{operationId:"memory-source-002",title:"Casey preference",text:"Casey likes pears.",sourceIds:["user:source-1"],certainty:"fact"},bound);
    assert.equal(invented.certainty,"candidate");
    await assert.rejects(()=>sources.save("main","personal",{operationId:"memory-source-001",title:"Casey preference",text:"Casey likes pears.",sourceIds:["user:source-1"],certainty:"fact"},bound),{code:"memory_operation_conflict"});
    assert.equal((await sources.read("main","personal",source.id,bound)).text,"Casey likes apples.");
  }finally{await rm(directory,{recursive:true,force:true});}
});

test("native memory sources refuse a symlinked source tree",async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),"native-memory-path-"));
  try {
    await mkdir(path.join(directory,"elsewhere"));await symlink(path.join(directory,"elsewhere"),path.join(directory,"memory"));
    const sources=new WorkspaceMemorySources({main:directory});
    await assert.rejects(()=>sources.save("main","personal",{operationId:"memory-source-003",title:"Preference",text:"Apples",sourceIds:["user:source-1"],certainty:"fact"},context()),{code:"memory_source_path_unsafe"});
  }finally{await rm(directory,{recursive:true,force:true});}
});

test("native wiki routing never falls back from household to a private corpus",async()=>{
  const calls:{method:string;params:Record<string,unknown>;context:NativeDomainContext}[]=[];
  const rpc:NativeRpcPort={async request(method,params,requestContext){calls.push({method,params,context:requestContext});return [];}};
  const unused={async save(){throw Error("unused");},async read(){throw Error("unused");}};
  const memory=new MemoryDomain({enabled:true,sharedAgentId:"household-knowledge"},rpc,unused);
  const bound=context();await memory.execute("household_memory_search",{scope:"household",query:"School"},bound);
  assert.equal(calls[0].params.agentId,"household-knowledge");assert.equal(calls[0].params.backend,"local");assert.equal(calls[0].params.corpus,"wiki");assert.equal(calls[0].context,bound);
  await assert.rejects(()=>memory.execute("household_memory_search",{scope:"personal",query:"School"},context({audience:"household"})),{code:"scope_not_authorized"});
  assert.equal(calls.length,1);
});

test("schedule creation is declared natively but cannot activate unbound authority",async()=>{
  const calls:{method:string;params:Record<string,unknown>;context:NativeDomainContext}[]=[];
  const rpc:NativeRpcPort={async request(method,params,requestContext){calls.push({method,params,context:requestContext});return {job:{id:"job-1",...params}};}};
  const schedule=new ScheduleDomain({allowActivation:false,scheduledTools:[]},rpc);
  const bound=context({deliveryTarget:{channel:"discord",to:"channel:fixture-private",audience:"private"}});const input={operationId:"schedule-op-001",scope:"household",name:"Prepare list",message:"Prepare the household shopping list.",schedule:{kind:"at",at:"2026-12-01T12:00:00-05:00"}};
  await schedule.execute("household_schedule_create",input,bound);
  assert.equal(calls[0].method,"cron.add");assert.equal(calls[0].params.enabled,false);assert.deepEqual((calls[0].params.payload as {toolsAllow:unknown}).toolsAllow,[]);assert.deepEqual(calls[0].params.delivery,{mode:"announce",channel:"discord",to:"channel:fixture-private"});assert.equal(calls[0].context,bound);
  await assert.rejects(()=>schedule.execute("household_schedule_create",{...input,operationId:"schedule-op-002",enabled:true},bound),{code:"scheduled_authorization_not_configured"});assert.equal(calls.length,1);
});

test("schedule get with an unrelated native owner is hidden",async()=>{
  const rpc:NativeRpcPort={async request(){return {job:{id:"other-job",agentId:"other",owner:{agentId:"other",sessionKey:"other-session"},declarationKey:"unrelated"}};}};
  const schedule=new ScheduleDomain({allowActivation:false,scheduledTools:[]},rpc);
  await assert.rejects(()=>schedule.execute("household_schedule_get",{jobId:"other-job"},context()),{code:"schedule_not_found"});
});


test("schedule delivery uses only trusted scoped routes and explicit quiet work",async()=>{
  const calls:Record<string,unknown>[]=[];
  const rpc:NativeRpcPort={async request(_method,params){calls.push(params);return {job:{id:"job-delivery",...params}};}};
  const schedules=new ScheduleDomain({allowActivation:false,scheduledTools:[]},rpc);
  const input={operationId:"schedule-delivery-001",scope:"personal",name:"Reminder",message:"Tell me the result",schedule:{kind:"at",at:"2026-12-01T12:00:00-05:00"}};
  await assert.rejects(()=>schedules.execute("household_schedule_create",input,context()),{code:"schedule_delivery_destination_unavailable"});
  await assert.rejects(()=>schedules.execute("household_schedule_create",input,context({deliveryTarget:{channel:"discord",to:"channel:shared",audience:"household"}})),{code:"private_schedule_shared_delivery_forbidden"});
  await assert.rejects(()=>schedules.execute("household_schedule_create",{...input,delivery:{mode:"announce",to:"user:arbitrary"}},context()),{code:"invalid_arguments"});
  await schedules.execute("household_schedule_create",{...input,delivery:{mode:"none"}},context());
  assert.deepEqual(calls[0].delivery,{mode:"none"});
  await schedules.execute("household_schedule_create",{...input,operationId:"schedule-delivery-002",delivery:{mode:"announce",destination:"notifications"}},context({notificationTarget:{channel:"discord",to:"channel:protected",audience:"private"}}));
  assert.deepEqual(calls[1].delivery,{mode:"announce",channel:"discord",to:"channel:protected"});
  assert.equal(calls[1].enabled,false);
});

test("recoverable list removal needs current list authority without another approval",async()=>{
  let command:readonly string[]=[];
  const runner:NativeJsonRunner={async runJson(_binary,args){command=args;return {ok:true,id:"H-20261104-0001"};}};
  const lists=new ListDomain({python:"/trusted/python3",script:"/trusted/capture.py",workspaces:{main:"/native/main"}},runner);
  await lists.execute("household_lists_remove",{operationId:"remove-item-0001",scope:"household",id:"H-20261104-0001"},context({destructiveApproved:false}));
  assert.ok(command.includes("remove"));assert.ok(command.includes("--confirm"));
  await assert.rejects(()=>lists.execute("household_lists_remove",{operationId:"remove-item-0002",scope:"personal",id:"P-20261104-0001"},context({audience:"household"})),{code:"scope_not_authorized"});
});


test("schedule reads distinguish native nested execution and delivery state without raw errors",async()=>{
  let saved:Record<string,unknown>;
  const rpc:NativeRpcPort={async request(method,params){if(method==="cron.add"){saved={...params,id:"job-state"};return {job:saved};}return {job:{...saved,state:{lastRunStatus:"ok",lastDeliveryStatus:"unknown",lastRunAtMs:123,deliverySuppressionReason:"ambiguous",lastError:"private-provider-error"}}};}};
  const schedules=new ScheduleDomain({allowActivation:false,scheduledTools:[]},rpc),bound=context({deliveryTarget:{channel:"discord",to:"channel:fixture-private",audience:"private"}});
  await schedules.execute("household_schedule_create",{operationId:"schedule-state-001",scope:"personal",name:"Report",message:"Prepare report",schedule:{kind:"at",at:"2026-12-01T12:00:00-05:00"}},bound);
  const read=await schedules.execute("household_schedule_get",{jobId:"job-state"},bound) as {job:Record<string,unknown>};
  assert.equal(read.job.lastRunStatus,"ok");assert.equal(read.job.lastDeliveryStatus,"unknown");assert.equal(read.job.lastError,undefined);
});
