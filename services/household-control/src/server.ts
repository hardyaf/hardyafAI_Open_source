import {createConversationOrganizationRoutes} from "./conversation-organization-routes.ts";
import { maximumReceiptPhotoBytes, receiptCapturePath } from "./client-views/receipt-capture.ts";
import { HOUSEHOLD_SERVICE_VERSION } from "./version.ts";
import { createSecureListener } from "./platform/secure-listener.ts";
import { createFitbitRoutes } from "./fitbit/routes.ts";
import { DeviceEffectStore } from "./fitbit/device-effects.ts";
import { createDictationRoute, dictationPath, maximumDictationBytes } from "./client-views/dictation.ts";
import {createClientViewRoutes,createDisplayAssetRoutes,createHomeAssetRoutes} from "./client-views/index.ts";
import { createPublicKey } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { HouseholdDatabase } from "./database.ts";
import { DeviceAuthenticator } from "./device-auth.ts";
import type { AuthenticatedDevice } from "./device-auth.ts";
import { HouseholdEventHub } from "./events.ts";
import type { HouseholdEventScope } from "./events.ts";
import type { FamilyProfile, HouseholdAgentAdapter, HouseholdGoalMutation } from "./domain.ts";
import { sendJson, parseJson, requireCapability } from "./http-codec.ts";
export { sendJson, parseJson, requireCapability } from "./http-codec.ts";
import { ArtifactStore, NativeExecutionPolicies } from "./platform/index.ts";
import { createPlatformRoutes } from "./platform-http.ts";
import { HouseholdDomainRuntime } from "./domain-runtime/runtime.ts";
import { ConnectedGoogleClient } from "./domain-runtime/connected-google.ts";
import { loadDomainConfiguration } from "./domain-runtime/configuration.ts";
import { HouseholdStore, type HouseholdStoreApi } from "./household-store.ts";
import { MockHouseholdAgentAdapter } from "./mock-adapter.ts";
import { conversations, devices, messages, presets, profiles } from "./mock-data.ts";
import { OpenClawAgentAdapter } from "./openclaw-adapter.ts";
import { SqliteHouseholdStore } from "./sqlite-household-store.ts";
import { parseMessageTaskContext } from "./request-context.ts";
import type { MessageTaskContext } from "./request-context.ts";

const maxBodyBytes = 256 * 1024;

type ServerOptions = {
  store?: HouseholdStoreApi;
  authenticator?: DeviceAuthenticator;
  database?: HouseholdDatabase;
  eventHub?: HouseholdEventHub;
  startup?: () => Promise<void>;
  publicRoute?: (request: IncomingMessage,response:ServerResponse,url:URL)=>Promise<boolean>;
  shutdown?: () => Promise<void>;
  artifacts?: Pick<ArtifactStore,"get">;
  validateFocus?: (context: RequestContext, conversationId: string, focus: NonNullable<MessageTaskContext["focus"]>) => Promise<void>;
  route?: (request: IncomingMessage, response: ServerResponse, url: URL, body: Buffer, context: RequestContext) => Promise<boolean>;
};

export type RequestContext = {
  profile: FamilyProfile;
  device: AuthenticatedDevice;
};

async function readBody(request: IncomingMessage, limit = maxBodyBytes): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) throw new Error("body_too_large");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function validatePublicKey(publicKeyDerBase64: string): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKeyDerBase64, "base64"),
      format: "der",
      type: "spki",
    });
    return key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1";
  } catch {
    return false;
  }
}

