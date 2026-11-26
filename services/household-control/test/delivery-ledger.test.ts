import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Conversation, HouseholdAgentAdapter, HouseholdAgentEvent, HouseholdAgentRunState, HouseholdGoalMutation, HouseholdSubmitMessage } from "../src/domain.ts";
import { HouseholdDatabase } from "../src/database.ts";
import { SqliteHouseholdStore } from "../src/sqlite-household-store.ts";
import type { DeliveryOptions } from "../src/sqlite-household-store.ts";
import { ArtifactStore } from "../src/platform/artifacts.ts";
import { NativeAdmission } from "../src/domain-runtime/native-admission.ts";
import type { OpenClawAgentAdapter } from "../src/openclaw-adapter.ts";

class RecordingAdapter implements HouseholdAgentAdapter {
  readonly mode = "mock" as const;
  sends = 0;
  resumes = 0;
  states = new Map<string, HouseholdAgentRunState>();
  unknownSend = false;
  goalId = "goal-fixture";
  beforeSend: (() => Promise<void>) | undefined;
  async ensureConversation(_conversation: Conversation) {}
  async listMessages(_conversation: Conversation) { return []; }
  async submitMessage(args: HouseholdSubmitMessage) {
    await this.beforeSend?.();
    args.assertAdmission?.();
    this.sends++;
    if (this.unknownSend) throw Object.assign(new Error("gateway_send_unknown"), { deliveryOutcome:"unknown",retryable:false });
    const runId = `run-${args.submissionId}`;
    this.states.set(args.conversation.id,{ status:"running",runId,updatedAt:new Date().toISOString() });
    return { submissionId:args.submissionId,conversationId:args.conversation.id,profileId:args.profile.id,agentId:args.profile.agentId,status:"running" as const,queuePosition:null,runId };
  }
  async getRunState(conversation: Conversation, _expectedRunId?: string) {
    return this.states.get(conversation.id) ?? { status:"unknown" as const,runId:null,updatedAt:null };
  }
  async mutateGoal(conversation: Conversation, operation: HouseholdGoalMutation, assertAdmission?: () => void) {
    assertAdmission?.(); this.resumes++;
    const runId = `goal-run-${operation.operationId}`;
    this.states.set(conversation.id,{ status:"running",runId,updatedAt:new Date().toISOString() });
    return { goalId:operation.goalId,runId,status:"active",replayed:false };
  }
  async getContext(conversation: Conversation) {
    return { sessionKey:conversation.sessionKey,sessionId:`native-${conversation.id}`,
      goal:{ id:this.goalId,objective:"Fixture goal",status:"active" as const,updatedAt:Date.now() },
      runId:null,continuationPending:false,parentSessionKey:null,contextTokens:32768,contextBudgetStatus:"ready" };
  }
  async cancel(_conversation: Conversation, _runId?: string) {}
  onEvent(_listener: (event: HouseholdAgentEvent) => void) { return () => {}; }
  async diagnostics() { return { status:"healthy" }; }
  async close() {}
}

async function fixture(options: DeliveryOptions = {}) {
  const database = new HouseholdDatabase(":memory:");
  const adapter = new RecordingAdapter();
  const store = new SqliteHouseholdStore(database,adapter,options);
  const profile = store.getProfile("alex")!;
  const conversations = await Promise.all([1,2,3].map(index => store.createConversation(profile,`Fixture ${index}`,null)));
  return { database,adapter,store,profile,conversations };
}

test("durable FIFO admission counts actual runs, including multiple conversations for one person", async () => {
  const f = await fixture();
  try {
    for (let index=0; index<3; index++) {
      const receipt = await f.store.submitMessage({ profile:f.profile,conversationId:f.conversations[index].id,text:`Message ${index}`,submissionId:`fifo-${index}` });
      assert.equal(receipt?.status,"queued");
      assert.equal(f.database.submissions.get(`fifo-${index}`)?.payload?.kind,"message");
    }
    assert.equal(f.adapter.sends,0);
    await f.store.reconcileRuns();
    assert.equal(f.adapter.sends,2);
    assert.equal(f.store.getSnapshot().activeRuns,2);
    assert.equal(f.store.getSnapshot().queuedRuns,1);
    f.adapter.states.set(f.conversations[0].id,{ status:"complete",runId:"run-fifo-0",updatedAt:new Date(Date.now()+1_000).toISOString() });
    await f.store.reconcileRuns();
    assert.equal(f.adapter.sends,3);
    assert.equal(f.database.getSubmission("fifo-2")?.receipt.status,"running");
    assert.equal(f.database.getSubmission("fifo-0")?.payload,null);
  } finally { await f.store.close(); }
});

