import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {registerNativeTaskBridge} from "../../../plugins/household-domains/native-task-hooks.mjs";

function fixture(){
  const descriptors=[
    {name:"analysis.publish_output",nativeName:"household_analysis_publish_output",domain:"analysis",description:"Publish the exact sandbox output",inputSchema:{type:"object",additionalProperties:false,properties:{requestArtifactId:{type:"string"},relativePath:{type:"string"}},required:["requestArtifactId","relativePath"]}},
    {name:"task.context",nativeName:"household_task_context",domain:"task",description:"Current context",inputSchema:{type:"object",additionalProperties:false}},
    {name:"task.select_domains",nativeName:"household_task_select_domains",domain:"task",description:"Selected schemas",inputSchema:{type:"object",properties:{domains:{type:"array",items:{type:"string"}}},required:["domains"]}},
    {name:"task.complete",nativeName:"household_task_complete",domain:"task",description:"Verified completion",inputSchema:{type:"object",properties:{summary:{type:"string"}},required:["summary"]}},
    {name:"lists.capture",nativeName:"household_lists_capture",domain:"lists",description:"Save granted list items",inputSchema:{type:"object",properties:{items:{type:"array",items:{type:"object"}}},required:["items"]}},
    {name:"contacts.get",nativeName:"household_contacts_get",domain:"contacts",description:"Private restricted contact",inputSchema:{type:"object",properties:{contactId:{type:"string"}},required:["contactId"]}},
  ];
  let factory:{create:Function}|undefined;
  const calls:{name:string;args:unknown;context:Record<string,unknown>}[]=[];
  const api={id:"hardy-household",config:{plugins:{entries:{"hardy-household":{hooks:{allowConversationAccess:true,allowPromptInjection:true}}}}},
    on(){},registerHook(){},registerTrustedToolPolicy(){},registerTool(value:{create:Function}){factory=value;},logger:{info(){},error(){}}};
  const ports={isManagedAgent:()=>true,
    catalog(context?:Record<string,unknown>){
      if(!context)return descriptors;
      if(context.agentId==="household-analysis")return descriptors.filter(value=>value.domain==="analysis");
      return descriptors.filter(value=>!["contacts","analysis"].includes(value.domain));
    },
    execute:async(name:string,args:unknown,context:Record<string,unknown>)=>{calls.push({name,args,context});return {state:"committed"};},
    admitNativeTurn:async()=>{},bindInvocation:async()=>{},registerNativeChild:async()=>{},getTaskContext:async()=>({assertCurrent(){}}),
    prompt:async()=>({}),finalize:async()=>undefined,guard:async()=>({allow:true}),bootstrapAccess:async()=>"unknown"};
  registerNativeTaskBridge(api,ports);
  return {descriptors,calls,create:(context:Record<string,unknown>)=>factory!.create(context)};
}

test("all scoped tools remain catalogable including the small coordination surface",()=>{
  const f=fixture(),tools=f.create({agentId:"main",sessionKey:"current-session",assertInvocationCurrent(){}});
  assert.equal(tools.some((value:{catalogMode?:string})=>value.catalogMode==="direct-only"),false,"Known-name calls must not disappear from Tool Search");
  assert.deepEqual(tools.map((value:{name:string})=>value.name).sort(),
    ["household_lists_capture","household_task_complete","household_task_context","household_task_select_domains"]);
  for(const tool of tools)assert.deepEqual(tool.parameters,f.descriptors.find(value=>value.nativeName===tool.name)!.inputSchema,"Catalog exposure retains exact typed inputs");
  const list=tools.find((value:{name:string})=>value.name==="household_lists_capture");
  assert.ok(list);assert.notEqual(list.catalogMode,"direct-only");
  assert.deepEqual(list.parameters,f.descriptors.find(value=>value.name==="lists.capture")!.inputSchema);
  assert.equal(tools.some((value:{name:string})=>value.name==="household_contacts_get"),false,"static registration names must not leak an omitted scoped schema");
});

test("catalogable coordination tools retain exact current invocation checks",async()=>{
  const f=fixture();let current=true;
  const context={agentId:"main",sessionKey:"current-session",assertInvocationCurrent(){if(!current)throw Object.assign(Error("expired"),{code:"invocation_expired"});}};
  const tool=f.create(context).find((value:{name:string})=>value.name==="household_task_complete");
  assert.notEqual(tool.catalogMode,"direct-only");
  await tool.execute("actual-call",{summary:"Done"});
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,"household_task_complete");assert.equal(f.calls[0].context.toolCallId,"actual-call");assert.equal(f.calls[0].context.sessionKey,"current-session");
  current=false;
  const expired=await tool.execute("stale-call",{summary:"Invented completion"});
  assert.equal(expired.isError,true);assert.equal(f.calls.length,1);
});


test("the fixed analysis publisher is direct with its typed schema and current invocation fence",async()=>{
  const f=fixture();let current=true;
  const [publisher]=f.create({agentId:"household-analysis",sessionKey:"fixture-child",assertInvocationCurrent(){if(!current)throw Error("invocation_expired");}});
  assert.equal(publisher.name,"household_analysis_publish_output");assert.equal(publisher.catalogMode,"direct-only");
  assert.deepEqual(publisher.parameters,f.descriptors.find(item=>item.name==="analysis.publish_output")!.inputSchema);
  const args={requestArtifactId:"artifact-"+"a".repeat(64),relativePath:"outputs/chart.png"};
  await publisher.execute("fixture-publish",args);assert.deepEqual(f.calls[0].args,args);
  current=false;assert.equal((await publisher.execute("fixture-expired",args)).isError,true);assert.equal(f.calls.length,1);
});


test("installed native compaction keeps the actual analysis publisher on the direct surface",{
  skip:!process.env.OPENCLAW_TEST_PACKAGE_ROOT&&"Set OPENCLAW_TEST_PACKAGE_ROOT for installed SDK compaction verification",
},async()=>{
  const dist=path.join(process.env.OPENCLAW_TEST_PACKAGE_ROOT!,"dist");
  // Provider-free partition from the pinned installed OpenClaw 2026.9.8 SDK.
  const {d:compact}=await import(pathToFileURL(path.join(dist,"tool-search-n_DuQ-T8.mjs")).href);
  const [publisher]=fixture().create({agentId:"household-analysis",sessionKey:"fixture-child",assertInvocationCurrent(){}});
  const control={name:"tool_search"};
  function partition(tool:any){
    const catalogRef:any={};
    const surface=compact({enabled:true,tools:[control,tool],catalogRef,isVisibleControlTool:(value:any)=>value===control});
    assert.equal(surface.catalogRegistered,true);
    return {direct:surface.tools.includes(tool),catalogCount:catalogRef.current.entries.length};
  }
  assert.deepEqual(partition(publisher),{direct:true,catalogCount:0});
  const {catalogMode,...deferred}=publisher;
  assert.deepEqual(partition(deferred),{direct:false,catalogCount:1});
});
