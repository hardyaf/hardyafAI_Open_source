import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { HouseholdDatabase } from "../src/database.ts";
import { ArtifactStore } from "../src/platform/artifacts.ts";
import { NativeAdmission } from "../src/domain-runtime/native-admission.ts";
import { NativeDomainAuthorization } from "../src/domain-runtime/native-scope.ts";
import type { NativeObservation, NativeEntryRule } from "../src/domain-runtime/native-admission.ts";
import type { ProfileDomainGrant } from "../src/domain-runtime/native-scope.ts";
import type { OpenClawAgentAdapter } from "../src/openclaw-adapter.ts";

// Deferred until the owner opens the consolidated Slice 3 functional campaign.
// These exercise the real SQLite authority, source artifacts and admission code;
// the native transport alone is a fixture. They never call a provider or model.
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
async function fixture(audience: "private" | "household" = "private") {
  const temporary = await mkdtemp(path.join(tmpdir(), "hardy-native-admission-"));
  const database = new HouseholdDatabase(path.join(temporary, "household.sqlite"));
  database.domainConnection().prepare("UPDATE profiles SET role='admin',status='available',capabilities_json=? WHERE id='alex'")
    .run(JSON.stringify(["chat", "viewDiagnostics"]));
  database.setProfileStatus("natasha", "available", "Fixture household actor is explicitly enabled");
  const artifacts = new ArtifactStore({ root: path.join(temporary, "artifacts") });
  await artifacts.initialize();
  let goal: { id: string; status: string } | null = null;
  let nextContextGate: Promise<void> | null = null;
  let nextContextNotify: (() => void) | null = null;
  const adapter = { getContext: async () => { const gate = nextContextGate, notify = nextContextNotify; nextContextGate = null; nextContextNotify = null;
    if (gate) { notify?.(); await gate; } return { sessionId: "native-session", goal }; } } as unknown as OpenClawAgentAdapter;
  const rule: NativeEntryRule = { profileId: "alex", externalUserId: "fixture-human", channelId: "fixture-channel", agentId: "main", audience, brainDump: audience === "household" };
  const grant: ProfileDomainGrant = { enabled: true, domains: ["lists", "diagnostics"], scopes: ["personal", "household"], contactEditing: false,
    projectCodes: [], canManageProjects: false, canReviewReceipts: false, allowedAttendees: [], sharedDomains: ["lists"] };
  const rules = [rule, { ...rule, profileId: "natasha", externalUserId: "fixture-human-natasha" }];
  const mediaRoot=path.join(temporary,"native-media");await mkdir(mediaRoot,{mode:0o700});
  const options = { mediaRoot, schedulingEnabled: false, scheduledToolNames: [], profileGrants: { alex: grant, natasha: grant } };
  const createAdmission = () => new NativeAdmission(database, adapter, rules, artifacts, options);
  const admission = createAdmission();
  const observation: NativeObservation = { agentId: "main", runId: "native-run-one", sessionKey: "agent:main:discord:direct:fixture", sessionId: "native-session",
    channel: "discord", channelId: rule.channelId, senderId: rule.externalUserId, sourceMessageId: "fixture-message-one", sourceText: "Please keep this fixture request together.",
    exactCurrentMessage: true, inputProvenance: { kind: "external_user" } };
  const authorization = new NativeDomainAuthorization(database, { alex: grant, natasha: grant }, (packet, profileId) => admission.externalCurrent(packet, profileId));
  const nativeContext = () => ({ agentId: "main", sessionKey: observation.sessionKey!, sessionId: "native-session", nativeSessionId: "native-session",
    runId: observation.runId!, nativeRunId: observation.runId!, nativeGoalId: goal?.id ?? null, nativeGoalStatus: goal?.status ?? null, assertInvocationCurrent() {} });
  return { database, artifacts, admission, authorization, observation, nativeContext, createAdmission, rule, grant, mediaRoot, temporary, adapter,
    setGoal(value: typeof goal) { goal = value; },
    holdNextContext() { let release!: () => void; nextContextGate = new Promise<void>(resolve => { release = resolve; });
      const entered = new Promise<void>(resolve => { nextContextNotify = resolve; }); return { release, entered }; },
    sourceId: () => "native-turn-" + sha(observation.runId!).slice(0, 48),
    async close() { database.close(); await rm(temporary, { recursive: true, force: true }); } };
}

