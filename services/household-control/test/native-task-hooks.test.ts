import test from "node:test";
import assert from "node:assert/strict";
import { nativeTurnObservation, registerNativeTaskBridge } from "../../../plugins/household-domains/native-task-hooks.mjs";

function bridge(overrides: Record<string, unknown> = {}) {
  const hooks = new Map<string, Function>(), internal = new Map<string, Function>();
  const registrations = new Map<string, Record<string, unknown>>();
  let policy: { evaluate: Function }, factory: { create: Function };
  const observations: string[] = [];
  const api = { id: "hardy-household", config: { plugins: { entries: { "hardy-household": { hooks: { allowConversationAccess: true, allowPromptInjection: true } } } } },
    on(name: string, handler: Function, options: Record<string, unknown> = {}) { hooks.set(name, handler); registrations.set(name, options); }, registerHook(name: string, handler: Function) { internal.set(name, handler); },
    registerTrustedToolPolicy(value: { evaluate: Function }) { policy = value; }, registerTool(value: { create: Function }) { factory = value; }, logger: { error() {}, info(value: string) { observations.push(value); } } };
  const calls: string[] = [];
  const context = { assertCurrent() {} };
  const ports = { isManagedAgent: () => true, catalog: () => [], execute: async () => ({}),
    admitNativeTurn: async (_event: unknown, _context: unknown, observation: { hook: string }) => { calls.push(observation.hook); },
    bindInvocation: async () => {}, registerNativeChild: async () => {}, getTaskContext: async () => context,
    prompt: async () => ({ appendContext: "task" }), finalize: async () => undefined,
    guard: async () => ({ allow: false, reason: "diagnosis_only" }), bootstrapAccess: async () => "unknown", ...overrides };
  registerNativeTaskBridge(api, ports);
  return { hooks, internal, calls, policy: policy!, context, registrations, factory: () => factory!, observations };
}
test("native observation never treats explicit empty source as historical prompt", () => {
  const observation = nativeTurnObservation("before_prompt_build", { currentUserMessage: "", prompt: "old historical text", currentUserMessageId: "native-source-b" },
    { runId: "run-b", sessionKey: "session", channel: "discord", senderId: "immutable-person" });
  assert.equal(observation.sourceText, "");
  assert.equal(observation.sourceMessageId, "native-source-b");
  assert.equal(observation.senderId, "immutable-person");
});
test("bridge admits before model and policy assembly, and rechecks exact prompt", async () => {
  const b = bridge(), event = { prompt: "actual turn" }, context = { agentId: "main", sessionKey: "conversation", runId: "run-a" };
  await b.hooks.get("before_model_resolve")!(event, context);
  await b.hooks.get("agent_turn_prepare")!(event, context);
  await b.hooks.get("before_prompt_build")!({ ...event, currentUserMessage: "actual turn", currentUserMessageId: "source-a" }, context);
  assert.deepEqual(b.calls, ["before_model_resolve", "agent_turn_prepare", "before_prompt_build"]);
});
test("requester-settle admission waits for trusted native provenance missing from model resolution", async () => {
  const seen: unknown[] = [];
  const provenance = { kind: "inter_session", sourceTool: "subagent_settle", sourceSessionKey: "exact-child" };
  const b = bridge({
    admitNativeTurn: async (_event: unknown, _context: unknown, observation: { inputProvenance: unknown }) => {
      seen.push(observation.inputProvenance);
      if (observation.inputProvenance !== provenance) throw Error("untrusted_wake");
    },
  });
  const event = { prompt: "native completion" };
  const base = { agentId: "main", sessionKey: "parent", sessionId: "session", runId: "announce:requester-settle:fixture" };
  await b.hooks.get("before_model_resolve")!(event, base);
  assert.deepEqual(seen, []);
  const trusted = { ...base, inputProvenance: provenance };
  await b.hooks.get("agent_turn_prepare")!(event, trusted);
  assert.equal((await b.hooks.get("before_prompt_build")!(event, trusted)).appendContext, "task");
  assert.deepEqual(seen, [provenance, provenance]);

  const unsigned = { ...base, runId: base.runId + ":unsigned" };
  await b.hooks.get("before_model_resolve")!(event, unsigned);
  assert.deepEqual((await b.hooks.get("before_prompt_build")!(event, unsigned)).toolsAllow, []);
  assert.equal((await b.policy.evaluate({ toolName: "household_analysis_result", params: {} }, unsigned)).allow, false);
});
function discordPromptContext(runId: string) {
  return { agentId: "main", sessionKey: "agent:main:discord:channel:fixture-channel", sessionId: "fixture-session", runId,
    channel: "discord", channelId: "fixture-channel", senderId: "fixture-human", trigger: "user" };
}