export function createHouseholdServer(options: ServerOptions = {}) {
  const mockAdapter = new MockHouseholdAgentAdapter(messages.map((message) => ({ ...message })));
  const store = options.store ?? new HouseholdStore(
    profiles.map((profile) => ({ ...profile, capabilities: [...profile.capabilities] })),
    presets.map((preset) => ({ ...preset, allowedRoles: [...preset.allowedRoles] })),
    conversations.map((conversation) => ({ ...conversation })),
    mockAdapter,
  );
  const authenticator = options.authenticator ?? new DeviceAuthenticator({ developmentDevices: devices });
  const eventHub = options.eventHub ?? new HouseholdEventHub();
  const database = options.database;
  const organizationRoutes=createConversationOrganizationRoutes(store);
  let startupComplete = !options.startup;
  let startupFailure: string | undefined;
  let closing = false;
  const unsubscribe = store.onAgentEvent((event) => {
    const conversation = store.findBySessionKey(event.sessionKey);
    if (!conversation) return;
    eventHub.publish("conversation.changed", {
      conversationId: conversation.id,
      runId: event.runId,
      phase: event.phase,
    }, { kind: "conversation", conversationId: conversation.id });
  });

  const unsubscribeSubmissions = store.onSubmissionEvent?.((receipt) => {
    eventHub.publish("submission.changed", { receipt }, { kind: "profile", profileId: receipt.profileId });
  });

  const server = createServer({ requestTimeout: 60_000, headersTimeout: 15_000 }, async (request, response) => {
    try {
      if (closing) { sendJson(response, 503, { error: "service_stopping" }); return; }
      const url = new URL(request.url ?? "/", "http://household.local");
      if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/ready")) {
        const adapterStatus = await store.diagnostics();
        const ready = startupComplete && !startupFailure && (store.adapterMode === "mock" || adapterStatus.status === "connected");
        sendJson(response, url.pathname === "/ready" && !ready ? 503 : 200, {
          status: url.pathname === "/health" ? "live" : ready ? "ready" : "not_ready",
          service: "hardy-home-control",
          version: HOUSEHOLD_SERVICE_VERSION,
          ready,
          startup: startupFailure ?? (startupComplete ? "complete" : "starting"),
          adapter: store.adapterMode,
          adapterStatus,
        });
        return;
      }

      if(options.publicRoute&&await options.publicRoute(request,response,url))return;
      const isReceiptPhoto = request.method === "PUT" && url.pathname.startsWith(receiptCapturePath + "/");
      const bodyLimit = options.route && isReceiptPhoto ? maximumReceiptPhotoBytes
        : options.route && request.method === "POST" && url.pathname === dictationPath
        ? maximumDictationBytes
        : options.route && request.method === "POST" && /^\/v1\/conversations\/[^/]+\/artifacts$/.test(url.pathname)
          ? 36 * 1024 * 1024 : maxBodyBytes;
      const bodyBuffer = await readBody(request, bodyLimit);
      if (request.method === "POST" && ["/v1/enrollment/claim","/v1/display/enrollment/claim"].includes(url.pathname)) {
        if (!database) {
          sendJson(response, 404, { error: "enrollment_unavailable" });
          return;
        }
        const body = parseJson(bodyBuffer);
        const code = typeof body.code === "string" ? body.code.trim() : "";
        const deviceName = typeof body.deviceName === "string" ? body.deviceName.trim() : "";
        const publicKeyDerBase64 = typeof body.publicKeyDerBase64 === "string" ? body.publicKeyDerBase64.trim() : "";
        if (
          code.length < 8 || code.length > 128 ||
          deviceName.length < 1 || deviceName.length > 80 ||
          publicKeyDerBase64.length < 80 || publicKeyDerBase64.length > 2048 ||
          !validatePublicKey(publicKeyDerBase64)
        ) {
          sendJson(response, 400, { error: "invalid_enrollment_request" });
          return;
        }
        const displayClaim=url.pathname==="/v1/display/enrollment/claim";
        const claimed = database.claimInvitation({ code, displayName: deviceName, publicKeyDerBase64,deviceKind:displayClaim?"display":"personal" });
        if (!claimed) {
          sendJson(response, 401, { error: "invalid_or_expired_invitation" });
          return;
        }
        sendJson(response, 201, displayClaim?{deviceId:claimed.deviceId}:claimed);
        return;
      }

      const path = `${url.pathname}${url.search}`;
      const authenticated = authenticator.authenticate(request, path, bodyBuffer);
      const profile = authenticated ? store.getProfile(authenticated.profileId) : undefined;
      if (!profile) {
        sendJson(response, 401, { error: "device_not_enrolled" });
        return;
      }
      const context: RequestContext = { profile, device: authenticated! };

      if (request.method === "PUT" && /^\/v1\/conversations\/[^/]+\/checkpoint$/.test(url.pathname)) {
        sendJson(response,410,{error:"checkpoint_client_write_retired"}); return;
      }
      if(authenticated?.deviceKind==="display"&&!url.pathname.startsWith("/v1/display/")){sendJson(response,403,{error:"display_read_only"});return;}
      if (options.route && await options.route(request, response, url, bodyBuffer, context)) return;
      if(await organizationRoutes(request,response,url,bodyBuffer,context))return;
      if(authenticated?.deviceKind==="display"){sendJson(response,404,{error:"not_found"});return;}

      if (request.method === "GET" && url.pathname === "/v1/me") {
        sendJson(response, 200, { profile });
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/household/status") {
        if (!requireCapability(response, context, "viewHouseholdStatus")) return;
        await store.reconcileRuns();
        sendJson(response, 200, store.getSnapshot());
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/presets") {
        sendJson(response, 200, { presets: store.listPresets(profile) });
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/conversations") {
        if (!requireCapability(response, context, "chat")) return;
        sendJson(response, 200, { conversations: store.listConversations(profile) });
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/conversations") {
        if (!requireCapability(response, context, "chat")) return;
        const body = parseJson(bodyBuffer);
        const title = typeof body.title === "string" ? body.title.trim() : "";
        const presetId = typeof body.presetId === "string" ? body.presetId : null;
        const audience = body.audience ?? "private";
        if (Object.keys(body).some(key => !["title","presetId","audience"].includes(key)) || !["private","household"].includes(String(audience))) {
          sendJson(response,400,{error:"invalid_conversation"}); return;
        }
        if(audience === "household" && (profile.role === "child" || !profile.capabilities.includes("viewHouseholdStatus"))) {
          sendJson(response,403,{error:"household_conversation_not_allowed"}); return;
        }
        if (title.length < 1 || title.length > 120) {
          sendJson(response, 400, { error: "invalid_title" });
          return;
        }
        try {
          const conversation = await store.createConversation(profile, title, presetId, audience as "private"|"household");
          sendJson(response, 201, { conversation });
        } catch (error) {
          if (error instanceof Error && error.message === "preset_not_allowed") {
            sendJson(response, 403, { error: "preset_not_allowed" });
            return;
          }
          throw error;
        }
        return;
      }


      const metadataMatch = url.pathname.match(/^\/v1\/conversations\/([^/]+)\/metadata$/);
      if (metadataMatch && request.method === "PUT") {
        if (!requireCapability(response, context, "chat")) return;
        const body = parseJson(bodyBuffer);
        const title = typeof body.title === "string" ? body.title.trim() : "";
        if (!title || title.length > 120) {
          sendJson(response, 400, { error: "invalid_title" });
          return;
        }
        const rawTags = body.tags;
        if (Object.keys(body).some(key => key !== "title" && key !== "tags") ||
          rawTags !== undefined && (!Array.isArray(rawTags) || rawTags.length > 8 ||
          rawTags.some(tag => typeof tag !== "string" || !tag.trim() || tag.trim().length > 32 || /[,\p{Cc}]/u.test(tag)))) {
          sendJson(response, 400, { error: "invalid_conversation_metadata" });
          return;
        }
        const tags = rawTags?.map((tag: string) => tag.trim());
        const seen = new Set<string>();
        const uniqueTags = tags?.filter((tag:string) => {
          const key = tag.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        const conversation = store.updateConversationMetadata(profile, decodeURIComponent(metadataMatch[1]), title, uniqueTags);
        sendJson(response, conversation ? 200 : 404, conversation ? { conversation } : { error: "conversation_not_found" });
        return;
      }

      const contextMatch = url.pathname.match(/^\/v1\/conversations\/([^/]+)\/context$/);
      if (contextMatch && request.method === "GET") {
        if (!requireCapability(response, context, "chat")) return;
        if (!store.getContext) { sendJson(response, 503, { error: "native_context_unavailable" }); return; }
        const result = await store.getContext(profile, decodeURIComponent(contextMatch[1]));
        sendJson(response, result ? 200 : 404, result ? { context: result } : { error: "conversation_not_found" });
        return;
      }
      const goalMatch = url.pathname.match(/^\/v1\/conversations\/([^/]+)\/goal$/);
      if (goalMatch && request.method === "POST") {
        if (!requireCapability(response, context, "chat")) return;
        if(profile.role === "child") { sendJson(response,403,{error:"goal_control_not_allowed"}); return; }
        if (!store.updateGoal) { sendJson(response, 503, { error: "native_goal_unavailable" }); return; }
        const body = parseJson(bodyBuffer);
        if (Object.keys(body).some(key => !["goalId","operationId","issuedAtMs","action","objective","note"].includes(key)) ||
          typeof body.goalId !== "string" || !body.goalId || body.goalId.length > 200 ||
          typeof body.operationId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/.test(body.operationId) ||
          typeof body.issuedAtMs !== "number" || !Number.isSafeInteger(body.issuedAtMs) || body.issuedAtMs < 1 ||
          !["edit","pause","resume","block","complete","clear"].includes(String(body.action)) ||
          body.objective !== undefined && (typeof body.objective !== "string" || !body.objective.trim() || body.objective.length > 16_000) ||
          body.action === "edit" && typeof body.objective !== "string" ||
          body.note !== undefined && (typeof body.note !== "string" || body.note.length > 2_000)) {
          sendJson(response, 400, { error: "invalid_goal_operation" }); return;
        }
        const result = await store.updateGoal(profile, decodeURIComponent(goalMatch[1]), body as unknown as HouseholdGoalMutation,
          authenticated!.kind === "signed" ? authenticated!.deviceId : undefined);
        sendJson(response, result ? (result.receipt ? 202 : 200) : 404, result ? { result } : { error: "conversation_not_found" });
        return;
      }

      const messagesMatch = url.pathname.match(/^\/v1\/conversations\/([^/]+)\/messages$/);
      if (messagesMatch && request.method === "GET") {
        if (!requireCapability(response, context, "chat")) return;
        const conversationId = decodeURIComponent(messagesMatch[1]);
        const result = await store.listMessages(profile, conversationId);
        if (!result) {
          sendJson(response, 404, { error: "conversation_not_found" });
          return;
        }
        sendJson(response, 200, { messages: result });
        return;
      }
      if (messagesMatch && request.method === "POST") {
        if (!requireCapability(response, context, "chat")) return;
        const body = parseJson(bodyBuffer);
        const text = typeof body.text === "string" ? body.text.trim() : "";
        const submissionId = typeof body.submissionId === "string" ? body.submissionId.trim() : "";
        if (Object.keys(body).some(key => !["text","submissionId","goalStart","mode","artifactIds","replyToQuestionId","focus","approval"].includes(key)) || text.length < 1 || text.length > 20_000 || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(submissionId)) {
          sendJson(response, 400, { error: "invalid_message" });
          return;
        }
        const conversationId = decodeURIComponent(messagesMatch[1]);
        const taskContext = parseMessageTaskContext(body);
        if(taskContext.mode==="diagnostic"&&store.getConversation(profile,conversationId)?.audience!=="private"){sendJson(response,403,{error:"diagnostic_private_conversation_required"});return;}
        if(profile.role === "child" && (taskContext.mode !== "conversation" || taskContext.replyToQuestionId || taskContext.focus || taskContext.approval || body.goalStart !== undefined)) {
          sendJson(response,403,{error:"child_conversation_only"}); return;
        }
        if(taskContext.mode === "diagnostic" && (profile.role !== "admin" || !profile.capabilities.includes("viewDiagnostics"))) {
          sendJson(response,403,{error:"diagnostic_operator_required"}); return;
        }
        if(["task","brain_dump","diagnostic"].includes(taskContext.mode) && text.length > 16_000) {
          sendJson(response,400,{error:"invalid_task_message_length"}); return;
        }
        const conversation = store.getConversation(profile,conversationId);
        if(!conversation || conversation.ownerProfileId !== profile.id || conversation.agentId !== profile.agentId) {
          sendJson(response,404,{error:"conversation_not_found"}); return;
        }
        if(taskContext.artifactIds.length) {
          if(!profile.capabilities.includes("attachImages")){sendJson(response,403,{error:"artifact_references_not_allowed"});return;}
          if(!options.artifacts){sendJson(response,503,{error:"artifact_validation_unavailable"});return;}
          for(const id of taskContext.artifactIds) {
            const artifact=await options.artifacts.get(id,{profileId:profile.id,canReadHousehold:profile.capabilities.includes("viewHouseholdStatus")});
            if(artifact.conversationId!==conversationId || artifact.ownerProfileId!==profile.id || artifact.audience!==conversation.audience) {
              sendJson(response,404,{error:"artifact_not_found"});return;
            }
          }
        }
        if(taskContext.focus) {
          if(!options.validateFocus){sendJson(response,503,{error:"focus_validation_unavailable"});return;}
          await options.validateFocus(context,conversationId,taskContext.focus);
        }
        let goalStart: { issuedAtMs: number } | undefined;
        if (body.goalStart !== undefined) {
          const start = body.goalStart as Record<string, unknown>;
          if (text.length > 16_000 || !start || typeof start !== "object" || Array.isArray(start) || Object.keys(start).some(key => key !== "issuedAtMs") ||
            typeof start.issuedAtMs !== "number" || !Number.isSafeInteger(start.issuedAtMs) || start.issuedAtMs < 1) {
            sendJson(response, 400, { error: "invalid_goal_start" }); return;
          }
          goalStart = { issuedAtMs: start.issuedAtMs };
        }
        if(taskContext.replyToQuestionId && goalStart){sendJson(response,400,{error:"invalid_reply_goal_start"});return;}
        const binding = goalStart || taskContext.mode !== "conversation" ? conversation : undefined;
        try {
          const receipt = await store.submitMessage({ profile, conversationId, text, submissionId, taskContext,
            originDeviceId: authenticated!.kind === "signed" ? authenticated!.deviceId : undefined,
            ...(goalStart ? { goalStart, nativeContext: { page: "hardy-home", title: "Household task" } } : {}),
          });
          if (!receipt) {
            sendJson(response, 404, { error: "conversation_not_found" });
            return;
          }
          sendJson(response, 202, { receipt });
        } catch (error) {
          if (error instanceof Error && error.message === "submission_conflict") {
            sendJson(response, 409, { error: "submission_conflict" });
            return;
          }
          throw error;
        }
        return;
      }

      const cancelMatch = url.pathname.match(/^\/v1\/conversations\/([^/]+)\/cancel$/);
      if (cancelMatch && request.method === "POST") {
        if (!requireCapability(response, context, "chat")) return;
        const body = parseJson(bodyBuffer);
        if(profile.role === "child"){sendJson(response,403,{error:"goal_control_not_allowed"});return;}
        if(Object.keys(body).some(key=>!["operationId","issuedAtMs","goalId","runId"].includes(key)) ||
          typeof body.operationId!=="string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(body.operationId) ||
          !Number.isSafeInteger(body.issuedAtMs) || Number(body.issuedAtMs)<1 ||
          [body.goalId,body.runId].some(value=>value!==undefined&&(typeof value!=="string"||!value||value.length>200||/[\x00-\x1f\x7f]/.test(value))) ||
          body.goalId===undefined&&body.runId===undefined) {sendJson(response,400,{error:"invalid_cancel_operation"});return;}
        if(!store.cancelTarget){sendJson(response,503,{error:"targeted_cancel_unavailable"});return;}
        const result=await store.cancelTarget(profile,decodeURIComponent(cancelMatch[1]),body as {operationId:string;issuedAtMs:number;goalId?:string;runId?:string},
          authenticated!.kind==="signed"?authenticated!.deviceId:undefined);
        sendJson(response,result?200:404,result?{result}:{error:"conversation_not_found"});
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/events") {
        if (!requireCapability(response, context, "chat")) return;
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });
        if (profile.capabilities.includes("viewHouseholdStatus")) {
          response.write(`event: household.snapshot\ndata: ${JSON.stringify(store.getSnapshot())}\n\n`);
        }
        const currentProfile = () => store.getProfile(profile.id);
        eventHub.add(response, {
          isActive: () => {
            if (!currentProfile()?.capabilities.includes("chat")) return false;
            if (authenticated!.kind !== "signed") return true;
            const device = database?.getDevice(authenticated!.deviceId);
            return device?.status === "active" && device.profileId === profile.id;
          },
          canRead: (scope: HouseholdEventScope) => {
            const current = currentProfile();
            if (!current) return false;
            if (scope.kind === "household") return current.capabilities.includes("viewHouseholdStatus");
            if (scope.kind === "profile") return scope.profileId === current.id;
            return current.capabilities.includes("chat") && !!store.getConversation(current, scope.conversationId);
          },
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/admin/diagnostics") {
        if (!requireCapability(response, context, "viewDiagnostics")) return;
        const snapshot = store.getSnapshot();
        sendJson(response, 200, {
          service: { status: "healthy" },
          scheduler: {
            activeRuns: snapshot.activeRuns,
            maxActiveRuns: snapshot.maxActiveRuns,
            queuedRuns: snapshot.queuedRuns,
          },
          openclaw: await store.diagnostics(),
        });
        return;
      }
      sendJson(response, 404, { error: "not_found" });
    } catch (error) {
      const code = error instanceof Error ? error.message : "internal_error";
      const declaredStatus=Number((error as {statusCode?:number;httpStatus?:number}).statusCode??(error as {httpStatus?:number}).httpStatus);
      const status = Number.isSafeInteger(declaredStatus)&&declaredStatus>=400&&declaredStatus<=599 ? declaredStatus : code === "body_too_large" ? 413 : (code.endsWith("_conflict") || code === "checkpoint_native_binding_changed") ? 409 :
        code === "delivery_authorization_revoked" || code.endsWith("_not_allowed") || code.endsWith("_required") && ["diagnostic_operator_required"].includes(code) ? 403 :
        code === "run_not_found" ? 404 : code.endsWith("_unavailable") || code === "gateway_unavailable" ? 503 :
        code.startsWith("invalid_") || code.endsWith("_invalid") ? 400 : 500;
      if (status === 500) process.stderr.write(`${new Date().toISOString()} request failed: ${/^[a-z][a-z0-9_]{0,79}$/.test(code) ? code : "internal_error"}\n`);
      if (!response.headersSent) sendJson(response, status, { error: status === 500 ? "internal_error" : code });
      else response.end();
    }
  });

  server.once("listening", () => {
    if (options.startup) void options.startup().then(() => { startupComplete = true; }, error => {
      startupComplete = true;
      startupFailure = "startup_dependency_unavailable";
      const code = typeof error?.code === "string" && /^[a-zA-Z][a-zA-Z0-9_]{0,79}$/.test(error.code) ? error.code : "dependency_failed";
      const frame = typeof error?.stack === "string" ? error.stack.split("\n").find((line: string) => /(?:file:\/\/|\/).*\.(?:ts|mjs):[0-9]+:[0-9]+\)?$/.test(line.trim())) : undefined;
      process.stderr.write(JSON.stringify({startup:startupFailure,code,...(frame?{location:frame.trim()}: {})}) + "\n");
    });
  });
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = () => {
    if (!cleanupPromise) {
      unsubscribe();
      unsubscribeSubmissions?.();
      eventHub.close();
      cleanupPromise = (async () => { try { await options.shutdown?.(); } finally { await store.close(); } })();
    }
    return cleanupPromise;
  };
  server.once("close", () => { void cleanup().catch(() => {}); });
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = () => {
    if (!shutdownPromise) {
      closing = true;
      const closed = new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
      eventHub.close();
      server.closeIdleConnections();
      shutdownPromise = Promise.all([closed, cleanup()]).then(() => undefined);
    }
    return shutdownPromise;
  };
  return Object.assign(server, { shutdown });
}