test("native source requires positive external-user provenance before any authority is created", async () => {
  const f = await fixture(); try {
    await assert.rejects(() => f.admission.admit({ ...f.observation, inputProvenance: undefined }), /verified_native_human_source_required/);
    for (const inputProvenance of [{ kind: "internal_system" }, { kind: "inter_session" }]) {
      await f.admission.admit({ ...f.observation, inputProvenance });
      assert.equal(f.database.submissions.get(f.sourceId()), undefined);
      assert.equal(f.admission.authority.get(f.observation.sessionKey!), null);
    }
    await f.admission.admit(f.observation);
    assert.equal(f.authorization.resolve(f.nativeContext()).principal.profileId, "alex");
  } finally { await f.close(); }
});

test("a carried sender without an exact current message cannot authorize household tools", async () => {
  const f = await fixture(); try {
    await assert.rejects(() => f.admission.admit({ ...f.observation, exactCurrentMessage: false, sourceMessageId: null }),
      /verified_native_discord_message_required/);
    assert.equal(f.database.submissions.get(f.sourceId()), undefined);
    assert.equal(f.admission.authority.get(f.observation.sessionKey!), null);
    await f.admission.admit(f.observation);
    assert.equal(f.authorization.resolve(f.nativeContext()).packet?.origin?.confirmedHuman, true);
  } finally { await f.close(); }
});

test("same-channel messages with identical text keep distinct exact provider identities", async () => {
  const f = await fixture(); try {
    await f.admission.admit(f.observation);
    const first = f.database.submissions.get(f.sourceId())!;
    const secondRun = "native-run-identical-text";
    const secondMessage = "fixture-second-provider-message";
    await f.admission.admit({ ...f.observation, runId: secondRun, sourceMessageId: secondMessage });

    const current = f.authorization.resolve({ ...f.nativeContext(), runId: secondRun, nativeRunId: secondRun });
    const second = f.database.submissions.get(current.principal.sourcePromptId)!;
    assert.notEqual(first.receipt.submissionId, second.receipt.submissionId);
    assert.equal(first.textHash, second.textHash);
    assert.equal(first.taskContext?.origin?.sourceId, f.observation.sourceMessageId);
    assert.equal(second.taskContext?.origin?.sourceId, secondMessage);
    assert.ok(first.taskContext?.sourceArtifactId && second.taskContext?.sourceArtifactId);
    assert.notEqual(first.taskContext?.sourceArtifactId, second.taskContext?.sourceArtifactId);
    assert.throws(() => f.authorization.resolve(f.nativeContext()), /native_run_authority_changed/);
  } finally { await f.close(); }
});

test("an exact provider message cannot grant an unconfigured Discord sender household authority", async () => {
  const f = await fixture(); try {
    await f.admission.admit(f.observation);
    const previous = f.admission.authority.get(f.observation.sessionKey!);
    const unrelatedRun = "native-unmapped-discord-actor";
    await f.admission.admit({ ...f.observation, runId: unrelatedRun, senderId: "unmapped-actor", sourceMessageId: "unrelated-provider-message" });
    assert.equal(f.database.submissions.get("native-turn-" + sha(unrelatedRun).slice(0, 48)), undefined);
    assert.deepEqual(f.admission.authority.get(f.observation.sessionKey!), previous);
    assert.throws(() => f.authorization.resolve({ ...f.nativeContext(), runId: unrelatedRun, nativeRunId: unrelatedRun }),
      /native_run_authority_changed/);
  } finally { await f.close(); }
});

test("admitted human text survives admission reconstruction through its immutable source artifact", async () => {
  const f = await fixture(); try {
    await f.admission.admit(f.observation);
    const submission = f.database.submissions.get(f.sourceId())!;
    assert.ok(submission.taskContext?.sourceArtifactId);
    const restored = await f.createAdmission().source(f.sourceId(), sha(f.observation.sourceText!));
    assert.deepEqual(restored, { id: "user:" + f.sourceId(), text: f.observation.sourceText, sha256: submission.textHash });
    await assert.rejects(() => f.createAdmission().source(f.sourceId(), sha("a different text")), /native_source_integrity_failed/);
  } finally { await f.close(); }
});

