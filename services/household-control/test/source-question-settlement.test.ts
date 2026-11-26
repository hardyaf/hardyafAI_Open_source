import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {HouseholdDatabase} from "../src/database.ts";
import {ArtifactStore} from "../src/platform/artifacts.ts";
import {NativeAdmission} from "../src/domain-runtime/native-admission.ts";
import {NativeDomainAuthorization} from "../src/domain-runtime/native-scope.ts";
import {HouseholdDomainRuntime} from "../src/domain-runtime/runtime.ts";
import {SqliteHouseholdStore} from "../src/sqlite-household-store.ts";
import type {TaskHandoff,TaskQuestion} from "../src/task-flow/types.ts";
import type {MessageTaskContext} from "../src/request-context.ts";
import type {OpenClawAgentAdapter} from "../src/openclaw-adapter.ts";
const sha=(value:string)=>createHash("sha256").update(value).digest("hex");
async function fixture(nativeSources=false){
  const root=await mkdtemp(path.join(tmpdir(),"hardy-source-settlement-")),database=new HouseholdDatabase(path.join(root,"application.sqlite"));
  const conversation={id:"settlement-conversation",ownerProfileId:"alex",agentId:"main",sessionKey:"hardy-home:settlement",title:"Fixture",presetId:null,audience:"private" as const,updatedAt:new Date().toISOString()};
  database.insertConversation(conversation);
  database.domainConnection().prepare("INSERT INTO devices(id,profile_id,display_name,public_key_der_base64,status,enrolled_at) VALUES('fixture-device','alex','Fixture','not-real','active',?)").run(new Date().toISOString());
  const artifacts=new ArtifactStore({root:path.join(root,"artifacts")});await artifacts.initialize();
  let native:any={sessionKey:conversation.sessionKey,sessionId:"settlement-session",runId:null,goal:null,continuationPending:false};
  const observed=new Map<string,string>();
  const adapter:any={mode:"live",getContext:async()=>native,getRunState:async(_conversation:any,runId:string)=>({status:observed.get(runId)??"unknown",runId,updatedAt:null}),getExactRunState:async(_conversation:any,runId:string)=>({status:observed.get(runId)??"unknown",runId,updatedAt:null}),onEvent:()=>()=>{},close:async()=>{}};
  const grants={alex:{enabled:true,domains:["lists"],scopes:["personal"] as ("personal"|"household")[],contactEditing:false,projectCodes:[],canManageProjects:false,canReviewReceipts:false,allowedAttendees:[],sharedDomains:[]}};
  const rule={profileId:"alex",externalUserId:"fixture-human",channelId:"fixture-private",agentId:"main",audience:"private" as const,brainDump:false};
  const admission=new NativeAdmission(database,adapter as OpenClawAgentAdapter,[rule],artifacts,{schedulingEnabled:false,scheduledToolNames:[],profileGrants:grants});
  const runtime=Object.create(HouseholdDomainRuntime.prototype) as HouseholdDomainRuntime;
  Object.assign(runtime,{database,adapter,admission,artifacts,config:{profiles:grants},authorization:new NativeDomainAuthorization(database,grants,(packet,profileId)=>admission.externalCurrent(packet,profileId)),closed:false});
  function add(id:string,text:string,packet:Partial<MessageTaskContext>={},goalId:string|null=null){
    const taskContext:MessageTaskContext={mode:"conversation",artifactIds:[],expectedSessionId:native.sessionId,...(nativeSources?{origin:{kind:"discord" as const,externalUserId:rule.externalUserId,channelId:rule.channelId,sourceId:id+"-message",shared:false,confirmedHuman:true}}:{}),...packet};
    database.submissions.enqueue({submissionId:id,conversationId:conversation.id,profileId:"alex",agentId:"main",textHash:sha(text),requestHash:sha(id),payload:{kind:"message",text,taskContext},originDeviceId:nativeSources?undefined:"fixture-device"});
    const claim=database.submissions.claimNext(16,120_000)!;assert.equal(claim.receipt.submissionId,id);
    const runId=id+"-run";database.submissions.accepted(id,claim.leaseToken!,{...claim.receipt,status:"running",runId,goalId});observed.set(runId,"complete");
    return {id,runId};
  }
  function bind(source:{id:string;runId:string},goalId:string|null=null){
    admission.authority.bind({sessionKey:conversation.sessionKey,rootSessionKey:conversation.sessionKey,sourceId:source.id,parentSessionKey:null,agentId:"main",sessionId:native.sessionId,goalId,runId:source.runId,mode:"normal"});native={...native,runId:source.runId};
    return {agentId:"main",sessionKey:conversation.sessionKey,sessionId:native.sessionId,runId:source.runId};
  }
  let serial=0;
  async function state(original:string,goalId:string|null,questions:Array<{source:string;text:string;independentSource?:string}>=[]){
    const scope={ownerProfileId:"alex",conversationId:conversation.id,taskId:goalId??"conversation:"+conversation.id,audience:"private" as const},principal={profileId:"alex",canReadHousehold:false};
    const refs:string[]=[];
    for(const q of questions){const question:TaskQuestion={schemaVersion:1,kind:"task_question",text:q.text,reason:"Fixture uncertainty",sourcePromptId:"user:"+q.source,nativeSessionId:native.sessionId,nativeGoalId:goalId,questionType:"clarification",...(q.independentSource?{independentTopicOf:goalId??scope.taskId,independentSourcePromptId:"user:"+q.independentSource}:{})};
      refs.push((await artifacts.put(scope,principal,{bytes:Buffer.from(JSON.stringify(question)),mimeType:"application/json",kind:"evidence",filename:"task-question.json",idempotencyKey:"question-fixture:"+(serial++)})).id);}
    const handoff:TaskHandoff={schemaVersion:1,kind:"task_handoff",nativeSessionId:native.sessionId,nativeGoalId:goalId,taskId:scope.taskId,objective:"Original fixture",originalSourcePromptId:"user:"+original,originalSourceSha256:database.submissions.get(original)!.textHash,mode:"normal",selectedDomains:[],phase:refs.length?"waiting_for_user":"working",summary:"Fixture saved state",nextAction:refs.length?"Wait":"Continue",outcomes:[],verifications:{},questionArtifactId:refs.at(-1)??null,suspendedQuestionArtifactIds:refs.slice(0,-1),replies:[],previousArtifactId:null,terminal:null};
    const saved=await artifacts.put(scope,principal,{bytes:Buffer.from(JSON.stringify(handoff)),mimeType:"application/json",kind:"evidence",filename:"task-handoff.json",idempotencyKey:"handoff-fixture:"+(serial++)});
    const previous=database.getCheckpoint(conversation.id,native.sessionId,goalId);
    database.updateCheckpoint(conversation.id,{nativeSessionId:native.sessionId,nativeGoalId:goalId,expectedRevision:previous?.revision??0,phase:handoff.phase,questionArtifactId:handoff.questionArtifactId,checkpointArtifactId:saved.id});
  }
  let store:SqliteHouseholdStore|undefined;
  return {database,artifacts,runtime,admission,conversation,add,bind,state,observed,
    native(patch:any){native={...native,...patch};},
    store(){return store??=new SqliteHouseholdStore(database,adapter,{sourceSettlement:input=>runtime.resolveSourceSettlement(input)});},
    async close(){if(store)await store.close();else database.close();await rm(root,{recursive:true,force:true});}};
}

