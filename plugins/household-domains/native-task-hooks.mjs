import { createNativeContextProjection, nativeContextProjectionKey } from "./native-context-projection.mjs";
import { createHash, randomUUID } from "node:crypto";

// Native 2026.9.8 does not await onResolution. Share only the exact in-flight
// callback barrier across registry factories; durable decision authority stays in SQLite.
const approvalSettlements = new Map();
const mediaTurns = new Map();
const mediaKey = (context, messageId, senderId) => JSON.stringify([context.sessionKey, messageId, senderId]);
const supportedMediaExpected = event => [...(event.media ?? []), ...(event.originalMedia ?? [])].some(fact => ["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(typeof fact?.contentType === "string" ? fact.contentType.split(";", 1)[0].trim().toLowerCase() : "") || /\.(png|jpe?g|webp|pdf)$/i.test(fact?.path ?? ""));
const approvalKey = (context, toolCallId) => JSON.stringify([context.agentId, context.sessionKey, context.runId, toolCallId]);
const pendingDiscordSource = (event, context) => context.channel === "discord" && typeof context.senderId === "string" &&
  !["internal_system", "inter_session"].includes(context.inputProvenance?.kind) &&
  (context.inputProvenance?.kind !== "external_user" || typeof event.currentUserMessage !== "string" ||
    typeof event.currentUserMessageId !== "string" || !event.currentUserMessageId);

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.entries(value).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right))
    .map(([name, item]) => JSON.stringify(name) + ":" + canonical(item)).join(",") + "}";
}
const fingerprint = value => createHash("sha256").update(canonical(value)).digest("hex");
const errorCode = error => typeof error?.code === "string" && /^[a-z][a-z0-9_]{0,100}$/.test(error.code) ? error.code : "household_runtime_unavailable";
const deny = reason => ({ block: true, blockReason: reason });
function result(value, failure = false, nativeName, params) {
  const details = failure ? { ok: false, error: { code: value } } : { ok: true, result: value };
  const content = [{ type: "text", text: JSON.stringify(details) }];
  const projection = failure ? undefined : createNativeContextProjection(nativeName, value, params);
  return { content, details: projection ? { ...details, [nativeContextProjectionKey]: projection } : details, ...(failure ? { isError: true } : {}) };
}

export function assertNativeHookConfiguration(config, pluginId = "hardy-household") {
  const hooks = config?.plugins?.entries?.[pluginId]?.hooks;
  if (hooks?.allowConversationAccess !== true || hooks?.allowPromptInjection !== true) throw Error("household_native_hook_permissions_required");
}

/** Metadata extraction only. Root admission verifies mapped author/channel/job and source custody. */
export function nativeTurnObservation(hook, event, context) {
  return {
    hook, runId: context.runId ?? event.runId ?? null, sessionId: context.sessionId ?? event.sessionId ?? null,
    sessionKey: context.sessionKey ?? event.sessionKey ?? null, agentId: context.agentId ?? null,
    channel: context.channel ?? null, accountId: context.accountId ?? null,
    channelId: context.channelId ?? context.chatId ?? null, senderId: context.senderId ?? null,
    trigger: context.trigger ?? null, jobId: context.jobId ?? context.inputProvenance?.jobId ?? null,
    inputProvenance: context.inputProvenance ?? null,
    sourceMessageId: typeof event.currentUserMessageId === "string" ? event.currentUserMessageId : null,
    // Empty currentUserMessage means no text. Never fall back to old/history prompt in that case.
    sourceText: typeof event.currentUserMessage === "string" ? event.currentUserMessage :
      context.channel !== "discord" && typeof event.prompt === "string" ? event.prompt : null,
    exactCurrentMessage: typeof event.currentUserMessage === "string",
    supportedMediaExpected: Array.isArray(event.attachments) && event.attachments.some(fact => fact.kind === "image" || fact.kind === "document" && fact.mimeType === "application/pdf"),
  };
}

/**
 * All durable/source/ACL policy belongs to injected root ports. Native hook payloads stay intact.
 * Required ports: isManagedAgent,catalog,execute,admitNativeTurn,registerNativeChild,
 * getTaskContext,prompt,finalize,guard,bootstrapAccess. Optional: end,release,afterTool,error.
 */