test("replayed native message reuses its original source and cannot become a fresh approval", async () => {
  const f = await fixture(); try {
    await f.admission.admit(f.observation);
    const originalId = f.sourceId();
    await f.admission.admit({ ...f.observation, runId: "native-run-replay" });
    assert.equal(f.admission.authority.get(f.observation.sessionKey!)?.sourceId, originalId);
    assert.equal(f.database.submissions.get("native-turn-" + sha("native-run-replay").slice(0, 48)), undefined);
    await assert.rejects(() => f.admission.admit({ ...f.observation, runId: "native-run-conflict", sourceText: "Different approval text" }), /native_human_source_conflict/);
  } finally { await f.close(); }
});

test("settled or waiting native human source cannot be resurrected by replay", async () => {
  const f = await fixture(); try {
    await f.admission.admit(f.observation);
    f.admission.settle(f.observation.sessionKey!, "main", "complete", true, f.observation.runId!);
    assert.equal(f.database.submissions.get(f.sourceId())?.receipt.status, "waiting_for_user");
    await assert.rejects(() => f.admission.admit({ ...f.observation, runId: "native-replayed-after-wait" }), /native_human_source_already_settled/);
    assert.throws(() => f.authorization.resolve(f.nativeContext()), /admitted_household_request_required/);
  } finally { await f.close(); }
});

test("explicit diagnosis requires a private operator source and cannot convert an active normal goal", async () => {
  const shared = await fixture("household"); try {
    await assert.rejects(() => shared.admission.admit({ ...shared.observation, sourceText: "!diagnose Explain the failure" }), /diagnostic_private_conversation_required/);
    assert.equal(shared.admission.authority.get(shared.observation.sessionKey!), null);
  } finally { await shared.close(); }
  const f = await fixture(); try {
    f.setGoal({ id: "active-normal-goal", status: "active" });
    await assert.rejects(() => f.admission.admit({ ...f.observation, sourceText: "!diagnose Explain the failure" }), /diagnostic_new_conversation_required/);
    assert.equal(f.admission.authority.get(f.observation.sessionKey!), null);
  } finally { await f.close(); }
});

test("diagnostic mode remains attached to the same native goal across a fresh normal reply", async () => {
  const f = await fixture(); try {
    await f.admission.admit({ ...f.observation, sourceText: "!diagnose Explain the failure" });
    const original = f.admission.authority.get(f.observation.sessionKey!)!;
    f.setGoal({ id: "diagnostic-goal", status: "active" });
    f.admission.authority.bind({ ...original, goalId: "diagnostic-goal" });
    await f.admission.admit({ ...f.observation, runId: "native-diagnostic-reply", sourceMessageId: "fixture-second-message", sourceText: "Yes, include the child logs" });
    assert.equal(f.admission.authority.get(f.observation.sessionKey!)?.mode, "diagnostic");
    assert.equal(f.admission.authority.get(f.observation.sessionKey!)?.goalId, "diagnostic-goal");
  } finally { await f.close(); }
});

test("registered native descendants inherit source and mode and cannot mint human authority", async () => {
  const f = await fixture(); try {
    await f.admission.admit({ ...f.observation, sourceText: "!diagnose Explain the failure" });
    const parent = f.admission.authority.get(f.observation.sessionKey!)!;
    const childSessionKey = "agent:main:subagent:fixture-child";
    await f.admission.child({ childSessionKey, agentId: "main", runId: "child-run" }, { requesterSessionKey: f.observation.sessionKey });
    const child = f.admission.authority.get(childSessionKey)!;
    assert.equal(child.sourceId, parent.sourceId); assert.equal(child.mode, "diagnostic");
    assert.equal(child.rootSessionKey, parent.rootSessionKey); assert.equal(child.parentSessionKey, parent.sessionKey);
    await f.admission.admit({ ...f.observation, sessionKey: childSessionKey, runId: "child-pretends-human", sourceMessageId: "child-message" });
    assert.deepEqual(f.admission.authority.get(childSessionKey), child);
    await assert.rejects(() => f.admission.child({ childSessionKey: "agent:main:subagent:orphan", agentId: "main", runId: "orphan-run" }, { requesterSessionKey: "agent:main:missing" }), /native_parent_authority_required/);
  } finally { await f.close(); }
});