test("ordinary Discord admission waits for the exact native current message", async () => {
  const seen: ReturnType<typeof nativeTurnObservation>[] = [];
  const b = bridge({ admitNativeTurn: async (_event: unknown, _context: unknown, observation: ReturnType<typeof nativeTurnObservation>) => {
    seen.push(observation);
  } });
  const context = discordPromptContext("discord-exact-run");
  const prepared = { prompt: "Prepared history includes a different earlier request", messages: [{ role: "user", content: "Earlier request" }] };
  await b.hooks.get("before_model_resolve")!(prepared, context);
  await b.hooks.get("agent_turn_prepare")!(prepared, { ...context, inputProvenance: { kind: "external_user" } });
  assert.deepEqual(seen, []);

  const current = { ...prepared, currentUserMessage: "A fresh Discord request", currentUserMessageId: "fixture-provider-message" };
  const prompt = await b.hooks.get("before_prompt_build")!(current, { ...context, inputProvenance: { kind: "external_user" } });
  assert.equal(prompt.appendContext, "task");
  assert.deepEqual(seen.map(({ hook, runId, sourceMessageId, sourceText, exactCurrentMessage, inputProvenance }) =>
    ({ hook, runId, sourceMessageId, sourceText, exactCurrentMessage, inputProvenance })), [{
    hook: "before_prompt_build", runId: context.runId, sourceMessageId: current.currentUserMessageId,
    sourceText: current.currentUserMessage, exactCurrentMessage: true, inputProvenance: { kind: "external_user" },
  }]);
});

test("a final Discord prompt cannot use historical text or omit verified native provenance", async () => {
  let contextReads = 0;
  const b = bridge({
    admitNativeTurn: async (_event: unknown, _context: unknown, observation: ReturnType<typeof nativeTurnObservation>) => {
      if (observation.inputProvenance?.kind !== "external_user" || !observation.exactCurrentMessage || !observation.sourceMessageId)
        throw Object.assign(Error("unverified Discord source"), { code: "verified_native_discord_message_required" });
    },
    getTaskContext: async () => { contextReads++; return { assertCurrent() {} }; },
    guard: async () => ({ allow: true }),
  });
  const prepared = { prompt: "Earlier text cannot establish a current source", messages: [{ role: "user", content: "Earlier text" }] };
  const complete = { ...prepared, currentUserMessage: "Current text", currentUserMessageId: "fixture-provider-message" };
  const external = { inputProvenance: { kind: "external_user" } };
  const cases = [
    { event: complete, context: discordPromptContext("discord-no-provenance") },
    { event: prepared, context: { ...discordPromptContext("discord-history-only"), ...external } },
    { event: { ...prepared, currentUserMessage: "Current text" }, context: { ...discordPromptContext("discord-no-message-id"), ...external } },
  ];
  for (const { event, context } of cases) {
    await b.hooks.get("before_model_resolve")!(prepared, discordPromptContext(context.runId));
    assert.deepEqual((await b.hooks.get("before_prompt_build")!(event, context)).toolsAllow, []);
    assert.equal((await b.policy.evaluate({ toolName: "household_lists_capture", params: {} }, context)).allow, false);
  }
  assert.equal(contextReads, 0);
});

