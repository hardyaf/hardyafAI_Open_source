// Deferred consolidated campaign. Native observations are controlled fixtures;
// no provider, model, scheduler or functional scenario runs during source prep.
import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import type {Conversation,HouseholdAgentAdapter,HouseholdAgentEvent,HouseholdAgentRunState,HouseholdConversationContext,HouseholdSubmitMessage,SubmissionReceipt} from "../src/domain.ts";
import {HouseholdDatabase} from "../src/database.ts";
import {SqliteHouseholdStore} from "../src/sqlite-household-store.ts";

class ObservedAdapter implements HouseholdAgentAdapter {
  readonly mode="mock" as const;
  state:HouseholdAgentRunState={status:"complete",runId:"run-original",updatedAt:new Date(Date.now()+10_000).toISOString()};
  native:HouseholdConversationContext={sessionKey:"",sessionId:"native-session",goal:{id:"goal-original",objective:"Requested outcome",status:"active",updatedAt:Date.now()},runId:"run-original",continuationPending:false,parentSessionKey:null,contextTokens:32768,contextBudgetStatus:"ready"};
  afterObservation?:()=>void;
  completedAcknowledgement=false;
  async ensureConversation(_conversation:Conversation){}
  async listMessages(_conversation:Conversation){return [];}
  async submitMessage(args:HouseholdSubmitMessage):Promise<SubmissionReceipt>{
    if(!this.completedAcknowledgement)throw Error("fixture must not dispatch");
    return {submissionId:args.submissionId,conversationId:args.conversation.id,profileId:args.profile.id,agentId:args.profile.agentId,status:"complete",runId:"run-original",queuePosition:null,goalId:this.native.goal?.id??null};
  }
  async getRunState(_conversation:Conversation){return this.state;}
  async getContext(conversation:Conversation){this.afterObservation?.();return {...this.native,sessionKey:conversation.sessionKey};}
  async cancel(_conversation:Conversation,_runId?:string){}
  onEvent(_listener:(event:HouseholdAgentEvent)=>void){return ()=>{};}
  async diagnostics(){return {status:"healthy"};}
  async close(){}
}

async function fixture(boundGoal:string|null="goal-original"){
  const database=new HouseholdDatabase(":memory:"),adapter=new ObservedAdapter(),store=new SqliteHouseholdStore(database,adapter);
  const profile=store.getProfile("alex")!,conversation=await store.createConversation(profile,"Completion projection fixture",null);
  const text="Deliver the requested outcome",hash=createHash("sha256").update(text).digest("hex");
  database.submissions.enqueue({submissionId:"source-original",conversationId:conversation.id,profileId:profile.id,agentId:profile.agentId,textHash:hash,requestHash:hash,
    payload:{kind:"message",text,taskContext:{mode:"task",artifactIds:[],...(boundGoal?{expectedGoalId:boundGoal}:{})}}});
  const claim=database.submissions.claimNext(2,60_000)!;
  database.submissions.accepted(claim.receipt.submissionId,claim.leaseToken!,{...claim.receipt,status:"running",runId:"run-original",goalId:boundGoal});
  database.setProfileStatus(profile.id,"working","Responding");
  const checkpoint=(phase:string,question:string|null=null)=>database.updateCheckpoint(conversation.id,{nativeSessionId:"native-session",nativeGoalId:"goal-original",expectedRevision:0,phase,questionArtifactId:question});
  return {database,adapter,store,conversation,checkpoint,receipt:()=>database.submissions.get("source-original")!.receipt};
}

test("turn completion cannot claim an active original goal was delivered",async()=>{
  const f=await fixture();try{
    f.checkpoint("executing");await f.store.reconcileRuns();
    assert.equal(f.receipt().status,"failed");assert.equal(f.receipt().failureCode,"task_incomplete_after_native_run");
    assert.equal(f.receipt().recoveryRequired,false);assert.equal(f.store.getSnapshot().activeRuns,0);
    assert.equal(f.store.getProfile("alex")!.status,"available");
  }finally{await f.store.close();}
});

test("finished task metadata still requires native goal completion",async()=>{
  const f=await fixture();try{
    f.checkpoint("complete");await f.store.reconcileRuns();
    assert.equal(f.receipt().status,"failed");assert.equal(f.receipt().failureCode,"native_goal_completion_missing");
  }finally{await f.store.close();}
});

test("a durable waiting question releases capacity while retaining the goal",async()=>{
  const f=await fixture();try{
    f.checkpoint("waiting_for_user","artifact-"+"a".repeat(64));await f.store.reconcileRuns();
    assert.equal(f.receipt().status,"waiting_for_user");assert.equal(f.receipt().failureCode,null);
    assert.equal(f.receipt().goalId,"goal-original");assert.equal(f.store.getSnapshot().activeRuns,0);
  }finally{await f.store.close();}
});

test("an announcing child continuation retains the original running reservation",async()=>{
  const f=await fixture();try{
    f.adapter.native.continuationPending=true;f.checkpoint("executing");await f.store.reconcileRuns();
    assert.equal(f.receipt().status,"running");assert.equal(f.store.getSnapshot().activeRuns,1);
  }finally{await f.store.close();}
});