test("native generation and root-goal status are checked before scoped tools are admitted", async () => {
  const f = await fixture(); try {
    await assert.rejects(() => f.admission.admit({ ...f.observation, sessionId: "obsolete-native-session" }), /native_session_generation_changed/);
    await f.admission.admit(f.observation);
    f.setGoal({ id: "current-root-goal", status: "active" });
    f.database.domainConnection().prepare("UPDATE submissions SET goal_id=?,domain_goal_bound=1 WHERE id=?").run("current-root-goal", f.sourceId());
    const active = f.nativeContext();
    assert.equal(f.authorization.resolve(active).principal.taskId, "current-root-goal");
    assert.throws(() => f.authorization.resolve({ ...active, nativeGoalId: "another-goal" }), /source_goal_not_active/);
    assert.throws(() => f.authorization.resolve({ ...active, nativeGoalStatus: "complete" }), /source_goal_not_active/);
    assert.throws(() => f.authorization.resolve({ ...active, nativeSessionId: "obsolete-native-session" }), /native_session_generation_changed/);
  } finally { await f.close(); }
});

test("an already retained household call loses authority when source mapping or control changes", async () => {
  const f = await fixture(); try {
    await f.admission.admit(f.observation);
    const retained = f.authorization.resolve(f.nativeContext());
    f.rule.channelId = "different-current-channel";
    assert.throws(() => retained.principal.assertCurrent(), /domain_authority_revoked/);
    f.rule.channelId = f.observation.channelId!;
    retained.principal.assertCurrent();
    f.database.recordGoalControl(retained.conversation.id, Date.now());
    assert.throws(() => retained.principal.assertCurrent(), /domain_authority_revoked/);
    assert.throws(() => f.authorization.resolve(f.nativeContext()), /household_request_context_changed/);
  } finally { await f.close(); }
});

test("a late first-actor admission cannot replace a newer shared actor after the native context await", { timeout: 10_000 }, async () => {
  const f = await fixture("household"); try {
    f.setGoal({ id: "same-household-goal", status: "active" });
    let firstCurrent = true;
    const gate = f.holdNextContext();
    const late = f.admission.admit({ ...f.observation, assertCurrent() { if (!firstCurrent) throw Error("fixture_stale_native_run"); } });
    // Deterministic barrier: the first source is captured and native getContext
    // has entered its await before another actor is admitted. No timing sleep.
    await gate.entered;
    firstCurrent = false;
    const secondRun = "native-second-actor-run";
    await f.admission.admit({ ...f.observation, runId: secondRun, senderId: "fixture-human-natasha", sourceMessageId: "fixture-second-actor-message", sourceText: "Use Natasha's shared prompt now" });
    const second = f.admission.authority.get(f.observation.sessionKey!)!;
    assert.equal(second.runId, secondRun);
    assert.equal(f.database.submissions.get(second.sourceId)?.receipt.profileId, "natasha");
    gate.release();
    await assert.rejects(late, /fixture_stale_native_run/);
    assert.deepEqual(f.admission.authority.get(f.observation.sessionKey!), second);
  } finally { await f.close(); }
});

test("switching current run/source revokes retained effects and fresh stale-run tool resolutions", async () => {
  const f = await fixture("household"); try {
    f.setGoal({ id: "same-household-goal", status: "active" });
    await f.admission.admit(f.observation);
    const retained = f.authorization.resolve(f.nativeContext());
    const secondRun = "native-second-actor-run";
    await f.admission.admit({ ...f.observation, runId: secondRun, senderId: "fixture-human-natasha", sourceMessageId: "fixture-second-actor-message", sourceText: "Use Natasha's shared prompt now" });
    assert.throws(() => retained.principal.assertCurrent(), /native_run_authority_changed/);
    assert.throws(() => f.authorization.resolve(f.nativeContext()), /native_run_authority_changed/);
    const current = f.authorization.resolve({ ...f.nativeContext(), runId: secondRun, nativeRunId: secondRun });
    assert.equal(current.principal.profileId, "natasha");
    assert.equal(current.principal.taskId, "same-household-goal");
  } finally { await f.close(); }
});