test("native end closes an answered ordinary no-goal question without borrowing an older completed goal",async()=>{
  const f=await fixture(true);try{
    const original=f.add("ordinary-question","Which day?");let context=f.bind(original);
    await f.state(original.id,null,[{source:original.id,text:"Which day?"}]);
    f.native({goal:{id:"old-complete",status:"complete",objective:"Old task"}});
    await f.runtime.nativeEnd({},context);assert.equal(f.database.submissions.get(original.id)!.receipt.status,"waiting_for_user");
    const answer=f.add("ordinary-answer","Friday");context=f.bind(answer);
    await f.state(original.id,null);await f.runtime.nativeEnd({},context);
    assert.equal(f.database.submissions.get(answer.id)!.receipt.status,"complete");assert.equal(f.database.submissions.get(original.id)!.receipt.status,"complete");
  }finally{await f.close();}
});

test("independent native turn completes against its own questions while original goal keeps waiting",async()=>{
  const f=await fixture(true);try{
    const original=f.add("root-A","Original work",{mode:"task"},"goal-A");f.database.submissions.waiting(original.id,original.runId);
    const side=f.add("side-B","Add a separate list item",{independentTopicOf:"goal-A",independentSourcePromptId:"user:side-B"});const context=f.bind(side,"goal-A");
    f.native({goal:{id:"goal-A",status:"active",objective:"Original work"},continuationPending:true});
    await f.state(original.id,"goal-A",[{source:original.id,text:"Which project?"}]);await f.runtime.nativeEnd({},context);
    assert.equal(f.database.submissions.get(side.id)!.receipt.status,"complete");assert.equal(f.database.submissions.get(side.id)!.receipt.goalId,null);
    assert.equal(f.database.submissions.get(original.id)!.receipt.status,"waiting_for_user");
  }finally{await f.close();}
});

