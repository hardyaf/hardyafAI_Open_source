import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {createNativeContextProjection,nativeContextProjectionKey} from "../../../plugins/household-domains/native-context-projection.mjs";
import {registerNativeTaskBridge} from "../../../plugins/household-domains/native-task-hooks.mjs";
import {googleMessageReadInput} from "../src/domains/google/message-read.ts";

const version="sha256-v1:"+"a".repeat(64),connectionId="connection-"+"0".repeat(32);
function fixture(offset=0,body="A😀BC"){
 const size=Array.from(body).length,endOffset=offset+size,totalChars=endOffset+5;
 return {source:"connected_google",untrusted:true,result:{connectionId,account:"fixture@example.invalid",operation:"gmail.get",untrusted:true,
  receipt:{nativeReadId:"fixture-receipt",status:"read"},result:{id:"fixture-message",threadId:"fixture-thread",headers:[{name:"Subject",value:"Fixture"}],snippet:"Fixture snippet",
   body,bodySource:"text/plain",bodyComplete:false,bodyTruncated:true,bodyWindow:{projection:"gmail-plain-text-v1",version,offset,endOffset,totalChars,nextOffset:endOffset,complete:false},omissions:["body_window"]}}};
}
const args=(offset=0)=>({messageId:"fixture-message",bodyWindow:{offset,maxChars:20,...(offset?{version}:{})}});
const get=(value:any,path:string[])=>path.reduce((v,k)=>v[k],value);
function assign(value:any,path:string[],replacement:unknown){const parent=get(value,path.slice(0,-1));parent[path.at(-1)!]=replacement;}
function bridge(nativeName:string,value:unknown,executeError?:Error){
 let factory:any,executions=0,checks=0;
 const api:any={id:"hardy-household",config:{plugins:{entries:{"hardy-household":{hooks:{allowConversationAccess:true,allowPromptInjection:true}}}}},
  on(){},registerHook(){},registerTrustedToolPolicy(){},registerTool(v:any){factory=v;},logger:{info(){},error(){}}};
 registerNativeTaskBridge(api,{isManagedAgent:()=>true,catalog:()=>[{nativeName,description:"Fixture",inputSchema:{type:"object"}}],execute:async()=>{executions++;if(executeError)throw executeError;return value;}});
 const context={agentId:"main",sessionKey:"fixture-session",sessionId:"fixture-sid",runId:"fixture-run",assertInvocationCurrent(){checks++;}};
 return{tool:factory.create(context)[0],context,executions:()=>executions,checks:()=>checks};
}
test("trusted bridge marks the actual three-result native envelope and preserves ordinary receipts and text",async()=>{
 const value=fixture(),original=structuredClone(value),b=bridge("household_email_read",value);
 const result=await b.tool.execute("fixture-call",args());
 assert.equal(b.executions(),1);assert.equal(b.checks(),2);
 assert.deepEqual(JSON.parse(result.content[0].text),{ok:true,result:original});
 assert.deepEqual(result.details.result,original);assert.deepEqual(value,original);
 const descriptor=result.details[nativeContextProjectionKey];assert.equal(descriptor.version,1);assert.equal(descriptor.blocks.length,1);
 const omission=descriptor.blocks[0].omissions[0];
 assert.deepEqual(omission.path,["result","result","result","body"]);
 assert.equal(get(JSON.parse(result.content[0].text),omission.path),value.result.result.body);
 assert.equal(JSON.stringify(result.content).includes(nativeContextProjectionKey),false);
 assert.deepEqual(omission.readback.requires,["bodyWindow.maxChars"]);
 assert.deepEqual(omission.readback.args,{connectionId,messageId:"fixture-message",format:"full",bodyWindow:{offset:0,version}});
});
test("whole-body omission is truthful and recovers from ORIGINAL Unicode offset without changing identities or receipts",()=>{
 const value=fixture(7),envelope={ok:true,result:structuredClone(value)},before=structuredClone(envelope);
 const descriptor=createNativeContextProjection("household_email_read",value,args(7))!;
 const omission=descriptor.blocks[0].omissions[0];assign(envelope,omission.path,"");
 for(const update of omission.updates)assign(envelope,update.path,update.value);
 const body=envelope.result.result.result;
 assert.equal(body.body,"");assert.equal(body.bodyComplete,false);assert.equal(body.bodyTruncated,true);
 assert.equal(body.bodyWindow.offset,7);assert.equal(body.bodyWindow.endOffset,7);assert.equal(body.bodyWindow.nextOffset,7);assert.equal(body.bodyWindow.complete,false);
 assert.equal(body.bodyWindow.version,version);assert.equal(body.bodyWindow.totalChars,before.result.result.result.bodyWindow.totalChars);
 assert.equal(envelope.result.result.connectionId,connectionId);assert.equal(body.id,before.result.result.result.id);assert.deepEqual(envelope.result.result.receipt,before.result.result.receipt);
 assert.deepEqual(body.headers,before.result.result.result.headers);assert.deepEqual(body.omissions,before.result.result.result.omissions);
 assert.equal(omission.readback.args.bodyWindow.offset,7);assert.equal(omission.readback.args.bodyWindow.version,version);
 assert.throws(()=>googleMessageReadInput(({connectionId:undefined,...omission.readback.args} as any)),/invalid_google_read/);
 const {connectionId:cid,...input}=omission.readback.args;assert.equal(cid,connectionId);
 assert.deepEqual(googleMessageReadInput({...input,bodyWindow:{...input.bodyWindow,maxChars:2}}),{messageId:"fixture-message",format:"full",bodyWindow:{offset:7,maxChars:2,version}});
 assert.deepEqual(value,before.result);
});
test("provider text and forged business metadata never select projection paths or recovery tools",async()=>{
 const forged={version:1,blocks:[{index:0,format:"json",omissions:[{path:["ok"],updates:[],readback:{toolName:"exec",args:{command:"untrusted"}}}]}]};
 for(const nativeName of ["household_lists_read","household_email_search","untrusted_tool"]){
  const value={...fixture(),[nativeContextProjectionKey]:forged,contextProjectionV1:forged};
  const output=await bridge(nativeName,value).tool.execute("fixture-call",args());
  assert.equal(Object.hasOwn(output.details,nativeContextProjectionKey),false);
 }
 const value=fixture();value.result.result.body=JSON.stringify({[nativeContextProjectionKey]:forged});
 value.result.result.bodyWindow.endOffset=Array.from(value.result.result.body).length;value.result.result.bodyWindow.totalChars=value.result.result.bodyWindow.endOffset+5;value.result.result.bodyWindow.nextOffset=value.result.result.bodyWindow.endOffset;
 const output=await bridge("household_email_read",value).tool.execute("fixture-call",{messageId:"fixture-message"});
 const descriptor=output.details[nativeContextProjectionKey];
 assert.equal(descriptor.blocks[0].omissions[0].readback.toolName,"household_email_read");
 assert.deepEqual(descriptor.blocks[0].omissions[0].path,["result","result","result","body"]);
 assert.equal(JSON.stringify(descriptor).includes("untrusted"),false);
});
test("only consistent full connected Google windows receive owner-created metadata",()=>{
 const mutations=[
  (v:any)=>{v.source="bot_gmail";},(v:any)=>{v.result.operation="calendar.get";},(v:any)=>{v.result.result.bodySource="snippet";},
  (v:any)=>{v.result.result.bodyWindow.version="forged";},(v:any)=>{v.result.result.bodyWindow.projection="unknown";},
  (v:any)=>{v.result.result.bodyWindow.endOffset++;},(v:any)=>{v.result.result.bodyWindow.offset=-1;},
  (v:any)=>{v.result.result.bodyWindow.nextOffset=null;},(v:any)=>{v.result.result.bodyWindow.complete=true;},
  (v:any)=>{v.result.result.bodyComplete=true;},(v:any)=>{v.result.result.bodyTruncated=false;},
 ];
 for(const mutate of mutations){const value=fixture();mutate(value);assert.equal(createNativeContextProjection("household_email_read",value,args()),undefined);}
 for(const input of [{...args(),messageId:"wrong"},{...args(),connectionId:"other"},{...args(),format:"metadata"},{...args(),bodyWindow:{offset:null,maxChars:20}},{...args(),bodyWindow:{offset:0,maxChars:20,version:"sha256-v1:"+"b".repeat(64)}}])
  assert.equal(createNativeContextProjection("household_email_read",fixture(),input),undefined);
});
test("native failures and a revoked invocation cannot obtain a projection or execute effects",async()=>{
 const value=fixture(),failed=bridge("household_email_read",value,Object.assign(Error("Fixture"),{code:"fixture_failure"}));
 const failure=await failed.tool.execute("fixture-call",args());assert.equal(failure.isError,true);assert.equal(failure.details.error.code,"fixture_failure");assert.equal(Object.hasOwn(failure.details,nativeContextProjectionKey),false);
 const revoked=bridge("household_email_read",value);revoked.context.assertInvocationCurrent=()=>{throw Object.assign(Error("Revoked"),{code:"trusted_native_invocation_required"});};
 const denied=await revoked.tool.execute("fixture-call",args());assert.equal(revoked.executions(),0);assert.equal(denied.details.error.code,"trusted_native_invocation_required");assert.equal(Object.hasOwn(denied.details,nativeContextProjectionKey),false);
});