function createRuntime() {
  const databasePath = process.env.HARDY_HOME_DATABASE ?? resolve("data", "household-control.sqlite");
  const database = new HouseholdDatabase(databasePath);
  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL;
  const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;
  const stateRoot = process.env.HARDY_HOME_STATE_ROOT ?? resolve(databasePath, "..");
  const artifacts = new ArtifactStore({ root: process.env.HARDY_HOME_ARTIFACT_ROOT ?? resolve(stateRoot, "artifacts") });
  const policies = new NativeExecutionPolicies({
    configPath: process.env.OPENCLAW_CONFIG_PATH ?? resolve(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".openclaw", "openclaw.json"),
    image: process.env.HARDY_HOME_SANDBOX_IMAGE ?? "hardy-home-analysis:slice1",
  });
  let adapter: HouseholdAgentAdapter;
  if (gatewayUrl && gatewayToken) {
    adapter = new OpenClawAgentAdapter({ url: gatewayUrl, token: gatewayToken, restrictedRuntimeCheck: (agentId) => policies.assertReady(agentId),requireHouseholdBoundary:process.env.HARDY_HOME_DISPATCH_ENABLED!=="false" });
  } else if (process.env.NODE_ENV !== "production") {
    adapter = new MockHouseholdAgentAdapter([]);
  } else {
    database.close();
    throw new Error("OPENCLAW_GATEWAY_URL and OPENCLAW_GATEWAY_TOKEN are required in production");
  }
  const store = new SqliteHouseholdStore(database, adapter, {
    dispatcherEnabled: process.env.HARDY_HOME_DISPATCH_ENABLED !== "false",
    sourceCapture:async(submissionId,text)=>{if(!domains){if(adapter.mode==="mock")return;throw new Error("domain_runtime_unavailable");}await domains.admission.captureAppSource(submissionId,text);},
    sourceSettlement:input=>domains?domains.resolveSourceSettlement(input):Promise.resolve(null),
  });
  const developmentDevices = process.env.ALLOW_MOCK_DEVICE_AUTH === "true" && process.env.NODE_ENV !== "production"
    ? devices
    : undefined;
  const authenticator = new DeviceAuthenticator({ database, developmentDevices });
  let domains: HouseholdDomainRuntime | undefined;
  let receiptCaptures: ReturnType<HouseholdDomainRuntime["createReceiptCapture"]> | undefined;
  let clientRoutes:ReturnType<typeof createClientViewRoutes>|undefined;
  let fitbitRoutes:ReturnType<typeof createFitbitRoutes>|undefined;
  const displayAssets=createDisplayAssetRoutes({root:process.env.HARDY_HOME_DISPLAY_ROOT??resolve("../../apps/kitchen-display/dist")});
  const homeAssets=createHomeAssetRoutes({root:resolve("../../apps/hardy-home-web/dist")});
  const publicRoute = async (request:IncomingMessage,response:ServerResponse,url:URL) =>
    await displayAssets(request,response,url) || await homeAssets(request,response,url);
  const assertDeviceCurrent=(context:RequestContext)=>{
    const device=database.getDevice(context.device.deviceId),profile=database.getProfile(context.profile.id);
    if(context.device.kind!=="signed"||!device||device.status!=="active"||device.deviceKind!=="personal"||device.profileId!==context.profile.id||!profile?.capabilities.includes("chat")||profile.agentId!==context.profile.agentId)throw Object.assign(new Error("device_authority_revoked"),{statusCode:403});
  };
  const dictation = createDictationRoute({
    python: process.env.HARDY_HOME_DICTATION_PYTHON,
    model: process.env.HARDY_HOME_DICTATION_MODEL,
    script: resolve("scripts/transcribe-dictation.py"),
    assertCurrent(context) {
      assertDeviceCurrent(context);
      if (!database.getProfile(context.profile.id)?.capabilities.includes("voiceInput"))
        throw Object.assign(new Error("dictation_authority_revoked"), { statusCode: 403 });
    },
  });
  const baseRoute = createPlatformRoutes(store, { artifacts, policies, dependencies: {
    pythonPath: process.env.HARDY_HOME_PYTHON_PATH, documentReaderPath: process.env.HARDY_HOME_DOCUMENT_READER,
    bitwardenPath: process.env.BWS_BIN, bitwardenConfigPath: process.env.BWS_CONFIG_FILE, bitwardenBootstrapPresent: !!process.env.BWS_ACCESS_TOKEN,
  } });
  const route: NonNullable<ServerOptions["route"]> = async (request,response,url,bytes,context) => {
    if(request.method === "GET" && url.pathname === "/v1/admin/domains") {
      if(!requireCapability(response,context,"viewDiagnostics"))return true;
      sendJson(response,domains ? 200 : 503,domains ? {readiness:await domains.readiness(),tools:domains.catalog().map(tool=>({name:tool.nativeName,domain:tool.domain,effect:tool.effect,description:tool.description}))} : {error:"domain_runtime_unavailable"});
      return true;
    }
    if(context.device.deviceKind==="display"){
      if(!domains){sendJson(response,503,{error:"domain_runtime_unavailable"});return true;}
      const current=()=>{const device=database.getDevice(context.device.deviceId),profile=database.getProfile(context.profile.id);if(!device||device.status!=="active"||device.deviceKind!=="display"||device.profileId!==context.profile.id||!profile||profile.role==="child"||!profile.capabilities.includes("viewHouseholdStatus"))throw Object.assign(new Error("display_device_revoked"),{statusCode:403});};
      const principal={deviceId:context.device.deviceId,deviceKind:"display" as const,assertCurrent:current};current();
      if(request.method==="GET"&&url.pathname==="/v1/display/snapshot"){sendJson(response,200,await domains.display.snapshot(principal));return true;}
      const publication=/^\/v1\/display\/publications\/(display-[a-f0-9]{64})\/content$/.exec(url.pathname);
      if(request.method==="GET"&&publication){const value=await domains.display.content(principal,publication[1]);response.writeHead(200,value.headers);response.end(value.bytes);return true;}
      sendJson(response,404,{error:"not_found"});return true;
    }
    if (fitbitRoutes && await fitbitRoutes.route(request,response,url,bytes,context)) return true;
    if (await dictation.route(request,response,url,bytes,context)) return true;
    if (receiptCaptures && await receiptCaptures.route(request,response,url,bytes,context)) return true;
    if(clientRoutes&&await clientRoutes(request,response,url,bytes,context))return true;
    return baseRoute(request,response,url,bytes,context);
  };
  const startup = async () => {
    await artifacts.initialize();
    const configurationPath=process.env.HARDY_HOME_DOMAINS_CONFIG;
    if(configurationPath && adapter instanceof OpenClawAgentAdapter) {
      const configuration=await loadDomainConfiguration(configurationPath);
      domains=new HouseholdDomainRuntime({database,adapter,artifacts,configuration,
        connectedGoogle:process.env.HARDY_CREDENTIALS_CONSUMER_SOCKET ? new ConnectedGoogleClient(process.env.HARDY_CREDENTIALS_CONSUMER_SOCKET) : undefined});
      if (configuration.fitbit) fitbitRoutes=createFitbitRoutes({configuration:configuration.fitbit,effects:new DeviceEffectStore(database.domainConnection()),assertCurrent:assertDeviceCurrent});
      receiptCaptures = domains.createReceiptCapture(resolve(stateRoot, "household-finances", "ledger.sqlite"), assertDeviceCurrent);
      clientRoutes=createClientViewRoutes({store,artifacts,reads:domains.clientQueries,assertCurrent:assertDeviceCurrent,
        progress:async(_profile,conversation,current)=>{current();const value=await (adapter as OpenClawAgentAdapter).getProgress(conversation);current();return value;}});
    } else if(process.env.NODE_ENV === "production") throw new Error("domain_configuration_required");
    if (adapter instanceof OpenClawAgentAdapter) {
      try { await adapter.probe(); } catch { /* /ready requires the adapter's fresh current-connection probe. */ }
    }
    await store.start?.();
  };
  return { database, store, authenticator, startup, route, publicRoute,artifacts,
    validateFocus:async(context:RequestContext,_conversationId:string,focus:NonNullable<MessageTaskContext["focus"]>)=>{assertDeviceCurrent(context);if(!domains)throw new Error("domain_runtime_unavailable");await domains.validateClientFocus(context.profile.id,focus,()=>assertDeviceCurrent(context));},shutdown: async () => { await Promise.all([domains?.close(), dictation.close(), fitbitRoutes?.close()]); receiptCaptures?.close(); } };
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  const port = Number(process.env.PORT ?? "4317");
  const host = process.env.BIND_ADDRESS ?? "127.0.0.1";
  const runtime = createRuntime();
  const server = createHouseholdServer(runtime);
  server.listen(port, host, () => {
    process.stdout.write(`Hardy Home control service listening on http://${host}:${port}\n`);
  });
  const certificate=process.env.HARDY_HOME_TLS_CERTIFICATE,privateKey=process.env.HARDY_HOME_TLS_PRIVATE_KEY;
  let secure:Awaited<ReturnType<typeof createSecureListener>>|undefined;
  if(certificate||privateKey){
    const tlsPort=Number(process.env.HARDY_HOME_TLS_PORT??"8443");
    if(!certificate||!privateKey||!Number.isInteger(tlsPort)||tlsPort<1024||tlsPort>65535||tlsPort===port)throw new Error("tls_configuration_unavailable");
    secure=await createSecureListener(server,{certificate,privateKey});
    secure.listen(tlsPort,host,()=>process.stdout.write("Hardy Home HTTPS listener ready\n"));
  }
  const shutdown = () => {
    const closed=secure?new Promise<void>(resolve=>{secure!.close(()=>resolve());secure!.closeIdleConnections();}):Promise.resolve();
    void Promise.all([server.shutdown(),closed]).then(()=>process.exit(0),()=>process.exit(1));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
