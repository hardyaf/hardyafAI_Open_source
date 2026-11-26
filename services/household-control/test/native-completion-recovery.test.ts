import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {HouseholdDatabase} from "../src/database.ts";
import {ExecutionAuthorityRepository} from "../src/request-context.ts";
import {DomainError,fingerprint} from "../src/domain-runtime/common.ts";
import {NativeDomainAuthorization} from "../src/domain-runtime/native-scope.ts";
import type {NativeToolContext} from "../src/domain-runtime/native-scope.ts";

function fixture(){
  const db=new HouseholdDatabase(":memory:"),sql=db.domainConnection();
  sql.prepare("INSERT INTO devices(id,profile_id,display_name,public_key_der_base64,status,enrolled_at) VALUES('recovery-device','alex','Fixture','synthetic-key','active',?)").run(new Date().toISOString());
  const conversation={id:"recovery-conversation",ownerProfileId:"alex",agentId:"main",sessionKey:"hardy-home:recovery",title:"Fixture",presetId:null,audience:"private" as const,updatedAt:new Date().toISOString()};
  db.insertConversation(conversation);
  db.submissions.enqueue({submissionId:"recovery-source",conversationId:conversation.id,profileId:"alex",agentId:"main",textHash:createHash("sha256").update("Fixture completed request").digest("hex"),
    requestHash:"recovery-request",payload:{kind:"message",text:"Fixture completed request",goalStart:{issuedAtMs:Date.now()}},originDeviceId:"recovery-device",taskContext:{mode:"task"}});
  const claim=db.submissions.claimNext(2,120000)!;
  db.submissions.accepted(claim.receipt.submissionId,claim.leaseToken!,{...claim.receipt,status:"running",runId:"source-run",goalId:"recovery-goal"});
  db.submissions.enqueue({submissionId:"other-source",conversationId:conversation.id,profileId:"alex",agentId:"main",textHash:"other-hash",requestHash:"other-request",payload:{kind:"message",text:"Another request"},originDeviceId:"recovery-device"});
  const grant={enabled:true,domains:["memory"],scopes:["personal","household"] as Array<"personal"|"household">,contactEditing:false,projectCodes:[],canManageProjects:false,canReviewReceipts:false,allowedAttendees:[],sharedDomains:["memory"]};
  const authority=new ExecutionAuthorityRepository(sql);
  const projection={sessionKey:conversation.sessionKey,rootSessionKey:conversation.sessionKey,sourceId:"recovery-source",parentSessionKey:null,agentId:"main",sessionId:"recovery-session",goalId:"recovery-goal",runId:"closing-run",mode:"normal" as const};
  authority.bind(projection);
  const request={kind:"verified_task_completion",sourceId:"recovery-source",goalId:"recovery-goal",sessionId:"recovery-session"};
  const operationId="task-complete:"+fingerprint([request.sourceId,request.sessionId,request.goalId]).slice(0,64);
  authority.prepareControl(operationId,conversation.id,request);
  sql.prepare("UPDATE submissions SET status='complete' WHERE id='recovery-source'").run();
  const authorization=new NativeDomainAuthorization(db,{alex:grant});
  const context:NativeToolContext={agentId:"main",sessionKey:conversation.sessionKey,sessionId:"recovery-session",nativeSessionId:"recovery-session",runId:"closing-run",nativeRunId:null,nativeGoalId:"recovery-goal",nativeGoalStatus:"complete",completionRecovery:true,assertInvocationCurrent(){}};
  return {db,sql,grant,authority,projection,request,operationId,conversation,authorization,context,resolve:()=>authorization.resolve(context)};
}

test("lost completion response recovers an already complete source through the exact current root projection",()=>{
  const f=fixture();try{
    const scope=f.resolve();assert.equal(scope.principal.sourcePromptId,"recovery-source");assert.equal(scope.rootGoalId,"recovery-goal");scope.principal.assertCurrent();
    assert.equal(f.db.submissions.get("recovery-source")?.receipt.status,"complete","Recovery must not reopen the source");
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM domain_effects").get()!.n,0,"Completion authorization performs no business effects");
    assert.equal(f.authority.control(f.operationId,f.conversation.id,f.request) && true,true);
  }finally{f.db.close();}
});

test("finished owner control also permits the same completion coordination without a native active run",()=>{
  const f=fixture();try{
    const prepared=f.authority.control(f.operationId,f.conversation.id,f.request) as object;
    f.authority.finishControl(f.operationId,f.conversation.id,f.request,{...prepared,phase:"complete",reconciled:true});
    f.resolve().principal.assertCurrent();
  }finally{f.db.close();}
});

const contextDenials:Record<string,Partial<NativeToolContext>>={
  "ordinary tools lack the derived completion flag":{completionRecovery:false},
  "omitted flag cannot authorize terminal source":{completionRecovery:undefined},
  "active goal is not completed recovery":{nativeGoalStatus:"active"},
  "wrong goal cannot adopt prior control":{nativeGoalId:"other-goal"},
  "absent goal cannot adopt prior control":{nativeGoalId:null},
  "another hook run cannot borrow terminal source":{runId:"other-run"},
  "another active native run cannot borrow terminal source":{nativeRunId:"other-run"},
  "another native generation cannot borrow terminal source":{nativeSessionId:"other-session"},
  "another hook generation cannot borrow terminal source":{sessionId:"other-session"},
  "another agent cannot borrow terminal source":{agentId:"other-agent"},
};
for(const [name,change] of Object.entries(contextDenials))test(name,()=>{
  const f=fixture();try{assert.throws(()=>f.authorization.resolve({...f.context,...change}));}finally{f.db.close();}
});

