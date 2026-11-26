import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {HouseholdDatabase} from "../src/database.ts";
import {NativeDomainAuthorization} from "../src/domain-runtime/native-scope.ts";
import {DomainEffectStore} from "../src/domain-runtime/effect-store.ts";
import {BoundedProcessRunner} from "../src/domain-runtime/bounded-process.ts";

function fixture(){
  const db=new HouseholdDatabase(":memory:");
  const connection=db.domainConnection();
  connection.prepare("INSERT INTO devices(id,profile_id,display_name,public_key_der_base64,status,enrolled_at) VALUES ('fixture-device','alex','Fixture','not-a-real-key','active',?)").run(new Date().toISOString());
  const conversation={id:"fixture-conversation",ownerProfileId:"alex",agentId:"main",sessionKey:"hardy-home:fixture",title:"Fixture",presetId:null,audience:"private" as const,updatedAt:new Date().toISOString()};
  db.insertConversation(conversation);
  const text="Fixture request";
  db.submissions.enqueue({submissionId:"fixture-submission",conversationId:conversation.id,profileId:"alex",agentId:"main",textHash:createHash("sha256").update(text).digest("hex"),
    requestHash:"fixture-request-hash",payload:{kind:"message",text},originDeviceId:"fixture-device"});
  const claim=db.submissions.claimNext(2,120000)!;
  db.submissions.accepted(claim.receipt.submissionId,claim.leaseToken!,{...claim.receipt,status:"running",runId:"fixture-native-run"});
  const grant={enabled:true,domains:["contacts","documents","lists"],scopes:["personal","household"] as Array<"personal"|"household">,
    contactEditing:true,projectCodes:[],canManageProjects:false,canReviewReceipts:false,allowedAttendees:[],sharedDomains:["contacts","documents","lists"]};
  const authorization=new NativeDomainAuthorization(db,{alex:grant});
  const context={agentId:"main",sessionKey:conversation.sessionKey,sessionId:"fixture-session",nativeSessionId:"fixture-session",runId:"fixture-native-run",assertInvocationCurrent(){}};
  return {db,connection,conversation,authorization,context,scope:()=>authorization.resolve(context)};
}
test("same conversation cannot lend an admitted request to an unrelated native run",()=>{
  const f=fixture();try{assert.throws(()=>f.authorization.resolve({...f.context,runId:"unrelated-run"}),/native_request_lineage_not_authorized/);}finally{f.db.close();}
});
test("a subagent key containing the application marker is not the application session",()=>{
  const f=fixture();try{assert.throws(()=>f.authorization.resolve({...f.context,sessionKey:"agent:main:subagent:hardy-home:fixture"}),/native_session_not_authorized/);}finally{f.db.close();}
});
test("goal control fences both an already retained call and later calls from the old request",()=>{
  const f=fixture();try{const retained=f.scope();f.db.recordGoalControl(f.conversation.id,Date.now());
    assert.throws(()=>retained.principal.assertCurrent(),/domain_authority_revoked/);
    assert.throws(()=>f.scope(),/household_request_context_changed/);
  }finally{f.db.close();}
});
test("sharing a conversation cannot declassify its earlier admitted private request",()=>{
  const f=fixture();try{const retained=f.scope();f.connection.prepare("UPDATE conversations SET audience='household' WHERE id=?").run(f.conversation.id);
    assert.throws(()=>retained.principal.assertCurrent(),/domain_authority_revoked/);
    assert.throws(()=>f.scope(),/household_request_context_changed/);
  }finally{f.db.close();}
});
test("device revocation reaches the final synchronous write guard",()=>{
  const f=fixture();try{const retained=f.scope();f.connection.prepare("UPDATE devices SET status='revoked' WHERE id='fixture-device'").run();
    assert.throws(()=>retained.principal.assertCurrent(),/domain_authority_revoked/);
  }finally{f.db.close();}
});
test("effect replay and status cannot return cached domain content after mutable resource access changes",()=>{
  const f=fixture();try{const effects=new DomainEffectStore(f.connection),scope=f.scope();
    const admitted=effects.begin(scope.principal,"household_contacts_revise","fixture-operation",{contactId:"old-shared-contact"});
    if("replayed" in admitted)throw Error("fixture");effects.commit(admitted.id,admitted.token,{privateContent:"cached-fields"});
    assert.deepEqual(effects.begin(scope.principal,"household_contacts_revise","fixture-operation",{contactId:"old-shared-contact"}),{replayed:true});
    assert.equal(JSON.stringify(effects.inspect(scope.principal,"fixture-operation")).includes("cached-fields"),false);
  }finally{f.db.close();}
});
test("closing during asynchronous executable preparation cannot launch work afterward",async()=>{
  const runner=new BoundedProcessRunner();
  const pending=runner.runJson("/usr/bin/python3",["-c","import json; print(json.dumps({'unexpected_spawn': True}))"]);
  await runner.close();await assert.rejects(pending,/domain_runtime_stopping/);
});