test("native internal Discord continuation retains its earlier admission path", async () => {
  const b = bridge();
  const context = { ...discordPromptContext("discord-continuation"), inputProvenance: { kind: "inter_session", sourceTool: "subagent_settle" } };
  await b.hooks.get("before_model_resolve")!({ prompt: "Native continuation" }, context);
  assert.deepEqual(b.calls, ["before_model_resolve"]);
});

test("bootstrap scrubs before lookup and does not restore unknown/shared/private helper state", async () => {
  let observed: unknown;
  const b = bridge({ bootstrapAccess: async (event: { context: { bootstrapFiles: unknown[] } }) => { observed = event.context.bootstrapFiles; throw Error("lookup_failed"); } });
  const event = { sessionKey: "shared", context: { agentId: "main", bootstrapFiles: [{ name: "USER.md", content: "private" }, { name: "MEMORY.md", content: "private" }] } };
  await b.internal.get("agent:bootstrap")!(event);
  assert.deepEqual(observed, []);
  assert.deepEqual(event.context.bootstrapFiles, []);
  const helper = bridge({ bootstrapAccess: async () => "private" });
  event.context.agentId = "household-analysis";
  event.context.bootstrapFiles = [{ name: "USER.md", content: "private" }];
  await helper.internal.get("agent:bootstrap")!(event);
  assert.deepEqual(event.context.bootstrapFiles, []);
});
test("missing authority removes prompt tools and denies actual tools without restart-unsafe hooks", async () => {
  const b = bridge({ getTaskContext: async () => null });
  const context = { agentId: "main", sessionKey: "conversation-a", sessionId: "session-a", runId: "run-a" };
  const prompt = await b.hooks.get("before_prompt_build")!({ currentUserMessage: "actual request" }, context);
  assert.deepEqual(prompt.toolsAllow, []);
  for (const toolName of ["exec", "household_lists_capture", "create_goal", "sessions_spawn"])
    assert.equal((await b.policy.evaluate({ toolName, params: {} }, context)).allow, false);
  for (const name of ["before_dispatch", "before_agent_run", "before_message_write", "reply_dispatch"])
    assert.equal(b.hooks.has(name), false, "Native 2026.9.8 restart-unsafe hook must remain absent: " + name);
});
test("bridge requires both configured native conversation and prompt permissions", () => {
  const api = { id: "hardy-household", config: { plugins: { entries: { "hardy-household": { hooks: { allowConversationAccess: true, allowPromptInjection: false } } } } } };
  assert.throws(() => registerNativeTaskBridge(api, {}), /household_native_hook_permissions_required/);
});
test("failed fresh admission cannot fall back to an older goal/source through later native hooks", async () => {
  let contexts = 0;
  const b = bridge({ admitNativeTurn: async () => { throw Object.assign(Error("diagnostic mode rejected"), { code: "diagnostic_new_conversation_required" }); },
    getTaskContext: async () => { contexts++; return { assertCurrent() {} }; } });
  const context = { agentId: "main", sessionKey: "agent:main:conversation-a", sessionId: "session-a", runId: "rejected-run" };
  await b.hooks.get("before_model_resolve")!({ prompt: "diagnose this" }, context);
  const prompt = await b.hooks.get("before_prompt_build")!({ currentUserMessage: "diagnose this", currentUserMessageId: "new-human-b" }, context);
  assert.deepEqual(prompt.toolsAllow, []);
  assert.equal((await b.policy.evaluate({ toolName: "household_lists_add", params: {} }, context)).allow, false);
  assert.equal((await b.hooks.get("before_agent_finalize")!({}, context)).action, "finalize");
  assert.equal(contexts, 0);
});
test("a rejected run does not deny a separately admitted later run in the same conversation", async () => {
  const b = bridge({ admitNativeTurn: async (_event: unknown, context: {runId: string}) => { if (context.runId === "rejected-run") throw Error("source_rejected"); } });
  const base = { agentId: "main", sessionKey: "conversation-a", sessionId: "session-a" };
  await b.hooks.get("before_model_resolve")!({ prompt: "bad" }, { ...base, runId: "rejected-run" });
  const healthy = { ...base, runId: "accepted-run" };
  await b.hooks.get("before_model_resolve")!({ prompt: "good" }, healthy);
  const prompt = await b.hooks.get("before_prompt_build")!({ currentUserMessage: "good" }, healthy);
  assert.equal(prompt.appendContext, "task");
});
test("pending asynchronous admission cannot borrow an older context during a hook timeout window", async () => {
  let finish!: () => void, lookups = 0;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const b = bridge({ admitNativeTurn: async () => pending, getTaskContext: async () => { lookups++; return { assertCurrent() {} }; } });
  const context = { agentId: "main", sessionKey: "conversation-a", sessionId: "session-a", runId: "pending-run" };
  const admission = b.hooks.get("before_model_resolve")!({ prompt: "new request" }, context);
  assert.equal((await b.policy.evaluate({ toolName: "household_lists_capture", params: {} }, context)).allow, false);
  assert.equal((await b.hooks.get("before_tool_call")!({ toolName: "household_lists_capture", params: {} }, context)).block, true);
  assert.equal(lookups, 0);
  finish(); await admission;
});

