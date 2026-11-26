import test from "node:test";
import assert from "node:assert/strict";
import { HouseholdDatabase } from "../src/database.ts";
import { ExecutionAuthorityRepository,parseMessageTaskContext } from "../src/request-context.ts";
import { AnalysisAdmissionBindings } from "../src/domain-runtime/analysis-admission.ts";
import type { AnalysisFlowContext,NativeAnalysisRequest } from "../src/analysis-flow/types.ts";

function fixture(){
  const database=new HouseholdDatabase(":memory:");database.insertConversation({id:"analysis-admission-chat",ownerProfileId:"alex",agentId:"main",sessionKey:"analysis-session",title:"Fixture",presetId:null,audience:"private",updatedAt:new Date().toISOString()});
  const context:AnalysisFlowContext={principal:{profileId:"alex",canReadHousehold:true},scope:{ownerProfileId:"alex",conversationId:"analysis-admission-chat",taskId:"conversation:analysis-admission-chat",audience:"private"},native:{sessionId:"parent-sid",sessionKey:"analysis-session",goalId:null,goalStatus:null,objective:null,runId:"parent-run"},source:{id:"user:source-a",text:"Analyze this",sha256:"a".repeat(64),human:true},artifactIds:[],mode:"normal",assertCurrent(){},execution:{agentId:"main",sessionKey:"analysis-session",sessionId:"parent-sid",runId:"parent-run",sandboxed:false}};
  const request:NativeAnalysisRequest={requestArtifactId:"artifact-"+"b".repeat(64),task:"Analyze supplied input",taskName:"analysis_a",label:"Analysis",agentId:"household-analysis",runtime:"subagent",mode:"run",cleanup:"keep",sandbox:"require",context:"isolated",completionTarget:"parent",visible:false,thread:false,expectsCompletionMessage:true,attachments:[]};
  return {database,context,request,bindings:new AnalysisAdmissionBindings(new ExecutionAuthorityRepository(database.domainConnection()))};
}
test("analysis admission links the exact source, request, native key and run without respawning",async()=>{
  const f=fixture();try{
    let calls=0;const spawn=async()=>{calls++;return {state:"accepted" as const,childSessionKey:"child-key",runId:"child-run"};};
    await f.bindings.spawn(f.context,f.request,spawn);await f.bindings.spawn(f.context,f.request,spawn);assert.equal(calls,1);
    assert.equal(f.bindings.matches(f.context,f.request.requestArtifactId,"child-key","child-run"),true);
    assert.equal(f.bindings.matches(f.context,f.request.requestArtifactId,"sibling-key","child-run"),false);
    assert.equal(f.bindings.matches({...f.context,source:{...f.context.source,id:"user:next-source"}},f.request.requestArtifactId,"child-key","child-run"),false);
  }finally{f.database.close();}
});
test("an interrupted native spawn retains unknown admission and cannot replay",async()=>{
  const f=fixture();try{
    let calls=0;const spawn=async()=>{calls++;throw Error("response lost");};
    await assert.rejects(()=>f.bindings.spawn(f.context,f.request,spawn),/response lost/);
    await assert.rejects(()=>f.bindings.spawn(f.context,f.request,spawn),/analysis_admission_outcome_unknown/);assert.equal(calls,1);
  }finally{f.database.close();}
});
test("HTTP clients cannot supply independent-topic or scheduled-delivery authority",()=>{
  const packet=parseMessageTaskContext({mode:"conversation",independentTopicOf:"forged-goal",independentSourcePromptId:"other-person",scheduledScope:"household",scheduledDelivery:{mode:"announce",channel:"discord",to:"channel:wrong"}});
  assert.equal(packet.independentTopicOf,undefined);assert.equal(packet.independentSourcePromptId,undefined);assert.equal(packet.scheduledDelivery,undefined);
});