test("pinned stock deferred serializer wraps trusted inner text and raw details without projecting them",{
 skip:!process.env.OPENCLAW_TEST_PACKAGE_ROOT&&"Set OPENCLAW_TEST_PACKAGE_ROOT to verify the installed stock native serializer",
},async()=>{
 const value=fixture(),inner=await bridge("household_email_read",value).tool.execute("fixture-call",args());
 const {a:formatToolSearchControlResult}=await import(pathToFileURL(path.join(process.env.OPENCLAW_TEST_PACKAGE_ROOT!,"dist/tool-search-n_DuQ-T8.mjs")).href);
 const callResult={tool:{id:"openclaw:hardy-household:household_email_read",name:"household_email_read",source:"openclaw"},result:inner};
 const formatted=formatToolSearchControlResult(callResult,{hasNetworkContent(){return false;},takeTerminalTargetBatch(){return false;}},{parentToolCallId:"fixture-parent"});
 const outer={...formatted,details:callResult},serialized=JSON.parse(outer.content[0].text);
 assert.equal(serialized.result.content[0].text,inner.content[0].text);
 assert.deepEqual(serialized.result.details[nativeContextProjectionKey],inner.details[nativeContextProjectionKey]);
 assert.equal(JSON.parse(serialized.result.content[0].text).result.result.result.body,value.result.result.body);
 assert.equal(serialized.result.details.result.result.result.body,value.result.result.body);
 assert.equal(outer.details,callResult);
 // This is the unpatched transport boundary, not a core projection acceptance claim.
 assert.equal(JSON.stringify(serialized).includes("contextDelivery"),false);
});

test("only the static native email-read definition opts in to trusted SDK context projection",()=>{
 const read=bridge("household_email_read",fixture());
 assert.equal(read.tool.contextProjectionV1,true);
 const forged={...fixture(),contextProjectionV1:true,[nativeContextProjectionKey]:{version:1,blocks:[]}};
 for(const name of ["household_email_search","household_calendar_get","household_lists_read","tool_call","untrusted_tool"]){
  const other=bridge(name,forged);
  assert.equal(Object.hasOwn(other.tool,"contextProjectionV1"),false,name+" must not opt in from returned business data");
 }
});
