import { createPublicKey } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { HouseholdDatabase } from "./database.ts";
import { DeviceAuthenticator } from "./device-auth.ts";
import { HouseholdEventHub } from "./events.ts";
import type { Capability, FamilyProfile, HouseholdAgentAdapter } from "./domain.ts";
import { HouseholdStore, type HouseholdStoreApi } from "./household-store.ts";
import { MockHouseholdAgentAdapter } from "./mock-adapter.ts";
import { conversations, devices, messages, presets, profiles } from "./mock-data.ts";
import { OpenClawAgentAdapter } from "./openclaw-adapter.ts";
import { SqliteHouseholdStore } from "./sqlite-household-store.ts";

const maxBodyBytes = 256 * 1024;

type ServerOptions = {
  store?: HouseholdStoreApi;
  authenticator?: DeviceAuthenticator;
  database?: HouseholdDatabase;
  eventHub?: HouseholdEventHub;
};

type RequestContext = {
  profile: FamilyProfile;
};

function sendJson(response: ServerResponse, status: number, value: unknown) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maxBodyBytes) throw new Error("body_too_large");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function parseJson(body: Buffer): Record<string, unknown> {
  if (body.length === 0) return {};
  const parsed = JSON.parse(body.toString("utf8"));
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("invalid_json_object");
  }
  return parsed as Record<string, unknown>;
}

function requireCapability(response: ServerResponse, context: RequestContext, capability: Capability): boolean {
  if (context.profile.capabilities.includes(capability)) return true;
  sendJson(response, 403, { error: "forbidden", requiredCapability: capability });
  return false;
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
  const unsubscribe = store.onAgentEvent((event) => {
    const conversation = store.findBySessionKey(event.sessionKey);
    if (!conversation) return;
    eventHub.publish("conversation.changed", {
      conversationId: conversation.id,
      runId: event.runId,
      phase: event.phase,
    });
  });

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://household.local");
      if (request.method === "GET" && url.pathname === "/health") {
        const adapterStatus = await store.diagnostics();
        sendJson(response, 200, {
          status: "ok",
          service: "hardy-home-control",
          version: "0.2.0",
          adapter: store.adapterMode,
          adapterStatus,
        });
        return;
      }

      const bodyBuffer = await readBody(request);
      if (request.method === "POST" && url.pathname === "/v1/enrollment/claim") {
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
        const claimed = database.claimInvitation({ code, displayName: deviceName, publicKeyDerBase64 });
        if (!claimed) {
          sendJson(response, 401, { error: "invalid_or_expired_invitation" });
          return;
        }
        sendJson(response, 201, claimed);
        return;
      }

      const path = `${url.pathname}${url.search}`;
      const authenticated = authenticator.authenticate(request, path, bodyBuffer);
      const profile = authenticated ? store.getProfile(authenticated.profileId) : undefined;
      if (!profile) {
        sendJson(response, 401, { error: "device_not_enrolled" });
        return;
      }
      const context: RequestContext = { profile };

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
        if (title.length < 1 || title.length > 120) {
          sendJson(response, 400, { error: "invalid_title" });
          return;
        }
        try {
          const conversation = await store.createConversation(profile, title, presetId);
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
        if (text.length < 1 || text.length > 20_000 || submissionId.length < 8 || submissionId.length > 128) {
          sendJson(response, 400, { error: "invalid_message" });
          return;
        }
        const conversationId = decodeURIComponent(messagesMatch[1]);
        try {
          const receipt = await store.submitMessage({ profile, conversationId, text, submissionId });
          if (!receipt) {
            sendJson(response, 404, { error: "conversation_not_found" });
            return;
          }
          eventHub.publish("submission.accepted", { receipt });
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
        const runId = typeof body.runId === "string" ? body.runId : undefined;
        const found = await store.cancel(profile, decodeURIComponent(cancelMatch[1]), runId);
        if (!found) {
          sendJson(response, 404, { error: "conversation_not_found" });
          return;
        }
        response.writeHead(204, { "cache-control": "no-store" });
        response.end();
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/events") {
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });
        response.write(`event: household.snapshot\ndata: ${JSON.stringify(store.getSnapshot())}\n\n`);
        eventHub.add(response);
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
      const status = code === "body_too_large" ? 413 : code.startsWith("invalid_") ? 400 : 500;
      if (status === 500) process.stderr.write(`${new Date().toISOString()} request failed: ${code}\n`);
      if (!response.headersSent) sendJson(response, status, { error: status === 500 ? "internal_error" : code });
      else response.end();
    }
  });

  server.once("close", () => {
    unsubscribe();
    eventHub.close();
    void store.close();
  });
  return server;
}

function createRuntime() {
  const databasePath = process.env.HARDY_HOME_DATABASE ?? resolve("data", "household-control.sqlite");
  const database = new HouseholdDatabase(databasePath);
  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL;
  const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;
  let adapter: HouseholdAgentAdapter;
  if (gatewayUrl && gatewayToken) {
    adapter = new OpenClawAgentAdapter({ url: gatewayUrl, token: gatewayToken });
  } else if (process.env.NODE_ENV !== "production") {
    adapter = new MockHouseholdAgentAdapter([]);
  } else {
    database.close();
    throw new Error("OPENCLAW_GATEWAY_URL and OPENCLAW_GATEWAY_TOKEN are required in production");
  }
  const store = new SqliteHouseholdStore(database, adapter);
  const developmentDevices = process.env.ALLOW_MOCK_DEVICE_AUTH === "true" && process.env.NODE_ENV !== "production"
    ? devices
    : undefined;
  const authenticator = new DeviceAuthenticator({ database, developmentDevices });
  return { database, store, authenticator };
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
  const shutdown = () => server.close(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