test("positive native continuation changes run authority while retaining the original human source and active goal", async () => {
  const f = await fixture(); try {
    f.setGoal({ id: "original-active-goal", status: "active" });
    await f.admission.admit(f.observation);
    const original = f.admission.authority.get(f.observation.sessionKey!)!;
    const continuedRun = "native-productive-continuation";
    await f.admission.admit({ ...f.observation, runId: continuedRun, inputProvenance: { kind: "internal_system" }, exactCurrentMessage: false, sourceMessageId: null, sourceText: "Internal child completion data" });
    const continued = f.admission.authority.get(f.observation.sessionKey!)!;
    assert.equal(continued.sourceId, original.sourceId); assert.equal(continued.goalId, original.goalId); assert.equal(continued.runId, continuedRun);
    const current = f.authorization.resolve({ ...f.nativeContext(), runId: continuedRun, nativeRunId: continuedRun });
    assert.equal(current.principal.sourcePromptId, original.sourceId);
    assert.equal((await f.admission.source(original.sourceId, sha(f.observation.sourceText!)))?.text, f.observation.sourceText);
    f.setGoal(null);
    await assert.rejects(() => f.admission.admit({ ...f.observation, runId: "native-continuation-after-goal-clear", inputProvenance: { kind: "internal_system" } }), /native_continuation_goal_changed/);
    assert.deepEqual(f.admission.authority.get(f.observation.sessionKey!), continued);
  } finally { await f.close(); }
});


test("trusted current continuation grant authorizes original-goal prompt before public active-run projection", async () => {
  const f=await fixture();try{
    f.setGoal({id:"original-native-goal",status:"active"});await f.admission.admit(f.observation);
    const sourceId=f.sourceId(),continuation={...f.observation,runId:"native-parent-announcement",inputProvenance:{kind:"inter_session"},sourceText:"Child completed",exactCurrentMessage:false};
    await f.admission.admit(continuation);
    const context={...f.nativeContext(),runId:continuation.runId,nativeRunId:null};
    const scope=f.authorization.resolve(context);assert.equal(scope.principal.sourcePromptId,sourceId);assert.equal(scope.principal.taskId,"original-native-goal");scope.principal.assertCurrent();
    assert.throws(()=>f.authorization.resolve({...context,runId:"unregistered-run"}),/native_run_authority_changed/);
    assert.throws(()=>f.authorization.resolve({...context,sessionId:"different-generation",nativeSessionId:"different-generation"}),/native_request_lineage_not_authorized/);
    assert.throws(()=>f.authorization.resolve({...context,nativeGoalId:"different-goal"}),/native_request_lineage_not_authorized|source_goal_not_active/);
    assert.throws(()=>f.authorization.resolve({...context,nativeGoalStatus:"paused"}),/native_request_lineage_not_authorized|source_goal_not_active/);
    const grant=f.admission.authority.get(f.observation.sessionKey!)!;
    f.admission.authority.bind({...grant,rootSessionKey:"unrelated-root-session"});
    assert.throws(()=>f.authorization.resolve(context),/native_request_lineage_not_authorized/);
    f.database.submissions.enqueue({submissionId:"unadmitted-other-source",conversationId:scope.principal.conversationId,profileId:"alex",agentId:"main",textHash:sha("Different queued source"),requestHash:"different-source",payload:{kind:"message",text:"Different queued source"}});
    f.admission.authority.bind({...grant,sourceId:"unadmitted-other-source"});
    assert.throws(()=>f.authorization.resolve(context),/admitted_household_request_required/);
    f.admission.authority.bind({...grant,runId:"newer-admitted-turn"});
    assert.throws(()=>scope.principal.assertCurrent(),/native_run_authority_changed/);
  }finally{await f.close();}
});