test("a conversation's second submission cannot overtake its first active turn", async () => {
  const f = await fixture();
  try {
    await f.store.submitMessage({ profile:f.profile,conversationId:f.conversations[0].id,text:"First",submissionId:"conversation-first" });
    await f.store.submitMessage({ profile:f.profile,conversationId:f.conversations[0].id,text:"Second",submissionId:"conversation-second" });
    assert.equal(f.store.getConversationActivity(f.profile,f.conversations[0].id),"queued");
    await f.store.reconcileRuns();
    assert.equal(f.adapter.sends,1);
    assert.equal(f.database.getSubmission("conversation-second")?.receipt.status,"queued");
    assert.equal(f.store.getConversationActivity(f.profile,f.conversations[0].id),"running");
    assert.equal(f.store.getConversationActivity(f.profile,f.conversations[1].id),"idle");
    f.adapter.states.set(f.conversations[0].id,{ status:"complete",runId:"run-conversation-first",updatedAt:new Date(Date.now()+1_000).toISOString() });
    await f.store.reconcileRuns();
    assert.equal(f.store.getConversationActivity(f.profile,f.conversations[0].id),"running");
    f.adapter.states.set(f.conversations[0].id,{ status:"complete",runId:"run-conversation-second",updatedAt:new Date(Date.now()+1_000).toISOString() });
    await f.store.reconcileRuns();
    assert.equal(f.store.getConversationActivity(f.profile,f.conversations[0].id),"idle");
  } finally { await f.store.close(); }
});

test("unknown dispatch is retained for recovery without blind resending or releasing its reservation", async () => {
  const f = await fixture();
  try {
    f.adapter.unknownSend = true;
    await f.store.submitMessage({ profile:f.profile,conversationId:f.conversations[0].id,text:"Do not duplicate",submissionId:"unknown-delivery" });
    await f.store.reconcileRuns();
    await f.store.reconcileRuns();
    const saved = f.database.getSubmission("unknown-delivery")!;
    assert.equal(f.adapter.sends,1);
    assert.equal(saved.receipt.recoveryRequired,true);
    assert.equal(saved.receipt.failureCode,"gateway_send_outcome_unknown");
    assert.equal(f.store.getConversationActivity(f.profile,f.conversations[0].id),"idle");
    assert.equal(f.store.getSnapshot().activeRuns,1);
    assert.ok(saved.payload);
  } finally { await f.store.close(); }
});

test("queued delivery rechecks its originating device and never sends after revocation", async () => {
  const f = await fixture();
  try {
    const invitation = f.database.createInvitation("alex",15,"fixture-device-1234");
    const claimed = f.database.claimInvitation({ code:invitation.code,displayName:"Fixture",publicKeyDerBase64:"test-key-not-used-by-this-store-test" })!;
    await f.store.submitMessage({ profile:f.profile,conversationId:f.conversations[0].id,text:"Pending",submissionId:"revoked-queued",originDeviceId:claimed.deviceId });
    f.database.revokeDevice(claimed.deviceId);
    await f.store.reconcileRuns();
    assert.equal(f.adapter.sends,0);
    assert.equal(f.database.getSubmission("revoked-queued")?.receipt.failureCode,"delivery_authorization_revoked");
    assert.equal(f.database.getSubmission("revoked-queued")?.payload,null);
  } finally { await f.store.close(); }
});

test("native goal resume uses the same admitted ledger rather than an untracked RPC", async () => {
  let admission!: NativeAdmission;
  const f = await fixture({ sourceCapture: (id, text) => admission.captureAppSource(id, text) });
  const temporary = await mkdtemp(path.join(tmpdir(), "hardy-goal-resume-"));
  try {
    await assert.rejects(() => f.store.updateGoal(f.profile,f.conversations[0].id,{ goalId:"goal-fixture",operationId:"orphan-resume-operation",issuedAtMs:Date.now(),action:"resume" }), /goal_source_unavailable/);
    const artifacts = new ArtifactStore({ root: path.join(temporary, "artifacts") });
    await artifacts.initialize();
    admission = new NativeAdmission(f.database, f.adapter as unknown as OpenClawAgentAdapter, [], artifacts);
    const invitation = f.database.createInvitation("alex", 15, "goal-resume-device-1234");
    const enrolled = f.database.claimInvitation({ code: invitation.code, displayName: "Resume fixture", publicKeyDerBase64: "fixture-key-not-used-by-this-store-test" })!;
    await f.store.submitMessage({ profile:f.profile,conversationId:f.conversations[0].id,text:"Preserve this original verified household goal",submissionId:"resume-original-source",originDeviceId:enrolled.deviceId,
      taskContext:{mode:"conversation",artifactIds:[],expectedGoalId:"goal-fixture",expectedSessionId:`native-${f.conversations[0].id}`} });
    await f.store.reconcileRuns();
    const original = f.database.submissions.get("resume-original-source")!;
    assert.ok(original.taskContext?.sourceArtifactId);
    f.database.submissions.waiting(original.receipt.submissionId, original.receipt.runId);
    const result = await f.store.updateGoal(f.profile,f.conversations[0].id,{ goalId:"goal-fixture",operationId:"resume-operation",issuedAtMs:Date.now(),action:"resume" },enrolled.deviceId);
    assert.equal(result?.receipt?.status,"queued");
    assert.equal(f.adapter.resumes,0);
    await f.store.reconcileRuns();
    assert.equal(f.adapter.resumes,1);
    assert.equal(f.store.getSnapshot().activeRuns,1);
    assert.equal(f.database.getSubmission("resume-operation")?.receipt.goalId,"goal-fixture");
    const resumed = f.database.submissions.get("resume-operation")!;
    assert.equal(resumed.taskContext?.sourceReferenceId, original.receipt.submissionId);
    assert.equal(resumed.taskContext?.sourceArtifactId, original.taskContext!.sourceArtifactId);
    assert.equal(resumed.taskContext?.mode, original.taskContext!.mode);
  } finally { await f.store.close(); await rm(temporary, { recursive: true, force: true }); }
});