test("ordinary prompt phase preserves conductor system context and tool narrowing", async () => {
  let assertions = 0;
  const b = bridge({ prompt: async () => ({ prependSystemContext: "Keep the original admitted goal and verify owned outcomes.",
    appendContext: "Current trusted task binding.", toolsAllow: ["household_task_context", "household_lists_capture"] }) });
  const registration = b.registrations.get("before_prompt_build")!;
  // Native ordinary dispatch excludes registrations requiring tool authority;
  // its authorized dispatch discards system context and toolsAllow altogether.
  assert.notEqual(registration.requiresToolAuthority, true);
  const prompt = await b.hooks.get("before_prompt_build")!({ prompt: "current request", messages: [] }, {
    agentId: "main", sessionKey: "conversation", sessionId: "native-session", runId: "native-run",
    hookInvocation: { assertActive() { assertions++; } },
  });
  assert.equal(prompt.prependSystemContext, "Keep the original admitted goal and verify owned outcomes.");
  assert.equal(prompt.appendContext, "Current trusted task binding.");
  assert.deepEqual(prompt.toolsAllow, ["household_task_context", "household_lists_capture"]);
  assert.equal(assertions, 2);
});

test("an expired ordinary prompt invocation cannot publish context or authorize later tools", async () => {
  let active = true;
  const b = bridge({ prompt: async () => { active = false; return { prependSystemContext: "stale context", toolsAllow: ["exec"] }; } });
  const context = { agentId: "main", sessionKey: "conversation", sessionId: "native-session", runId: "expired-run",
    hookInvocation: { assertActive() { if (!active) throw Object.assign(Error("expired"), { code: "native_invocation_expired" }); } } };
  const prompt = await b.hooks.get("before_prompt_build")!({ prompt: "new request", messages: [] }, context);
  assert.equal(prompt.prependSystemContext, undefined);
  assert.deepEqual(prompt.toolsAllow, []);
  assert.equal((await b.policy.evaluate({ toolName: "household_lists_capture", params: {} }, context)).allow, false);
});

test("a rejected run releases worker resources without settling an older source", async () => {
  const released: Array<{ event: unknown; context: unknown }> = [];
  let settlements = 0;
  const b = bridge({ admitNativeTurn: async () => { throw Object.assign(Error("source rejected"), { code: "native_source_rejected" }); },
    end: async () => { settlements++; }, release: async (event: unknown, context: unknown) => { released.push({ event, context }); } });
  const context = { agentId: "main", sessionKey: "conversation", sessionId: "native-session", runId: "rejected-run" };
  const event = { success: false, runId: "rejected-run" };
  await b.hooks.get("before_model_resolve")!({ prompt: "fresh rejected source" }, context);
  await b.hooks.get("agent_end")!(event, context);
  assert.equal(settlements, 0);
  assert.deepEqual(released, [{ event, context }]);
});

