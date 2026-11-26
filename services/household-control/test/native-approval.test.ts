import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import {HouseholdDatabase} from "../src/database.ts";
import {ExecutionAuthorityRepository} from "../src/request-context.ts";
import {NativeApprovalBridge,nativeApprovalRouteAuthorized} from "../src/domain-runtime/native-approval.ts";
import type {TaskApplicationBinding} from "../src/domain-runtime/task-application.ts";
import type {TaskQuestion,TaskSnapshot} from "../src/task-flow/types.ts";
const sha=(value:string)=>createHash("sha256").update(value).digest("hex");
async function fixture(){
  const root=await mkdtemp(path.join(tmpdir(),"hardy-native-approval-")),database=new HouseholdDatabase(path.join(root,"application.sqlite"));
  const now=new Date().toISOString();
  database.domainConnection().prepare("UPDATE profiles SET role='admin' WHERE id='alex'").run();
  database.insertConversation({id:"approval-conversation",ownerProfileId:"alex",agentId:"main",sessionKey:"agent:main:discord:fixture",title:"Private operator",presetId:null,audience:"private",updatedAt:now});
  const packet={mode:"conversation",artifactIds:[],origin:{kind:"discord",externalUserId:"fixture-operator",channelId:"fixture-protected",sourceId:"fresh-human-message",shared:false,confirmedHuman:true}};
  database.domainConnection().prepare("INSERT INTO submissions(id,conversation_id,profile_id,agent_id,text_hash,status,run_id,created_at,updated_at,task_context_json) VALUES (?,?,?,?,?,'running',?,?,?,?)")
    .run("fresh-source","approval-conversation","alex","main",sha("Yes, approve that exact deletion"),"approval-run",now,now,JSON.stringify(packet));
  const question:TaskQuestion={schemaVersion:1,kind:"task_question",text:"Delete event fixture-event?",reason:"Destructive operation",sourcePromptId:"user:older-source",nativeSessionId:"native-session",nativeGoalId:"goal-a",questionType:"approval",focus:{kind:"calendar_event",id:"fixture-event"},approval:{toolName:"household_calendar_delete",operationId:"delete-event-operation",resourceId:"fixture-event"}};
  const id="artifact-"+"a".repeat(64),snapshot={checkpoint:{questionArtifactId:id},question,handoff:{originalSourcePromptId:"user:older-source"}} as TaskSnapshot;
  const binding:TaskApplicationBinding={task:{principal:{profileId:"alex",canReadHousehold:true},scope:{ownerProfileId:"alex",conversationId:"approval-conversation",taskId:"goal-a",audience:"private"},native:{sessionId:"native-session",sessionKey:"agent:main:discord:fixture",goalId:"goal-a",goalStatus:"active",objective:"Delete event",runId:"approval-run"},source:{id:"user:fresh-source",text:"Yes, approve that exact deletion",sha256:sha("Yes, approve that exact deletion"),human:true},mode:"normal",artifactIds:[],assertCurrent(){}},execution:{agentId:"main",sessionId:"native-session",sessionKey:"agent:main:discord:fixture",runId:"approval-run"}};
  let ready=true;
  const authority=new ExecutionAuthorityRepository(database.domainConnection()),bridge=new NativeApprovalBridge({database,authority,snapshot:async()=>snapshot,routeAuthorized:()=>ready,validateQuestion:async()=>{}});
  const event={toolName:"household_task_bind_reply",toolCallId:"approval-call",runId:"approval-run",params:{relation:"answer",decision:"approve"}},context={runId:"approval-run",toolCallId:"approval-call"};
  return {database,bridge,binding,event,context,snapshot,packet,setReady(value:boolean){ready=value;},async close(){database.close();await rm(root,{recursive:true,force:true});}};
}
test("native allow-once binds only the exact prepared fresh question into existing source authority",async()=>{
  const f=await fixture();try{
    const request=await f.bridge.request(f.binding,f.event,f.context);assert.deepEqual(request?.allowedDecisions,["allow-once","deny"]);
    assert.equal(f.database.submissions.get("fresh-source")!.taskContext?.approval,undefined);
    await f.bridge.resolved(f.binding,f.event,f.context,"allow-once");
    assert.deepEqual(f.database.submissions.get("fresh-source")!.taskContext?.approval,{questionId:f.snapshot.checkpoint!.questionArtifactId,decision:"approve"});
    await f.bridge.resolved(f.binding,f.event,f.context,"allow-once");
  }finally{await f.close();}
});
test("native denial and unavailable reviewer route cannot become source approval",async()=>{
  const f=await fixture();try{
    f.setReady(false);await assert.rejects(()=>f.bridge.request(f.binding,f.event,f.context),{code:"native_approval_route_not_authorized"});f.setReady(true);
    await f.bridge.request(f.binding,f.event,f.context);await f.bridge.resolved(f.binding,f.event,f.context,"timeout");
    assert.equal(f.database.submissions.get("fresh-source")!.taskContext?.approval,undefined);
    await assert.rejects(()=>f.bridge.resolved(f.binding,f.event,f.context,"allow-once"),{code:"native_approval_already_resolved"});
  }finally{await f.close();}
});
test("changed exact approval or model-only source fails closed",async()=>{
  const f=await fixture();try{
    await f.bridge.request(f.binding,f.event,f.context);
    f.snapshot.question!.approval!.resourceId="changed-resource";
    await assert.rejects(()=>f.bridge.resolved(f.binding,f.event,f.context,"allow-once"),{code:"native_approval_request_not_prepared"});
    f.binding.task.source.human=false;await assert.rejects(()=>f.bridge.request(f.binding,f.event,f.context),{code:"fresh_human_response_required"});
  }finally{await f.close();}
});
test("existing signed app decisions retain their owner validation without a second native prompt",async()=>{
  const f=await fixture();try{
    const packet={...f.packet,approval:{questionId:f.snapshot.checkpoint!.questionArtifactId,decision:"approve"}};
    f.database.domainConnection().prepare("UPDATE submissions SET task_context_json=? WHERE id='fresh-source'").run(JSON.stringify(packet));
    f.setReady(false);assert.equal(await f.bridge.request(f.binding,f.event,f.context),undefined);
  }finally{await f.close();}
});


