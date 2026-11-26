import {mkdtemp,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {ArtifactStore} from "../src/platform/artifacts.ts";
import {captureNativeDiagnosticEvent} from "../src/domain-runtime/native-diagnostic-events.ts";
import {projectNativeDiagnosticEvent} from "../../../plugins/household-domains/native-diagnostic-hooks.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { projectNativeDiagnosticObservation } from "../src/platform/diagnostic-native.ts";
import { readTaskDiagnosticEvidence } from "../src/domain-runtime/diagnostics.ts";
import { HouseholdDatabase } from "../src/database.ts";
import { ExecutionAuthorityRepository } from "../src/request-context.ts";

test("native diagnostics project only exact-run metadata and never provider or transcript text",()=>{
  const secret="PRIVATE provider token and user prose";
  const row={sessionId:"session-1",lastRunId:"run-1",status:"failed",contextTokens:32000,compactionCount:2,lastRunError:secret};
  const history={messages:[{role:"assistant",runId:"run-1",content:secret,errorMessage:secret,stopReason:"error",usage:{input:1000,cacheRead:500,cacheWrite:100}},
    {role:"assistant",runId:"run-2",stopReason:"max_tokens",usage:{input:9999}}]};
  const result=projectNativeDiagnosticObservation(row,history,"run-1");
  assert.equal(JSON.stringify(result).includes(secret),false);
  assert.deepEqual(result.context,{contextWindowTokens:32000,compactions:2,promptTokens:1600,headroomTokens:30400,finishReason:"error"});
  const old=projectNativeDiagnosticObservation(row,history,"run-old");
  assert.deepEqual(old.context,{});assert.equal(old.runMatched,false);
  assert.ok(old.unavailable.includes("historical_session_snapshot"));
});

test("missing native counters stay unavailable rather than fabricated zero",()=>{
  const result=projectNativeDiagnosticObservation({lastRunId:"run-1"},{messages:[{role:"assistant",usage:{input:42},stopReason:"stop"}]},"run-1");
  assert.deepEqual(result.context,{});
  assert.ok(result.unavailable.includes("compactions"));assert.ok(result.unavailable.includes("finishReason"));
});

test("diagnostics select the affected goal checkpoint and do not expose another adult's state",async(t)=>{
  const db=new HouseholdDatabase(":memory:");
  // Use the application's existing schema directly; no runtime, provider or secret access.
  const connection=db.domainConnection();
  connection.prepare("INSERT OR REPLACE INTO profiles(id,display_name,initials,color,role,agent_id,status,status_detail,capabilities_json) VALUES (?,?,?,?,?,?,?,?,?)")
    .run("alex","Alex","A","blue","adult","main","available","ready",JSON.stringify(["viewDiagnostics"]));
  connection.prepare("INSERT OR REPLACE INTO profiles(id,display_name,initials,color,role,agent_id,status,status_detail,capabilities_json) VALUES (?,?,?,?,?,?,?,?,?)")
    .run("natasha","Natasha","N","red","adult","natasha","available","ready",JSON.stringify(["viewDiagnostics"]));
  for(const [id,profile,agent] of [["conversation-a","alex","main"],["conversation-n","natasha","natasha"]])
    connection.prepare("INSERT INTO conversations(id,owner_profile_id,agent_id,session_key,title,audience,updated_at) VALUES (?,?,?,?,?,'private',?)").run(id,profile,agent,"session-key-"+id,"Private",new Date().toISOString());
  for(const [id,conversation,profile,agent,run,goal] of [["request-a","conversation-a","alex","main","run-a","goal-a"],["request-n","conversation-n","natasha","natasha","run-n","goal-n"]])
    connection.prepare("INSERT INTO submissions(id,conversation_id,profile_id,agent_id,text_hash,status,run_id,goal_id,created_at,updated_at) VALUES (?,?,?,?,?,'failed',?,?,?,?)")
      .run(id,conversation,profile,agent,"fixture-hash",run,goal,new Date().toISOString(),new Date().toISOString());
  db.updateCheckpoint("conversation-a",{nativeSessionId:"session-a",nativeGoalId:"goal-a",expectedRevision:0,phase:"verifying"});
  let calls=0;
  const native={async readDiagnosticObservation(){calls++;return {available:true,runMatched:true,sessionId:"session-a",runId:"run-a",context:{},events:[],unavailable:["compactions"]};}};
  const options={database:db,native,profileId:"alex",currentConversationId:"conversation-a",currentSubmissionId:"request-a",currentSessionId:"session-a",currentGoalId:"goal-a",assertCurrent(){},versions:{household:"fixture"}};
  const artifactRoot=await mkdtemp(path.join(os.tmpdir(),"diagnostic-reader-"));t.after(()=>rm(artifactRoot,{recursive:true,force:true}));
  const artifacts=new ArtifactStore({root:artifactRoot});await artifacts.initialize();
  const hookContext={agentId:"main",sessionKey:"session-key-conversation-a",sessionId:"session-a",runId:"run-a",contextTokenBudget:32000};
  for(const observation of [projectNativeDiagnosticEvent("after_compaction",{messageCount:10,compactedCount:7},hookContext),projectNativeDiagnosticEvent("llm_output",{runId:"run-a",sessionId:"session-a",lastAssistant:{stopReason:"max_tokens"},usage:{input:1000,cacheRead:100}},hookContext)])
    await captureNativeDiagnosticEvent({artifacts,scope:{ownerProfileId:"alex",conversationId:"conversation-a"},sourceId:"request-a",observation,assertCurrent(){}});
  const result=await readTaskDiagnosticEvidence({...options,artifacts}) as any;
  assert.equal(result.evidence.context.compactions,1);assert.equal(result.evidence.context.finishReason,"max_tokens");assert.equal(result.evidence.context.promptTokens,1100);
  assert.equal(result.nativeEvidence.captureTruncated,false);
  assert.equal(result.evidence.phase,"verifying");assert.equal(result.target.goalId,"goal-a");
  assert.equal(JSON.stringify(result).includes("request-n"),false);
  await assert.rejects(()=>readTaskDiagnosticEvidence({...options,targetSubmissionId:"request-n"}),/diagnostic_target_not_found/);
  assert.equal(calls,1);
  const prefixed=await readTaskDiagnosticEvidence({...options,targetSubmissionId:"user:request-a"}) as any;
  assert.equal(prefixed.target.submissionId,"request-a");
  new ExecutionAuthorityRepository(connection).bind({sessionKey:"agent:main:child:fixture",rootSessionKey:"session-key-conversation-a",sourceId:"request-a",parentSessionKey:"session-key-conversation-a",agentId:"main",sessionId:"child-session",goalId:"goal-a",runId:"child-run",mode:"normal"});
  const child=await readTaskDiagnosticEvidence({...options,targetRunId:"child-run",native:{async readDiagnosticObservation(conversation,runId){assert.equal(conversation.sessionKey,"agent:main:child:fixture");assert.equal(runId,"child-run");return {available:true,runMatched:true,sessionId:"child-session",runId:"child-run",context:{},events:[],unavailable:[]};}}}) as any;
  assert.equal(child.target.submissionId,"request-a");assert.equal(child.target.runId,"child-run");assert.equal(child.evidence.phase,"verifying");
  db.close();
});

test("real native budget projection keeps reserve and estimate semantics",()=>{
  const result=projectNativeDiagnosticObservation({lastRunId:"run-1",sessionId:"session-1",contextBudgetStatus:{schemaVersion:1,source:"pre-prompt-estimate",sessionId:"session-1",estimatedPromptTokens:27000,contextTokenBudget:32000,effectiveReserveTokens:3000,remainingPromptBudgetTokens:2000,overflowTokens:0,route:"fits"}},
    {runObservation:{stopReason:"max_tokens",errorMessage:"must-not-escape"}},"run-1");
  assert.equal(result.context.headroomTokens,2000);assert.equal(result.context.estimatedPromptTokens,27000);assert.equal(result.context.reserveTokens,3000);assert.equal(result.context.budgetRoute,"fits");assert.equal(result.context.finishReason,"max_tokens");
  assert.equal(JSON.stringify(result).includes("must-not-escape"),false);
});