test("Discord staged originals enter owned artifacts and survive native admission and reconstruction",async()=>{
  const f=await fixture();try{
    const original=Buffer.from([137,80,78,71,13,10,26,10,1,2,3]),file=path.join(f.mediaRoot,"card.png");await writeFile(file,original,{mode:0o600});
    const event={content:f.observation.sourceText,media:[{path:file,contentType:"image/png",messageId:f.observation.sourceMessageId}]};
    const context={channelId:"discord",conversationId:f.rule.channelId,senderId:f.rule.externalUserId,messageId:f.observation.sourceMessageId,runId:f.observation.runId,sessionKey:f.observation.sessionKey};
    await f.admission.inbound(event,context);await f.admission.admit(f.observation);
    const packet=f.database.submissions.get(f.sourceId())!.taskContext!;
    assert.equal(packet.artifactIds.length,1);
    const item=await f.artifacts.read(packet.artifactIds[0],{profileId:"alex",canReadHousehold:true});
    assert.deepEqual(item.bytes,original);assert.equal(item.metadata.taskId,f.sourceId());assert.equal(item.metadata.audience,"private");
    assert.equal(item.metadata.kind,"input");
    await f.createAdmission().inbound(event,context);assert.deepEqual(f.database.submissions.get(f.sourceId())!.taskContext!.artifactIds,packet.artifactIds);
  }finally{await f.close();}
});

test("Discord media ignores unconfigured channels and refuses outside paths or mismatched messages",async()=>{
  const f=await fixture();try{
    const file=path.join(f.temporary,"outside.png");await writeFile(file,Buffer.from([137,80,78,71,13,10,26,10]),{mode:0o600});
    const event={content:f.observation.sourceText,media:[{path:file,contentType:"image/png",messageId:f.observation.sourceMessageId}]};
    const context={channelId:"discord",conversationId:f.rule.channelId,senderId:f.rule.externalUserId,messageId:f.observation.sourceMessageId,runId:f.observation.runId,sessionKey:f.observation.sessionKey};
    await f.admission.inbound(event,{...context,conversationId:"unconfigured"});assert.equal(f.database.submissions.get(f.sourceId()),undefined);
    await assert.rejects(()=>f.admission.inbound(event,context),/discord_attachment_path_not_authorized/);
    const inside=path.join(f.mediaRoot,"card.png");await writeFile(inside,Buffer.from([137,80,78,71,13,10,26,10]),{mode:0o600});
    await assert.rejects(()=>f.admission.inbound({...event,media:[{path:inside,contentType:"image/png",messageId:"another-message"}]},context),/discord_attachment_message_conflict/);
    const link=path.join(f.mediaRoot,"link.png");await symlink(inside,link);
    await assert.rejects(()=>f.admission.inbound({...event,media:[{path:link,contentType:"image/png"}]},context),/discord_attachment_file_invalid/);
  }finally{await f.close();}
});


test("a current image-only Discord prompt admits its owned original without borrowing old text",async()=>{
  const f=await fixture();try{
    const file=path.join(f.mediaRoot,"card.png");await writeFile(file,Buffer.from([137,80,78,71,13,10,26,10]),{mode:0o600});
    await f.admission.inbound({content:"",media:[{path:file,contentType:"image/png"}]},{channelId:"discord",conversationId:f.rule.channelId,senderId:f.rule.externalUserId,messageId:f.observation.sourceMessageId,runId:f.observation.runId,sessionKey:f.observation.sessionKey});
    await f.admission.admit({...f.observation,sourceText:""});
    const current=f.authorization.resolve(f.nativeContext());assert.equal(current.packet?.artifactIds.length,1);
    assert.equal((await f.admission.source(f.sourceId(),sha("")))?.text,"");
  }finally{await f.close();}
});