test("settlement errors still release worker resources in the same end callback", async () => {
  const order: string[] = [];
  const b = bridge({ end: async () => { order.push("settle"); throw Object.assign(Error("settlement failed"), { code: "native_settlement_failed" }); },
    release: async () => { order.push("release"); } });
  await b.hooks.get("agent_end")!({ success: true }, { agentId: "main", sessionKey: "conversation", runId: "accepted-run" });
  assert.deepEqual(order, ["settle", "release"]);
});

test("only an allowed trusted policy may bind exact cross-registry invocation proof", async () => {
  const descriptor = {name:"lists.capture",nativeName:"household_lists_capture",description:"Fixture",inputSchema:{type:"object"}};
  const bound: unknown[] = [], context = {agentId:"main",sessionKey:"private-session",sessionId:"private-generation",runId:"private-run"};
  const event={toolName:descriptor.nativeName,toolCallId:"private-call",runId:context.runId,params:{text:"private-payload"}};
  const allowed=bridge({catalog:()=>[descriptor],guard:async()=>({allow:true}),bindInvocation:async(...args:unknown[])=>{bound.push(args);}});
  assert.equal((await allowed.policy.evaluate(event,context)).allow,true);assert.equal(bound.length,1);
  const denied=bridge({catalog:()=>[descriptor],bindInvocation:async()=>{throw Error("must_not_bind");}});
  assert.equal((await denied.policy.evaluate(event,context)).allow,false);
  for(const value of [context.sessionKey,context.sessionId,context.runId,event.toolCallId,event.params.text])assert.equal(allowed.observations.join("\n").includes(value),false);
});


test("native staged-media custody failure fences the matching run before model tools",async()=>{
  const b=bridge({observeInbound:async()=>{throw Object.assign(Error("bad media"),{code:"discord_attachment_message_conflict"});}});
  const context={channelId:"discord",conversationId:"fixture-channel",sessionKey:"agent:main:discord:fixture",runId:"media-run"};
  await b.hooks.get("message_received")!({media:[{path:"/native/media/card.png"}]},context);
  const prompt=await b.hooks.get("before_prompt_build")!({currentUserMessage:"Scan card"},{...context,agentId:"main",channel:"discord",sessionId:"session"});
  assert.deepEqual(prompt.toolsAllow,[]);
});


test("native approval callback retains exact binding and never offers persistent trust",async()=>{
  const resolutions:unknown[]=[];
  const b=bridge({approvalRequest:async()=>({title:"Exact action",description:"Exact resource",allowedDecisions:["allow-always"]}),approvalResolved:async(...args:unknown[])=>{resolutions.push(args);}});
  const context={agentId:"main",sessionKey:"conversation",sessionId:"session",runId:"run",toolCallId:"call"},event={toolName:"household_task_bind_reply",runId:"run",toolCallId:"call",params:{relation:"answer",decision:"approve"}};
  const result=await b.hooks.get("before_tool_call")!(event,context);
  assert.deepEqual(result.requireApproval.allowedDecisions,["allow-once","deny"]);
  await result.requireApproval.onResolution("allow-once");
  assert.equal(resolutions.length,1);assert.equal(resolutions[0][0],b.context);assert.equal(resolutions[0][1],event);assert.equal(resolutions[0][3],"allow-once");
});


test("an eventual media-ready hook releases only its exact prior staging wait",async()=>{
  let ready=false;
  const b=bridge({observeInbound:async()=>{if(!ready)throw Object.assign(Error("staging"),{code:"discord_original_media_staging_pending"});}});
  const incoming={channelId:"discord",conversationId:"fixture-channel",sessionKey:"agent:main:discord:fixture",runId:"pending-media-run"};
  await b.hooks.get("message_received")!({},incoming);
  assert.equal((await b.hooks.get("before_prompt_build")!({currentUserMessage:"Scan card"},{...incoming,agentId:"main",sessionId:"session"})).toolsAllow.length,0);
  ready=true;await b.hooks.get("message_received")!({},incoming);
  assert.equal((await b.hooks.get("before_prompt_build")!({currentUserMessage:"Scan card"},{...incoming,agentId:"main",sessionId:"session"})).appendContext,"task");
});

