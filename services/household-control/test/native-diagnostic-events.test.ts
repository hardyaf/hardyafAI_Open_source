import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { ArtifactStore } from "../src/platform/artifacts.ts";
import { captureNativeDiagnosticEvent,readNativeDiagnosticEvents,diagnosticEventLimit } from "../src/domain-runtime/native-diagnostic-events.ts";
import { projectNativeDiagnosticEvent,registerNativeDiagnosticHooks } from "../../../plugins/household-domains/native-diagnostic-hooks.mjs";

const context={agentId:"main",sessionKey:"agent:main:fixture",sessionId:"session-a",runId:"run-a",contextTokenBudget:32000};
const scope={ownerProfileId:"alex",conversationId:"conversation-a"};
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
async function fixture(t:any){
  const root=await mkdtemp(path.join(os.tmpdir(),"native-diagnostic-evidence-"));t.after(()=>rm(root,{recursive:true,force:true}));
  const artifacts=new ArtifactStore({root});await artifacts.initialize();
  return {root,artifacts,scope,sourceId:"source-a",assertCurrent(){}};
}
test("actual native event shapes project termination and compaction metadata without private content",()=>{
  const secret="private-prompt-response-token";
  const ended=projectNativeDiagnosticEvent("model_call_ended",{runId:"run-a",callId:"call-a",durationMs:42,outcome:"error",failureKind:"connection_reset",errorCategory:secret,prompt:secret,response:secret,requestPayloadBytes:123},context);
  assert.equal(ended.failureKind,"connection_reset");assert.equal(ended.errorCategory,"provider_error");assert.equal(ended.metrics.durationMs,42);
  const compacted=projectNativeDiagnosticEvent("after_compaction",{messageCount:10,compactedCount:8,tokenCount:450,sessionFile:secret,messages:[secret],previousSessionId:"session-before"},context);
  assert.deepEqual(compacted.metrics,{contextWindowTokens:32000,messageCount:10,compactedMessageCount:8,tokenCount:450});
  assert.equal(compacted.previousSessionId,"session-before");
  const output=projectNativeDiagnosticEvent("llm_output",{runId:"run-a",sessionId:"session-a",assistantTexts:[secret],prompt:secret,lastAssistant:{stopReason:"max_tokens",errorMessage:secret,content:secret},usage:{input:1500,output:20,cacheRead:100}},context);
  assert.equal(output.finishReason,"max_tokens");assert.equal(output.metrics.inputTokens,1500);
  assert.equal(JSON.stringify([ended,compacted,output]).includes(secret),false);
  assert.equal(projectNativeDiagnosticEvent("model_call_ended",{runId:"different-run"},context),undefined);
});
test("native capture failure is passive and reports only a fixed non-secret warning",async()=>{
  const handlers=new Map<string,Function>(),logs:string[]=[];
  registerNativeDiagnosticHooks({on(name:string,handler:Function){handlers.set(name,handler);},logger:{warn(value:string){logs.push(value);}}},
    {isManagedAgent:()=>true,observe:async()=>{throw Error("private provider error");}});
  assert.deepEqual([...handlers.keys()].sort(),["after_compaction","llm_output","model_call_ended"]);
  await handlers.get("model_call_ended")!({runId:"run-a",callId:"call-a",outcome:"error",durationMs:1},context);
  assert.equal(logs.length,1);assert.equal(logs[0].includes("private"),false);
});
test("native evidence uses existing private immutable artifacts and survives process-object restart",async(t)=>{
  const f=await fixture(t),event=projectNativeDiagnosticEvent("model_call_ended",{runId:"run-a",callId:"call-a",outcome:"error",durationMs:42,failureKind:"timeout"},context);
  assert.equal((await captureNativeDiagnosticEvent({...f,observation:event})).recorded,true);
  const afterRestart=new ArtifactStore({root:f.root});await afterRestart.initialize();
  assert.equal((await captureNativeDiagnosticEvent({...f,artifacts:afterRestart,observation:{...event,at:new Date(Date.now()+100).toISOString()}})).replayed,true);
  const read=await readNativeDiagnosticEvents({...f,artifacts:afterRestart,runId:"run-a"});
  assert.equal(read.records.length,1);assert.equal(read.records[0].failureKind,"timeout");assert.equal(read.truncated,false);
  assert.deepEqual((await readNativeDiagnosticEvents({...f,runId:"other-run"})).records,[]);
  assert.deepEqual((await readNativeDiagnosticEvents({...f,scope:{...scope,ownerProfileId:"natasha"},runId:"run-a"})).records,[]);
  await assert.rejects(()=>captureNativeDiagnosticEvent({...f,observation:{...event,metrics:{durationMs:99}}}),/diagnostic_native_event_conflict/);
});
test("diagnostic capture is bounded without limiting productive native work",async(t)=>{
  const f=await fixture(t),template=projectNativeDiagnosticEvent("after_compaction",{messageCount:10,compactedCount:8},context);
  for(let index=0;index<diagnosticEventLimit;index++)assert.equal((await captureNativeDiagnosticEvent({...f,observation:{...template,observationId:hash(String(index))}})).recorded,true);
  assert.deepEqual(await captureNativeDiagnosticEvent({...f,observation:{...template,observationId:hash("overflow")}}),{recorded:false,captureLimit:true});
  const read=await readNativeDiagnosticEvents({...f,runId:"run-a"});assert.equal(read.records.length,diagnosticEventLimit);assert.equal(read.truncated,true);
});

test("concurrent response-lost metadata delivery retains one immutable observation",async(t)=>{
  const f=await fixture(t),event=projectNativeDiagnosticEvent("model_call_ended",{runId:"run-a",callId:"concurrent-call",outcome:"completed",durationMs:42},context);
  await Promise.all([captureNativeDiagnosticEvent({...f,observation:event}),captureNativeDiagnosticEvent({...f,observation:{...event,at:new Date(Date.now()+100).toISOString()}})]);
  assert.equal((await readNativeDiagnosticEvents({...f,runId:"run-a"})).records.length,1);
});