test("scheduled admission and every later call recheck saved delivery against current route grants",async()=>{
  const f=await fixture();try{
    await f.admission.admit(f.observation);
    const origin=f.database.findConversationBySessionKey(f.observation.sessionKey!)!;
    const job={id:"scheduled-fixture-job",agentId:"main",enabled:true,configRevision:"fixture-revision-1",owner:{agentId:"main",sessionKey:origin.sessionKey},declarationKey:"household:"+sha("alex").slice(0,20)+":"+sha(origin.id).slice(0,20)+":fixture",
      description:"Household task; audience=personal",payload:{kind:"agentTurn",message:"Read current goal status",toolsAllow:["get_goal"],toolsAllowIsDefault:false},delivery:{mode:"announce",channel:"discord",to:"channel:"+f.rule.channelId}};
    const grant={...f.grant,domains:[...f.grant.domains,"schedule"]};
    const adapter={...f.adapter,requestDomainCapability:async()=>({job})} as unknown as OpenClawAgentAdapter;
    const admission=new NativeAdmission(f.database,adapter,[f.rule],f.artifacts,{schedulingEnabled:true,scheduledToolNames:["get_goal"],profileGrants:{alex:grant}});
    const observation={...f.observation,runId:"native-scheduled-delivery",sessionKey:"agent:main:cron:fixture",channel:null,senderId:null,sourceMessageId:null,sourceText:null,jobId:job.id,inputProvenance:{kind:"internal_system"}};
    await admission.admit(observation);
    const source=f.database.submissions.get("native-cron-"+sha(observation.runId).slice(0,48))!;
    assert.equal(source.taskContext?.scheduledDelivery?.mode,"announce");
    assert.equal(admission.externalCurrent(source.taskContext!,"alex"),true);
    f.rule.channelId="revoked-old-channel";
    assert.equal(admission.externalCurrent(source.taskContext!,"alex"),false);
    await assert.rejects(()=>admission.admit({...observation,runId:"native-scheduled-after-revocation",sessionKey:"agent:main:cron:fixture-revoked-run"}),{code:"scheduled_delivery_route_not_authorized"});
  }finally{await f.close();}
});

test("only canonical staged media grants custody; provider-side originals and pending staging do not",async()=>{
  const f=await fixture();try{
    const original=path.join(f.mediaRoot,"original.png"),normalized=path.join(f.mediaRoot,"normalized.png");
    const originalBytes=Buffer.from([137,80,78,71,13,10,26,10,1]),normalizedBytes=Buffer.from([137,80,78,71,13,10,26,10,2]);
    await writeFile(original,originalBytes,{mode:0o600});await writeFile(normalized,normalizedBytes,{mode:0o600});
    const context={channelId:"discord",conversationId:f.rule.channelId,senderId:f.rule.externalUserId,messageId:f.observation.sourceMessageId,runId:f.observation.runId,sessionKey:f.observation.sessionKey};
    const event={content:f.observation.sourceText,media:[{path:normalized,contentType:"image/png"}],originalMedia:[{path:original,contentType:"image/png"}]};
    await assert.rejects(()=>f.admission.inbound({...event,mediaStagingPending:true},context),{code:"discord_original_media_staging_pending"});
    assert.equal(f.database.submissions.get(f.sourceId()),undefined);
    await f.admission.inbound(event,context);
    const packet=f.database.submissions.get(f.sourceId())!.taskContext!;
    assert.deepEqual((await f.artifacts.read(packet.artifactIds[0],{profileId:"alex",canReadHousehold:true})).bytes,normalizedBytes);
  }finally{await f.close();}
});


test("supported native attachment metadata waits for the exact cross-registry owned receipt",async()=>{
  const f=await fixture();try{
    const file=path.join(f.mediaRoot,"late-card.png");await writeFile(file,Buffer.from([137,80,78,71,13,10,26,10]),{mode:0o600});
    const run=f.admission.admit({...f.observation,supportedMediaExpected:true});
    await new Promise(resolve=>setTimeout(resolve,30));
    await f.createAdmission().inbound({content:f.observation.sourceText,media:[{path:file,contentType:"image/png"}]},{channelId:"discord",conversationId:f.rule.channelId,senderId:f.rule.externalUserId,messageId:f.observation.sourceMessageId,runId:f.observation.runId,sessionKey:f.observation.sessionKey});
    await run;assert.equal(f.authorization.resolve(f.nativeContext()).packet?.artifactIds.length,1);
  }finally{await f.close();}
});