for(const [goalStatus,status,code] of [
  ["paused","cancelled","native_goal_paused"],
  ["blocked","failed","native_goal_blocked"],
  ["usage_limited","failed","native_goal_usage_limited"],
  ["budget_limited","failed","native_goal_budget_limited"],
] as const){
  test("native "+goalStatus+" is visible without a false completed receipt",async()=>{
    const f=await fixture();try{
      f.adapter.native.goal!.status=goalStatus;
      // Paused descendants can still appear pending to a turn-level observer.
      f.adapter.state.status="running";f.adapter.native.continuationPending=true;
      await f.store.reconcileRuns();assert.equal(f.receipt().status,status);assert.equal(f.receipt().failureCode,code);
      assert.equal(f.store.getSnapshot().activeRuns,0);
    }finally{await f.store.close();}
  });
}

test("current native completion closes a successor-anchored source even with an old question",async()=>{
  const f=await fixture();try{
    f.adapter.state={...f.adapter.state,runId:"run-successor",goalId:"goal-original"};
    f.adapter.native.goal!.status="complete";f.checkpoint("waiting_for_user","artifact-"+"b".repeat(64));
    await f.store.reconcileRuns();assert.equal(f.receipt().status,"complete");assert.equal(f.receipt().failureCode,null);
    assert.equal(f.receipt().runId,"run-original");
  }finally{await f.store.close();}
});

test("a cleared or replaced original goal cannot inherit a later turn's success",async()=>{
  const f=await fixture();try{
    f.adapter.native.goal={...f.adapter.native.goal!,id:"goal-new",status:"active"};
    await f.store.reconcileRuns();assert.equal(f.receipt().status,"cancelled");assert.equal(f.receipt().failureCode,"native_goal_binding_changed");
  }finally{await f.store.close();}
});

test("completion projection rereads source binding and preserves concurrent terminal decisions",async()=>{
  const f=await fixture(null);try{
    f.adapter.afterObservation=()=>f.database.domainConnection().prepare("UPDATE submissions SET goal_id=? WHERE id=?").run("goal-original","source-original");
    await f.store.reconcileRuns();assert.equal(f.receipt().status,"failed");assert.equal(f.receipt().failureCode,"task_incomplete_after_native_run");
  }finally{await f.store.close();}
  const cancelled=await fixture();try{
    cancelled.adapter.afterObservation=()=>cancelled.database.submissions.failWithCode("source-original","run-original","operator_cancelled","cancelled");
    await cancelled.store.reconcileRuns();assert.equal(cancelled.receipt().status,"cancelled");assert.equal(cancelled.receipt().failureCode,"operator_cancelled");
  }finally{await cancelled.store.close();}
});

test("maintenance refreshes stale derived statuses but preserves explicit family controls",async()=>{
  const f=await fixture();try{
    f.database.domainConnection().prepare("UPDATE submissions SET status='cancelled' WHERE id=?").run("source-original");
    f.database.setProfileStatus("natasha","working","Responding");
    f.database.setProfileStatus("fred","paused","Paused by operator");f.database.setProfileStatus("belle","offline","Offline by operator");
    await f.store.reconcileRuns();
    assert.equal(f.store.getProfile("alex")!.status,"available");assert.equal(f.store.getProfile("natasha")!.status,"available");
    assert.equal(f.store.getProfile("fred")!.status,"paused");assert.equal(f.store.getProfile("belle")!.status,"offline");
  }finally{await f.store.close();}
});


test("legacy cancellation does not upgrade an unfinished goal to completed",async()=>{
  const f=await fixture();try{
    assert.equal(await f.store.cancel(f.store.getProfile("alex")!,f.conversation.id,"run-original"),true);
    assert.equal(f.receipt().status,"cancelled");
  }finally{await f.store.close();}
  const complete=await fixture();try{
    complete.adapter.native.goal!.status="complete";
    await complete.store.cancel(complete.store.getProfile("alex")!,complete.conversation.id,"run-original");
    assert.equal(complete.receipt().status,"complete");
  }finally{await complete.store.close();}
});

test("goal-bound completed transport acknowledgements wait for native authority",async()=>{
  const database=new HouseholdDatabase(":memory:"),adapter=new ObservedAdapter(),store=new SqliteHouseholdStore(database,adapter);
  try{
    adapter.completedAcknowledgement=true;
    const profile=store.getProfile("alex")!,conversation=await store.createConversation(profile,"Completed acknowledgement",null);
    await store.submitMessage({profile,conversationId:conversation.id,text:"Deliver a task",submissionId:"complete-ack-source",taskContext:{mode:"task",artifactIds:[]}});
    await store.reconcileRuns();
    assert.equal(database.submissions.get("complete-ack-source")!.receipt.status,"running");
    adapter.native.goal!.status="complete";
    await store.reconcileRuns();assert.equal(database.submissions.get("complete-ack-source")!.receipt.status,"complete");
  }finally{await store.close();}
});
