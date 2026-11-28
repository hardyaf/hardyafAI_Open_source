import test from "node:test";
import assert from "node:assert/strict";
import { buildCancellationLineage, cancelNativeLineage } from "../src/native-cancel-lineage.ts";
import { HouseholdDatabase } from "../src/database.ts";
import { SqliteHouseholdStore } from "../src/sqlite-household-store.ts";
import { ExecutionAuthorityRepository } from "../src/request-context.ts";
import type { ExecutionGrant } from "../src/request-context.ts";

function facts(agentId="household-workshop") {
  const conversation={sessionKey:"hardy-home:fixture",agentId:"main"};
  const native={...conversation,sessionKey:"agent:main:hardy-home:fixture",sessionId:"root-generation",goal:null,runId:null,
    continuationPending:false,parentSessionKey:null,contextTokens:131072,contextBudgetStatus:"ready"};
  const source={id:"source-one",runId:"root-run",status:"running"};
  const parent:ExecutionGrant={sessionKey:conversation.sessionKey,rootSessionKey:conversation.sessionKey,sourceId:source.id,parentSessionKey:null,
    agentId:"main",sessionId:native.sessionId,goalId:null,runId:source.runId,mode:"normal"};
  const child:ExecutionGrant={...parent,sessionKey:"agent:"+agentId+":subagent:child",parentSessionKey:parent.sessionKey,agentId,sessionId:"child-generation",runId:"child-run"};
  return {conversation,native,source,parent,child};
}
function transport(f= facts()) {
  const lineage=buildCancellationLineage(f.conversation,f.native,f.source,f.parent,[f.child],"root-run")!;
  const root:any={key:f.native.sessionKey,agentId:"main",sessionId:f.native.sessionId,goal:null,hasActiveRun:false,activeRunIds:[]};
  const child:any={key:f.child.sessionKey,agentId:f.child.agentId,parentSessionKey:f.native.sessionKey,sessionId:f.child.sessionId,hasActiveRun:true,activeRunIds:[f.child.runId],status:"running"};
  const aborted:Array<{key:string;runId:string}>=[];
  const ports={assertCurrent(){},async describe(target:{sessionKey:string}){return target.sessionKey===f.conversation.sessionKey?root:child;},
    async abort(target:{sessionKey:string},runId:string){assert.ok(runId);aborted.push({key:target.sessionKey,runId});if(target.sessionKey===f.child.sessionKey){child.hasActiveRun=false;child.activeRunIds=[];child.status="interrupted";}}};
  return {f,lineage,root,child,aborted,ports};
}

test("missing native parent run projection can use exact existing source/child grants for either helper",async()=>{
  for(const kind of ["household-analysis","household-workshop","main"]){const t=transport(facts(kind));
    assert.equal(t.lineage.rootRunId,"root-run");await cancelNativeLineage(t.f.conversation,t.lineage,t.ports);
    assert.deepEqual(t.aborted,[{key:t.f.child.sessionKey,runId:"child-run"},{key:t.f.conversation.sessionKey,runId:"root-run"}]);
  }
});

test("stale, foreign, completed and goal-bound authority cannot create a cancellation lineage",()=>{
  const f=facts();
  for(const parent of [{...f.parent,sourceId:"foreign"},{...f.parent,sessionId:"old-generation"},{...f.parent,runId:"old-run"},{...f.parent,goalId:"active-goal"}])
    assert.equal(buildCancellationLineage(f.conversation,f.native,f.source,parent,[f.child],"root-run"),null);
  for(const child of [{...f.child,sourceId:"foreign"},{...f.child,agentId:"unrelated-agent"},{...f.child,parentSessionKey:"foreign-parent"},{...f.child,runId:null}])
    assert.equal(buildCancellationLineage(f.conversation,f.native,f.source,f.parent,[child],"root-run"),null);
  assert.equal(buildCancellationLineage(f.conversation,{...f.native,runId:"newer-run"},f.source,f.parent,[f.child],"root-run"),null);
  assert.equal(buildCancellationLineage(f.conversation,f.native,{...f.source,status:"complete"},f.parent,[f.child],"root-run"),null);
});

test("all native child bindings are validated before the first abort",async()=>{
  for(const mutate of [(t:any)=>t.child.parentSessionKey="foreign-parent",(t:any)=>t.child.sessionId="new-generation",
    (t:any)=>t.child.activeRunIds=["newer-run"],(t:any)=>t.root.sessionId="new-root-generation",(t:any)=>t.root.activeRunIds=["newer-root"]]){
    const t=transport();mutate(t);await assert.rejects(()=>cancelNativeLineage(t.f.conversation,t.lineage,t.ports),/cancel_target_conflict/);assert.equal(t.aborted.length,0);
  }
});