test("tool execution awaits the exact fire-and-forget native approval persistence callback",async()=>{
  const descriptor={name:"task.bind_reply",nativeName:"household_task_bind_reply",description:"Bind exact human decision",inputSchema:{type:"object"}};
  let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;}),order:string[]=[];
  const b=bridge({catalog:()=>[descriptor],approvalRequest:async()=>({title:"Exact action",description:"Exact resource"}),approvalResolved:async()=>{order.push("callback-start");await wait;order.push("decision-committed");},execute:async()=>{order.push("tool-executed");return {};}});
  const context={agentId:"main",sessionKey:"conversation",sessionId:"session",runId:"callback-run",toolCallId:"callback-call",assertInvocationCurrent(){}};
  const event={toolName:descriptor.nativeName,runId:context.runId,toolCallId:context.toolCallId,params:{relation:"answer",decision:"approve"}};
  const decision=await b.hooks.get("before_tool_call")!(event,context);
  void decision.requireApproval.onResolution("allow-once");
  const run=b.factory().create(context)[0].execute(context.toolCallId,event.params);
  await Promise.resolve();await Promise.resolve();assert.deepEqual(order,["callback-start"]);
  release();await run;assert.deepEqual(order,["callback-start","decision-committed","tool-executed"]);
});


test("actual message:preprocessed staged event completes initial pending custody before source admission",async()=>{
  const seen:unknown[]=[];
  const b=bridge({observeInbound:async(event:any,context:any)=>{seen.push({event,context});if(event.mediaStagingPending)throw Object.assign(Error("pending"),{code:"discord_original_media_staging_pending"});}});
  const context={channelId:"discord",conversationId:"fixture-channel",senderId:"fixture-human",messageId:"fixture-original-message",sessionKey:"agent:main:discord:stage",runId:"actual-staged-run"};
  await b.hooks.get("message_received")!({content:"Scan this card",mediaStagingPending:true,originalMedia:[{url:"https://cdn.example.test/card.png",contentType:"image/png"}]},context);
  const admission=b.hooks.get("before_model_resolve")!({prompt:"Scan this card",attachments:[{kind:"image",mimeType:"image/png"}]},{...context,agentId:"main",sessionId:"native-session"});
  await Promise.resolve();assert.deepEqual(b.calls,[]);
  await b.internal.get("message:preprocessed")!({sessionKey:context.sessionKey,context:{channelId:"discord",conversationId:context.conversationId,senderId:context.senderId,messageId:context.messageId,media:[{path:"/native/media/card.png",contentType:"image/png"}]}});
  await admission;assert.deepEqual(b.calls,["before_model_resolve"]);
  assert.equal((seen[1] as any).context.runId,context.runId);assert.equal((seen[1] as any).event.media[0].path,"/native/media/card.png");
});


test("scheduled preparation veto uses the reserved delivery lane and leaves ordinary live replies untouched",async()=>{
  const calls:unknown[]=[];
  const b=bridge({guardScheduledDelivery:async(event:unknown,context:unknown)=>{calls.push({event,context});return {cancel:true,cancelReason:"household_notice_not_authorized"};}});
  const event={to:"fixture-private",content:"Body must not choose policy"};
  assert.equal(await b.hooks.get("message_sending")!(event,{channelId:"discord",sessionKey:"agent:main:discord:ordinary"}),undefined);assert.equal(calls.length,0);
  const result=await b.hooks.get("message_sending")!(event,{channelId:"discord",sessionKey:"agent:main:household-cron-delivery:"+"a".repeat(64)});
  assert.equal(result.cancel,true);assert.equal(calls.length,1);
  const unavailable=bridge();assert.equal((await unavailable.hooks.get("message_sending")!(event,{sessionKey:"agent:main:household-cron-delivery:"+"a".repeat(64)})).cancel,true);
});