test("side question waits only its topic; its answer closes prior side wait without completing original goal",async()=>{
  const f=await fixture(true);try{
    const original=f.add("root-A","Original work",{mode:"task"},"goal-A");f.database.submissions.waiting(original.id,original.runId);
    const side=f.add("side-B","Make another event",{independentTopicOf:"goal-A",independentSourcePromptId:"user:side-B"});let context=f.bind(side,"goal-A");
    f.native({goal:{id:"goal-A",status:"active",objective:"Original work"}});
    await f.state(original.id,"goal-A",[{source:original.id,text:"Which project?"},{source:side.id,text:"What time?",independentSource:side.id}]);
    await f.runtime.nativeEnd({},context);assert.equal(f.database.submissions.get(side.id)!.receipt.status,"waiting_for_user");
    const answer=f.add("answer-C","Noon",{independentTopicOf:"goal-A",independentSourcePromptId:"user:side-B"});context=f.bind(answer,"goal-A");
    await f.state(original.id,"goal-A",[{source:original.id,text:"Which project?"}]);await f.runtime.nativeEnd({},context);
    assert.equal(f.database.submissions.get(answer.id)!.receipt.status,"complete");assert.equal(f.database.submissions.get(side.id)!.receipt.status,"complete");assert.equal(f.database.submissions.get(original.id)!.receipt.status,"waiting_for_user");
  }finally{await f.close();}
});

test("maintenance recovers exact side completion despite an unrelated active root continuation",async()=>{
  const f=await fixture();try{
    const original=f.add("root-A","Original work",{mode:"task"},"goal-A");f.database.submissions.waiting(original.id,original.runId);
    const side=f.add("side-B","Separate item",{independentTopicOf:"goal-A",independentSourcePromptId:"user:side-B"});f.bind(side,"goal-A");
    f.native({goal:{id:"goal-A",status:"active",objective:"Original work"},continuationPending:true});
    await f.state(original.id,"goal-A",[{source:original.id,text:"Which project?"}]);await f.store().reconcileRuns();
    assert.equal(f.database.submissions.get(side.id)!.receipt.status,"complete");assert.equal(f.database.submissions.get(original.id)!.receipt.status,"waiting_for_user");
  }finally{await f.close();}
});