test("revocation across an observation await sends no abort; revocation after an abort is uncertain",async()=>{
  const before=transport();let revoked=false;before.ports.assertCurrent=()=>{if(revoked)throw Error("revoked");};
  const describe=before.ports.describe;before.ports.describe=async target=>{const row=await describe(target);revoked=true;return row;};
  await assert.rejects(()=>cancelNativeLineage(before.f.conversation,before.lineage,before.ports),/revoked/);assert.equal(before.aborted.length,0);
  const after=transport();revoked=false;after.ports.assertCurrent=()=>{if(revoked)throw Error("revoked");};
  const abort=after.ports.abort;after.ports.abort=async(target,runId)=>{await abort(target,runId);revoked=true;};
  await assert.rejects(()=>cancelNativeLineage(after.f.conversation,after.lineage,after.ports),(e:any)=>e.code==="gateway_cancel_unconfirmed"&&e.outcome==="unknown");
  assert.equal(after.aborted.length,1);
});

test("a newer root appearing after child cancellation is never aborted",async()=>{
  const t=transport(),abort=t.ports.abort;t.ports.abort=async(target,runId)=>{await abort(target,runId);t.root.activeRunIds=["newer-root-run"];};
  await assert.rejects(()=>cancelNativeLineage(t.f.conversation,t.lineage,t.ports),(e:any)=>e.outcome==="unknown");
  assert.deepEqual(t.aborted,[{key:t.f.child.sessionKey,runId:"child-run"}]);
});

test("an unconfirmed native abort is never reported as a stopped child",async()=>{
  const t=transport();t.ports.abort=async(target,runId)=>{t.aborted.push({key:target.sessionKey,runId});};
  await assert.rejects(()=>cancelNativeLineage(t.f.conversation,t.lineage,t.ports),(e:any)=>e.code==="gateway_cancel_unconfirmed"&&e.outcome==="unknown");
});

async function storeFixture(){
  const db=new HouseholdDatabase(":memory:");db.setProfileStatus("alex","available","Cancellation fixture");
  let calls=0;const adapter:any={mode:"mock",async ensureConversation(){},async listMessages(){return[];},onEvent(){return()=>{};},async diagnostics(){return{status:"healthy"};},async close(){},
    async getContext(c:any){return{sessionKey:`agent:main:${c.sessionKey}`,sessionId:"root-generation",goal:null,runId:null,continuationPending:false,parentSessionKey:null,contextTokens:131072,contextBudgetStatus:"ready"};},
    async cancelTarget(_c:any,_op:any,current:()=>void,lineage:any){current();assert.equal(lineage.children[0].runId,"child-run");assert.equal(lineage.rootRunId,"root-run");calls++;}};
  const store=new SqliteHouseholdStore(db,adapter,{dispatcherEnabled:false}),profile=store.getProfile("alex")!;
  const conversation=await store.createConversation(profile,"Waiting native child",null);
  await store.submitMessage({profile,conversationId:conversation.id,text:"Explore in the workshop",submissionId:"source-one"});
  db.domainConnection().prepare("UPDATE submissions SET status='running',run_id='root-run' WHERE id='source-one'").run();
  const authority=new ExecutionAuthorityRepository(db.domainConnection()),f=facts();
  authority.bind({...f.parent,sessionKey:conversation.sessionKey,rootSessionKey:conversation.sessionKey});
  authority.bind({...f.child,parentSessionKey:conversation.sessionKey,rootSessionKey:conversation.sessionKey});
  return{db,store,profile,conversation,authority,calls:()=>calls};
}

test("real store cancellation fences a yielded no-goal source and replays its exact control receipt",async()=>{
  const f=await storeFixture();try{
    const operation={operationId:"cancel-waiting-source",issuedAtMs:Date.now(),runId:"root-run"};
    const result=await f.store.cancelTarget(f.profile,f.conversation.id,operation);
    assert.equal(result.cancelled,true);assert.equal(f.db.submissions.get("source-one")!.receipt.status,"cancelled");
    assert.equal(f.db.getGoalControlIssuedAt(f.conversation.id),operation.issuedAtMs);
    assert.equal((await f.store.cancelTarget(f.profile,f.conversation.id,operation)).replayed,true);assert.equal(f.calls(),1);
  }finally{await f.store.close();}
});

test("real store refuses a changed native session generation before recording cancellation",async()=>{
  const f=await storeFixture();try{
    const parent=f.authority.get(f.conversation.sessionKey)!;f.authority.bind({...parent,sessionId:"stale-generation"});
    await assert.rejects(()=>f.store.cancelTarget(f.profile,f.conversation.id,{operationId:"cancel-stale-source",issuedAtMs:Date.now(),runId:"root-run"}),/cancel_target_conflict/);
    assert.equal(f.calls(),0);assert.equal(f.db.getGoalControlIssuedAt(f.conversation.id),0);
  }finally{await f.store.close();}
});