test("native route authorizer requires exact protected reviewer and rejects broad or fallback policies",async()=>{
  const f=await fixture();try{
    const rules=[{profileId:"alex",externalUserId:"fixture-operator",channelId:"fixture-protected",agentId:"main",audience:"private" as const,brainDump:false}];
    const route={channel:"discord",to:"channel:fixture-protected",audience:"private" as const};
    const config={approvals:{plugin:{enabled:true,mode:"targets",agentFilter:["main"],targets:[{channel:"discord",to:route.to}]}},channels:{discord:{execApprovals:{enabled:false,approvers:["fixture-operator"]}}}};
    assert.equal(nativeApprovalRouteAuthorized(config,f.binding,rules,route),true);
    const missing=structuredClone(config);delete (missing.channels.discord.execApprovals as {approvers?:string[]}).approvers;
    assert.equal(nativeApprovalRouteAuthorized(missing,f.binding,rules,route),false);
    const broad=structuredClone(config);broad.channels.discord.execApprovals.approvers.push("someone-else");assert.equal(nativeApprovalRouteAuthorized(broad,f.binding,rules,route),false);
    const wrong=structuredClone(config);wrong.approvals.plugin.targets[0].to="channel:other";assert.equal(nativeApprovalRouteAuthorized(wrong,f.binding,rules,route),false);
    const fanout=structuredClone(config);fanout.channels.discord.execApprovals.enabled=true;assert.equal(nativeApprovalRouteAuthorized(fanout,f.binding,rules,route),false);
    const account={...config,channels:{discord:{...config.channels.discord,accounts:{other:{execApprovals:{approvers:["someone-else"]}}}}}};
    assert.equal(nativeApprovalRouteAuthorized(account,f.binding,rules,route),false);
  }finally{await f.close();}
});