type Fixture=ReturnType<typeof fixture>;
const authorityDenials:Record<string,(f:Fixture)=>void>={
  "missing prepared control":f=>f.sql.prepare("DELETE FROM control_receipts").run(),
  "conflicting prepared request":f=>f.sql.prepare("UPDATE control_receipts SET request_hash='different'").run(),
  "malformed prepared control":f=>f.sql.prepare("UPDATE control_receipts SET result_json='{}'").run(),
  "unknown control phase":f=>f.sql.prepare("UPDATE control_receipts SET result_json=?").run(JSON.stringify({issuedAtMs:Date.now(),phase:"other"})),
  "missing root projection":f=>f.sql.prepare("DELETE FROM native_execution_grants").run(),
  "child projection":f=>f.authority.bind({...f.projection,parentSessionKey:"parent-session"}),
  "wrong projected source":f=>f.sql.prepare("UPDATE native_execution_grants SET root_submission_id='other-source'").run(),
  "wrong projected goal":f=>f.authority.bind({...f.projection,goalId:"other-goal"}),
  "wrong projected generation":f=>f.authority.bind({...f.projection,sessionId:"other-session"}),
  "wrong projected agent":f=>f.authority.bind({...f.projection,agentId:"other-agent"}),
  "wrong root session":f=>f.authority.bind({...f.projection,rootSessionKey:"other-root"}),
  "changed run":f=>f.authority.bind({...f.projection,runId:"other-run"}),
  "source marked failed":f=>f.sql.prepare("UPDATE submissions SET status='failed'").run(),
  "source marked cancelled":f=>f.sql.prepare("UPDATE submissions SET status='cancelled'").run(),
  "source waiting for user":f=>f.sql.prepare("UPDATE submissions SET status='waiting_for_user'").run(),
  "source requires reconciliation":f=>f.sql.prepare("UPDATE submissions SET recovery_required=1").run(),
  "source not goal bound":f=>f.sql.prepare("UPDATE submissions SET domain_goal_bound=0").run(),
  "request audience changed":f=>f.sql.prepare("UPDATE conversations SET audience='household'").run(),
  "control watermark changed":f=>f.db.recordGoalControl(f.conversation.id,Date.now()),
  "profile disabled":f=>f.sql.prepare("UPDATE profiles SET status='paused' WHERE id='alex'").run(),
  "profile changed to child":f=>f.sql.prepare("UPDATE profiles SET role='child' WHERE id='alex'").run(),
  "device revoked":f=>f.sql.prepare("UPDATE devices SET status='revoked' WHERE id='recovery-device'").run(),
  "grant disabled":f=>{f.grant.enabled=false;},
};
for(const [name,change] of Object.entries(authorityDenials))test("completed-source recovery rejects "+name,()=>{
  const f=fixture();try{change(f);assert.throws(()=>f.resolve());}finally{f.db.close();}
});

for(const [name,change] of Object.entries(authorityDenials))test("retained completion scope is fenced by "+name,()=>{
  const f=fixture();try{const retained=f.resolve();change(f);assert.throws(()=>retained.principal.assertCurrent());}finally{f.db.close();}
});

test("retained closing scope rechecks packet, grant contents, device identity and source binding",()=>{
  for(const change of [
    (f:Fixture)=>{f.grant.domains.push("lists");},
    (f:Fixture)=>f.sql.prepare("UPDATE devices SET public_key_der_base64='rotated-key' WHERE id='recovery-device'").run(),
    (f:Fixture)=>f.sql.prepare("UPDATE submissions SET task_context_json=?").run(JSON.stringify({mode:"task",sourceReferenceId:"different-source"})),
    (f:Fixture)=>f.sql.prepare("UPDATE submissions SET run_id='different-source-run'").run(),
    (f:Fixture)=>f.sql.prepare("UPDATE submissions SET goal_id='different-source-goal'").run(),
    (f:Fixture)=>f.sql.prepare("UPDATE conversations SET session_key='different-conversation-session'").run(),
    (f:Fixture)=>f.sql.prepare("UPDATE conversations SET agent_id='other-agent'").run(),
    (f:Fixture)=>f.sql.prepare("UPDATE control_receipts SET result_json=?").run(JSON.stringify({issuedAtMs:1,phase:"prepared"})),
  ]){const f=fixture();try{const retained=f.resolve();change(f);assert.throws(()=>retained.principal.assertCurrent());}finally{f.db.close();}}
});

test("invocation revocation and abort still fence completion-only recovery",()=>{
  const f=fixture();try{
    let current=true;f.context.assertInvocationCurrent=()=>{if(!current)throw new DomainError("fixture_invocation_revoked");};
    const retained=f.resolve();current=false;assert.throws(()=>retained.principal.assertCurrent(),/fixture_invocation_revoked/);
    current=true;const controller=new AbortController(),scope=f.authorization.resolve(f.context,controller.signal);controller.abort();assert.throws(()=>scope.principal.assertCurrent(),/operation_cancelled/);
  }finally{f.db.close();}
});