test("a cancelled dispatch cannot begin a new effect after its connection wait ends", async () => {
  const f = await fixture();
  let entered!: () => void;
  let release!: () => void;
  const enteredPromise = new Promise<void>(resolve => { entered=resolve; });
  const releasePromise = new Promise<void>(resolve => { release=resolve; });
  f.adapter.beforeSend = async () => { entered(); await releasePromise; };
  try {
    await f.store.submitMessage({ profile:f.profile,conversationId:f.conversations[0].id,text:"Cancel before sending",submissionId:"cancel-fenced" });
    const cycle = f.store.reconcileRuns();
    await enteredPromise;
    await f.store.cancel(f.profile,f.conversations[0].id);
    release();
    await cycle;
    assert.equal(f.adapter.sends,0);
    assert.equal(f.database.getSubmission("cancel-fenced")?.receipt.status,"cancelled");
  } finally { release(); await f.store.close(); }
});

test("a shared conversation read does not permit selecting its owner's agent for mutations", async () => {
  const f = await fixture();
  try {
    const shared = { ...f.conversations[0],id:"shared-fixture",sessionKey:"hardy-home:shared-fixture",audience:"household" as const };
    f.database.insertConversation(shared);
    const other = f.store.getProfile("natasha")!;
    assert.ok(f.store.getConversation(other,shared.id));
    assert.equal(await f.store.submitMessage({ profile:other,conversationId:shared.id,text:"No impersonation",submissionId:"shared-mutation" }),undefined);
    assert.equal(await f.store.cancel(other,shared.id),false);
  } finally { await f.store.close(); }
});


test("checkpoint references use optimistic revisions and exact current native bindings", async () => {
  const f = await fixture();
  try {
    const conversationId = f.conversations[0].id;
    const context = (await f.store.getContext(f.profile,conversationId))!;
    assert.equal(await f.store.getCheckpoint(f.profile,conversationId),null);
    const update = { nativeSessionId:context.sessionId!,nativeGoalId:context.goal!.id,expectedRevision:0,phase:"gathering",checkpointArtifactId:"artifact-fixture" };
    const first = (await f.store.updateCheckpoint(f.profile,conversationId,update))!;
    assert.equal(first.revision,1);
    await assert.rejects(f.store.updateCheckpoint(f.profile,conversationId,update),/checkpoint_revision_conflict/);
    const next = (await f.store.updateCheckpoint(f.profile,conversationId,{ ...update,expectedRevision:1,phase:"waiting_input",questionArtifactId:"question-fixture" }))!;
    assert.equal(next.revision,2);
    f.adapter.goalId = "new-goal";
    assert.equal(await f.store.getCheckpoint(f.profile,conversationId),null);
    await assert.rejects(f.store.updateCheckpoint(f.profile,conversationId,{ ...update,expectedRevision:2 }),/checkpoint_native_binding_changed/);
    assert.equal(f.database.getCheckpoint(conversationId,context.sessionId!,context.goal!.id)?.revision,2);
  } finally { await f.store.close(); }
});

test("goal-free question replies retain exact null-goal binding through durable dispatch",async()=>{
  const f=await fixture();try{
    const original=f.adapter.getContext.bind(f.adapter);f.adapter.getContext=async conversation=>({...await original(conversation),goal:null} as any);
    const conversation=f.conversations[0],sessionId="native-"+conversation.id,question="artifact-"+"c".repeat(64);
    f.database.updateCheckpoint(conversation.id,{nativeSessionId:sessionId,nativeGoalId:null,expectedRevision:0,phase:"waiting_for_user",checkpointArtifactId:"artifact-"+"b".repeat(64),questionArtifactId:question});
    const receipt=await f.store.submitMessage({profile:f.profile,conversationId:conversation.id,text:"November 12",submissionId:"goal-free-answer",taskContext:{mode:"conversation",artifactIds:[],replyToQuestionId:question}});
    assert.equal(receipt?.status,"queued");assert.equal(f.database.submissions.get("goal-free-answer")!.taskContext!.expectedGoalId,null);
    await f.store.reconcileRuns();assert.equal(f.adapter.sends,1);assert.equal(f.database.submissions.get("goal-free-answer")!.receipt.status,"running");
    await assert.rejects(()=>f.store.submitMessage({profile:f.profile,conversationId:conversation.id,text:"Other answer",submissionId:"wrong-question",taskContext:{mode:"conversation",artifactIds:[],replyToQuestionId:"artifact-"+"f".repeat(64)}}),/question_binding_conflict/);
  }finally{await f.store.close();}
});