export function registerNativeTaskBridge(api, ports) {
  assertNativeHookConfiguration(api.config, api.id ?? "hardy-household");
  const bridgeId = randomUUID();
  const observeInvocation = (phase, toolName, toolCallId, facts = {}) => api.logger?.info?.("Household invocation boundary: " + JSON.stringify({
    phase, bridgeId, toolName: names.includes(toolName) ? toolName : "unknown", callHash: fingerprint(toolCallId).slice(0, 16), ...facts }));
  const admissionDenials = new Map();
  let denialOverflowUntil = 0;
  const denialTtlMs = 600_000;
  const descriptors = ports.catalog();
  const names = descriptors.map(tool => tool.nativeName);
  const managed = context => ports.isManagedAgent(context.agentId, context.sessionKey) === true;
  const report = (stage, error) => {
    ports.error?.(stage, errorCode(error));
    api.logger?.error?.(`Household native ${stage} failed: ${errorCode(error)}`);
  };
  const prune = () => {
    const now = Date.now();
    for (const [id, denied] of admissionDenials) if (now - denied.at > denialTtlMs) admissionDenials.delete(id);
  };
  const runIdentity = (event, context) => ({
    runId: typeof (context.runId ?? event.runId) === "string" ? context.runId ?? event.runId : null,
    agentId: typeof context.agentId === "string" ? context.agentId : null,
    sessionKey: typeof (context.sessionKey ?? event.sessionKey) === "string"
      ? (context.sessionKey ?? event.sessionKey).replace(/^agent:[^:]+:/, "") : null,
  });
  const rejected = (event, context) => {
    prune();
    if (Date.now() < denialOverflowUntil) return true;
    const current = runIdentity(event, context);
    for (const denied of admissionDenials.values()) {
      if (current.runId && denied.runId && current.runId === denied.runId) return true;
      if ((!current.runId || !denied.runId) && current.sessionKey && current.sessionKey === denied.sessionKey &&
        (!current.agentId || !denied.agentId || current.agentId === denied.agentId)) return true;
      if (!denied.runId && !denied.sessionKey) return true;
    }
    return false;
  };
  const rejectAdmission = (event, context, error) => {
    prune();
    const identity = runIdentity(event, context), id = JSON.stringify(identity);
    // Never evict a live rejection to admit another run. Saturation temporarily
    // denies managed work instead of opening a stale authority fallback.
    if (admissionDenials.size >= 256 && !admissionDenials.has(id)) { denialOverflowUntil = Date.now() + denialTtlMs; return null; }
    const record = { ...identity, at: Date.now(), code: errorCode(error) };
    admissionDenials.set(id, record);
    return { id, record };
  };
  const admit = async (hook, event, context) => {
    if (!managed(context)) return true;
    const currentRun = context.runId ?? event.runId;
    const media = [...mediaTurns.values()].find(value => value.context.runId === currentRun && value.context.sessionKey === context.sessionKey);
    if (media) {
      try { await Promise.race([media.ready, new Promise((_, reject) => { const timer = setTimeout(() => reject(Object.assign(Error("media wait"), {code:"native_media_custody_pending"})), 10_000); timer.unref?.(); })]); }
      catch (error) { rejectAdmission(event, context, error); report("media-custody", error); return false; }
    }
    if (rejected(event, context)) return false;
    // A prompt hook may time out while its async work remains alive. Pending
    // admission must not leave a window for an older goal projection to execute.
    const pending = rejectAdmission(event, context, { code: "native_source_admission_pending" });
    if (!pending) return false;
    try {
      await ports.admitNativeTurn(event, context, nativeTurnObservation(hook, event, context));
      if (admissionDenials.get(pending.id) !== pending.record) return false;
      admissionDenials.delete(pending.id);
      return true;
    } catch (error) {
      rejectAdmission(event, context, error);
      report("source-admission", error);
      return false;
    }
  };
  if (ports.observeInbound) {
    const receive = async (event, context, record) => {
      const pending = rejectAdmission(event, context, { code: "native_media_custody_pending" });
      if (!pending) { record?.reject(Object.assign(Error("media capacity"),{code:"native_source_capacity"})); return; }
      try {
        await ports.observeInbound(event, context);
        if (admissionDenials.get(pending.id) === pending.record) admissionDenials.delete(pending.id);
        record?.resolve();
      } catch (error) {
        rejectAdmission(event, context, error); report("media-custody", error);
        if (errorCode(error) !== "discord_original_media_staging_pending") record?.reject(error);
      }
    };
    api.on("message_received", async (event, context) => {
      if (context.channelId !== "discord") return;
      const messageId=context.messageId??event.messageId,senderId=context.senderId??event.senderId??event.from;
      let record;
      if (typeof context.runId === "string" && typeof context.sessionKey === "string" && typeof messageId === "string" && typeof senderId === "string" && supportedMediaExpected(event)) {
        const key=mediaKey(context,messageId,senderId), previous=mediaTurns.get(key);
        if (previous?.context.runId === context.runId) record=previous;
        else {
          if (mediaTurns.size >= 256) { rejectAdmission(event, context, {code:"native_source_capacity"}); return; }
          let resolve,reject;const ready=new Promise((yes,no)=>{resolve=yes;reject=no;});ready.catch(()=>{});
          record={owner:bridgeId,context:{...context,messageId,senderId},event:{content:event.content},ready,resolve,reject};mediaTurns.set(key,record);
          const timer=setTimeout(()=>{if(mediaTurns.get(key)===record)mediaTurns.delete(key);},600_000);timer.unref?.();
        }
      }
      await receive(event,context,record);
    }, { priority: 1000, registrationId: "hardy-household-discord-artifacts" });
    // Installed native dispatch emits message_received once, before remote staging.
    // This supported later event carries staged paths but no runId; retain only
    // exact session/message/sender correlation from the earlier trusted hook.
    api.registerHook("message:preprocessed", async event => {
      const facts=event.context;
      if(facts?.channelId!=="discord"||typeof event.sessionKey!=="string")return;
      const senderId=facts.senderId??facts.from,messageId=facts.messageId;
      if(typeof senderId!=="string"||typeof messageId!=="string")return;
      const record=mediaTurns.get(mediaKey({sessionKey:event.sessionKey},messageId,senderId));
      if(!record||facts.conversationId!==record.context.conversationId)return;
      await receive({...record.event,media:facts.media,originalMedia:facts.originalMedia,mediaStagingPending:facts.mediaStagingPending},record.context,record);
    }, {name:"hardy-household-discord-media-ready",description:"Transfer exactly correlated staged native originals into existing artifact custody."});
  }
  api.on("message_sending", async (event, context) => {
    const key=context.sessionKey??event.sessionKey;
    // Ordinary live replies never enter the scheduled-notice policy path.
    if(typeof key!=="string"||!/^agent:[^:]+:household-cron-delivery:/.test(key))return;
    if(!ports.guardScheduledDelivery)return {cancel:true,cancelReason:"household_notice_guard_unavailable"};
    try{return await ports.guardScheduledDelivery(event,context);}
    catch(error){report("notice-preparation",error);return {cancel:true,cancelReason:"household_notice_guard_unavailable"};}
  }, {priority:1000,registrationId:"hardy-household-notice-preparation"});
  // Admission must precede native tool construction on first incoming Discord/scheduled turns.
  api.on("before_model_resolve", async (event, context) => {
    // Native completion provenance arrives in the later prompt hooks.
    // A run prefix only defers admission. It never supplies authority.
    const runId = context.runId ?? event.runId;
    if (!context.inputProvenance && typeof runId === "string" &&
      (runId.startsWith("announce:requester-settle:") || runId.startsWith("announce:v1:"))) return;
    if (!pendingDiscordSource(event, context)) await admit("before_model_resolve", event, context);
  },
    { priority: 1000, registrationId: "hardy-household-source-admission" });
  api.on("agent_turn_prepare", async (event, context) => {
    // Some native phases have sender identity before they have the exact request.
    // The final prompt phase still requires proof before exposing household tools.
    if (!pendingDiscordSource(event, context)) await admit("agent_turn_prepare", event, context);
  },
    { priority: 1000, registrationId: "hardy-household-pre-policy-admission" });
  api.on("before_prompt_build", async (event, context) => {
    if (!managed(context)) return;
    if (!await admit("before_prompt_build", event, context)) return { toolsAllow: [],
      appendContext: "This current native turn's source admission was rejected. No previous goal/source projection grants this turn authority. Do not execute actions, continue a task or claim delivery." };
    try {
      context.hookInvocation?.assertActive();
      context.toolAuthority?.assertActive();
      const binding = await ports.getTaskContext("before_prompt_build", event, context);
      if (!binding) throw Object.assign(Error("source unavailable"), { code: "native_source_context_unavailable" });
      const projection = await ports.prompt(binding, event, context);
      context.hookInvocation?.assertActive();
      context.toolAuthority?.assertActive();
      return projection;
    } catch (error) {
      rejectAdmission(event, context, error); report("source-context", error);
      return { toolsAllow: [], appendContext: "This current turn's task context could not be verified. Older task/source authority must not be reused. No household actions are authorized." };
    }
  // Native 2026.9.8's ordinary phase preserves system context and toolsAllow.
  // Its later tool-authorized phase keeps only prependContext/appendContext.
  // Per-call trusted policy, source denial and V2 fences still own authority.
  }, { priority: 1000, registrationId: "hardy-household-task-context" });
  // Native 2026.9.8 treats any global before_agent_run registration as
  // restart-unsafe (chat-restart-recovery), rejecting atomic goal start/resume.
  // Do not register it or another unsafe admission hook. Positive source hooks,
  // the per-run pending/rejection latch, empty prompt tools, trusted tool policy
  // and exact V2 invocation fences retain effect authority. Rejected input may
  // produce refusal text, but cannot borrow an older source or invoke tools.
  api.on("before_agent_finalize", async (event, context) => {
    if (!managed(context)) return;
    if (rejected(event, context)) return { action: "finalize", reason: "Current source admission was rejected; do not request a continuation or reuse older goal authority." };
    try {
      const binding = await ports.getTaskContext("before_agent_finalize", event, context);
      if (!binding) throw Object.assign(Error("source unavailable"), { code: "native_source_context_unavailable" });
      return await ports.finalize(binding, event, context);
    } catch (error) {
      rejectAdmission(event, context, error); report("finalize-authority", error);
      return { action: "finalize", reason: "Current execution authority could not be verified; do not continue or reuse an older task projection." };
    }
  }, { priority: 1000, registrationId: "hardy-household-outcome-gate" });
  api.on("subagent_spawned", async (event, context) => {
    // requesterSessionKey is the parent; event.runId is the CHILD run. Never interchange them.
    if (!context.requesterSessionKey || !event.childSessionKey || !event.runId) return;
    await ports.registerNativeChild(event, context);
  }, { priority: 1000, registrationId: "hardy-household-child-authority" });
  api.on("agent_end", async (event, context) => {
    if (!managed(context)) return;
    try {
      // An older source projection must not settle this refused fresh turn.
      if (!rejected(event, context)) await ports.end?.(event, context);
    } catch (error) { report("settlement", error); }
    finally {
      // Worker-owned resources must close even when admission or settlement failed.
      try { await ports.release?.(event, context); } catch (error) { report("release", error); }
    }
  }, { priority: 1000, registrationId: "hardy-household-native-settlement" });

  api.registerTrustedToolPolicy({
    id: "hardy-household-task-boundary", description: "Current household source, audience, task lineage and diagnosis restrictions for every native/deferred tool.",
    async evaluate(event, context) {
      if (!managed(context)) return;
      if (rejected(event, context)) return { allow: false, reason: "This native turn's source admission was rejected." };
      try {
        const binding = await ports.getTaskContext("before_tool_call", event, context);
        if (!binding) { rejectAdmission(event, context, { code: "native_source_context_unavailable" }); return { allow: false, reason: "Current household task authority is required." }; }
        binding.assertCurrent?.(); binding.task?.assertCurrent?.();
        const decision = await ports.guard(binding, event, context);
        if (decision?.allow === true && names.includes(event.toolName)) {
          binding.assertCurrent?.(); binding.task?.assertCurrent?.();
          // Policies and a deferred factory may belong to different SDK registry
          // instances. The existing execution-grant owner carries exact proof.
          await ports.bindInvocation(binding, event, context);
          binding.assertCurrent?.(); binding.task?.assertCurrent?.();
          observeInvocation("bound", event.toolName, event.toolCallId ?? context.toolCallId);
        }
        return decision;
      } catch (error) { rejectAdmission(event, context, error); report("tool-policy", error); return { allow: false, reason: "Household task policy could not verify this invocation." }; }
    },
  });
  api.on("before_tool_call", async (event, context) => {
    prune();
    if (rejected(event, context)) return deny("This native turn's source admission was rejected.");
    const toolCallId = event.toolCallId ?? context.toolCallId, runId = event.runId ?? context.runId;
    if (typeof toolCallId !== "string" || !toolCallId || typeof runId !== "string" || !runId ||
      typeof context.agentId !== "string" || typeof context.sessionKey !== "string" ||
      event.runId && context.runId && event.runId !== context.runId ||
      event.toolCallId && context.toolCallId && event.toolCallId !== context.toolCallId) return deny("Trusted native invocation identity is required.");
    if (ports.approvalRequest && ports.approvalResolved && event.toolName === "household_task_bind_reply") {
      try {
        const binding = await ports.getTaskContext("before_tool_call", event, context);
        if (!binding) return deny("Current household task authority is required.");
        const request = await ports.approvalRequest(binding, event, context);
        if (request) return { requireApproval: { ...request, allowedDecisions: ["allow-once", "deny"],
          onResolution: decision => {
            const key = approvalKey(context, toolCallId);
            if (approvalSettlements.size >= 256 && !approvalSettlements.has(key)) throw Object.assign(Error("approval capacity"), { code: "native_approval_resolution_capacity" });
            const pending = Promise.resolve().then(() => ports.approvalResolved(binding, event, context, decision));
            const entry = { owner: bridgeId, pending }; approvalSettlements.set(key, entry);
            const cleanup = () => { if (approvalSettlements.get(key) === entry) approvalSettlements.delete(key); };
            const timeout = setTimeout(cleanup, 600_000); timeout.unref?.();
            pending.catch(() => {}).finally(() => { if (decision !== "allow-once") { clearTimeout(timeout); cleanup(); } });
            return pending;
          } } };
      } catch (error) { report("approval-binding", error); return deny("The exact household approval could not be bound to a protected native decision."); }
    }
  }, { matcher: names, priority: 1000, registrationId: "hardy-household-invocation-binding" });

  api.registerTool({ contextVersion: 2, create(context) {
    return ports.catalog(context).map(descriptor => ({
      name: descriptor.nativeName, label: descriptor.nativeName, description: descriptor.description, parameters: descriptor.inputSchema,
      executionMode: descriptor.executionMode ?? "sequential",
      // Static owner opt-in. Provider/business data cannot create SDK provenance.
      ...(descriptor.nativeName === "household_email_read" ? { contextProjectionV1: true } : {}),
      // The fixed analysis helper inherits this existing publisher, but has no
      // deferred dispatcher. Keep its typed schema directly callable in OpenClaw.
      ...(descriptor.nativeName === "household_analysis_publish_output" ? { catalogMode: "direct-only" } : {}),
      async execute(toolCallId, params, signal) {
        try {
          context.assertInvocationCurrent();
          if (descriptor.nativeName === "household_task_bind_reply") {
            const key = approvalKey(context, toolCallId), settlement = approvalSettlements.get(key);
            if (settlement) { try { await settlement.pending; } finally { if (approvalSettlements.get(key) === settlement) approvalSettlements.delete(key); } }
            context.assertInvocationCurrent();
          }
          const value = await ports.execute(descriptor.nativeName, params, { ...context, toolCallId }, signal);
          context.assertInvocationCurrent();
          return result(value, false, descriptor.nativeName, params);
        } catch (error) {
          if (errorCode(error) === "trusted_native_invocation_required") observeInvocation("refused", descriptor.nativeName, toolCallId);
          return result(errorCode(error), true);
        }
      },
    }));
  } }, { names, optional: true });
  if (ports.afterTool) api.on("after_tool_call", async (event, context) => {
    if (managed(context)) await ports.afterTool(event, context);
  }, { priority: 1000, registrationId: "hardy-household-tool-evidence" });

  api.registerHook("agent:bootstrap", async event => {
    const context = event.context;
    if (!context || !Array.isArray(context.bootstrapFiles) || !ports.isManagedAgent(context.agentId, context.sessionKey ?? event.sessionKey)) return;
    const original = [...context.bootstrapFiles];
    // Scrub before any fallible/async policy lookup. Unknown, shared and sandbox helpers get no private bootstrap.
    context.bootstrapFiles = [];
    try {
      const access = await ports.bootstrapAccess(event);
      if (access === "private" && !["household-analysis", "household-diagnostics"].includes(context.agentId)) context.bootstrapFiles = original;
    } catch (error) { report("bootstrap-privacy", error); }
  }, { name: "hardy-household-bootstrap-privacy", description: "Remove personal workspace bootstrap before shared or unverified household prompts." });

  return { clear() { admissionDenials.clear(); denialOverflowUntil = 0; for (const [key, entry] of approvalSettlements) if (entry.owner === bridgeId) approvalSettlements.delete(key); for(const [key,entry] of mediaTurns)if(entry.owner===bridgeId)mediaTurns.delete(key); }, registeredToolCount: names.length };
}