test("maintenance preserves a side question and later closes exactly its answered sources",async()=>{
  const f=await fixture();try{
    const original=f.add("root-A","Original work",{mode:"task"},"goal-A");f.database.submissions.waiting(original.id,original.runId);
    const side=f.add("side-B","Another event",{independentTopicOf:"goal-A",independentSourcePromptId:"user:side-B"});f.bind(side,"goal-A");f.native({goal:{id:"goal-A",status:"active",objective:"Original work"}});
    await f.state(original.id,"goal-A",[{source:original.id,text:"Which project?"},{source:side.id,text:"What time?",independentSource:side.id}]);await f.store().reconcileRuns();
    assert.equal(f.database.submissions.get(side.id)!.receipt.status,"waiting_for_user");
    const answer=f.add("answer-C","Noon",{independentTopicOf:"goal-A",independentSourcePromptId:"user:side-B"});f.bind(answer,"goal-A");
    await f.state(original.id,"goal-A",[{source:original.id,text:"Which project?"}]);await f.store().reconcileRuns();
    assert.equal(f.database.submissions.get(side.id)!.receipt.status,"complete");assert.equal(f.database.submissions.get(answer.id)!.receipt.status,"complete");assert.equal(f.database.submissions.get(original.id)!.receipt.status,"waiting_for_user");
  }finally{await f.close();}
});

test("maintenance recovers ordinary no-goal question and answer without changing native goal state",async()=>{
  const f=await fixture();try{
    const original=f.add("ordinary-Q","Which day?");f.bind(original);await f.state(original.id,null,[{source:original.id,text:"Which day?"}]);await f.store().reconcileRuns();
    assert.equal(f.database.submissions.get(original.id)!.receipt.status,"waiting_for_user");
    const answer=f.add("ordinary-A","Friday");f.bind(answer);await f.state(original.id,null);await f.store().reconcileRuns();
    assert.equal(f.database.submissions.get(original.id)!.receipt.status,"complete");assert.equal(f.database.submissions.get(answer.id)!.receipt.status,"complete");
  }finally{await f.close();}
});


test("verified native goal completion closes only its ordinary waiting sources",async()=>{
  const f=await fixture();try{
    const original=f.add("root-A","Original work",{mode:"task"},"goal-A");f.database.submissions.waiting(original.id,original.runId);
    const side=f.add("side-B","Independent work",{independentTopicOf:"goal-A",independentSourcePromptId:"user:side-B"});f.database.submissions.waiting(side.id,side.runId);
    const answer=f.add("root-answer-C","Finish original work",{mode:"task"},"goal-A");f.bind(answer,"goal-A");
    f.native({goal:{id:"goal-A",status:"complete",objective:"Original work"}});await f.state(original.id,"goal-A");
    await f.store().reconcileRuns();
    assert.equal(f.database.submissions.get(original.id)!.receipt.status,"complete");assert.equal(f.database.submissions.get(answer.id)!.receipt.status,"complete");
    assert.equal(f.database.submissions.get(side.id)!.receipt.status,"waiting_for_user");
  }finally{await f.close();}
});

test("an independent source waits for its own child even without an unrelated root continuation flag",async()=>{
  const f=await fixture(true);try{
    const original=f.add("root-A","Original work",{mode:"task"},"goal-A");f.database.submissions.waiting(original.id,original.runId);
    const side=f.add("side-B","Independent analysis",{independentTopicOf:"goal-A",independentSourcePromptId:"user:side-B"});const context=f.bind(side,"goal-A");
    f.native({goal:{id:"goal-A",status:"active",objective:"Original work"},continuationPending:false});await f.state(original.id,"goal-A",[{source:original.id,text:"Which project?"}]);
    await f.admission.child({childSessionKey:"agent:main:subagent:owned-fixture",agentId:"main",runId:"side-child-run"},{requesterSessionKey:"agent:main:"+f.conversation.sessionKey});
    f.observed.set("side-child-run","running");await f.runtime.nativeEnd({},context);
    assert.equal(f.database.submissions.get(side.id)!.receipt.status,"running");
    f.observed.set("side-child-run","complete");await f.runtime.nativeEnd({},context);
    assert.equal(f.database.submissions.get(side.id)!.receipt.status,"complete");assert.equal(f.database.submissions.get(original.id)!.receipt.status,"waiting_for_user");
  }finally{await f.close();}
});
