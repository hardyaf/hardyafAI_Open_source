import type { IncomingMessage, ServerResponse } from "node:http";
import type { FamilyProfile, HouseholdCheckpointUpdate } from "./domain.ts";
import type { AuthenticatedDevice } from "./device-auth.ts";
import type { HouseholdStoreApi } from "./household-store.ts";
import { sendJson, parseJson, requireCapability } from "./http-codec.ts";
import { ArtifactStore, NativeExecutionPolicies, inspectPlatformDependencies, artifactResponseHeaders, PlatformError } from "./platform/index.ts";

export type PlatformHttp = {
  artifacts: ArtifactStore;
  policies: NativeExecutionPolicies;
  dependencies: Parameters<typeof inspectPlatformDependencies>[0];
};
export function createPlatformRoutes(store: HouseholdStoreApi, platform: PlatformHttp) {
  return async (request: IncomingMessage, response: ServerResponse, url: URL, bytes: Buffer, context: { profile: FamilyProfile; device: AuthenticatedDevice }): Promise<boolean> => {
    try {
      if (request.method === "GET" && url.pathname === "/v1/admin/platform") {
        if (!requireCapability(response, context, "viewDiagnostics")) return true;
        sendJson(response, 200, { artifacts: platform.artifacts.readiness(), nativeProfiles: await platform.policies.readiness(), dependencies: await inspectPlatformDependencies(platform.dependencies), functionalAcceptance: "deferred_until_full_build" });
        return true;
      }

      const checkpointMatch = url.pathname.match(/^\/v1\/conversations\/([^/]+)\/checkpoint$/);
      if (checkpointMatch && (request.method === "GET" || request.method === "PUT")) {
        if (!requireCapability(response, context, "chat")) return true;
        const conversationId = decodeURIComponent(checkpointMatch[1]);
        if (request.method === "GET") {
          if (!store.getCheckpoint) { sendJson(response, 503, { error: "checkpoint_unavailable" }); return true; }
          const binding = await store.getCheckpoint(context.profile, conversationId);
          sendJson(response, binding === undefined ? 404 : 200, binding === undefined ? { error: "conversation_not_found" } : { checkpoint: binding });
          return true;
        }
        if (!store.updateCheckpoint) { sendJson(response, 503, { error: "checkpoint_unavailable" }); return true; }
        const body = parseJson(bytes);
        if (Object.keys(body).some(key => !["nativeSessionId","nativeGoalId","expectedRevision","phase","questionArtifactId","checkpointArtifactId"].includes(key)) ||
          typeof body.nativeSessionId !== "string" || !body.nativeSessionId || body.nativeSessionId.length > 200 ||
          !(body.nativeGoalId === null || typeof body.nativeGoalId === "string" && body.nativeGoalId.length > 0 && body.nativeGoalId.length <= 200) ||
          typeof body.expectedRevision !== "number" || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 ||
          typeof body.phase !== "string" || body.phase.length > 80 ||
          [body.questionArtifactId,body.checkpointArtifactId].some(id => id !== undefined && id !== null && (typeof id !== "string" || !/^artifact-[a-f0-9]{64}$/.test(id)))) {
          sendJson(response, 400, { error: "invalid_checkpoint" }); return true;
        }
        const principal = { profileId: context.profile.id, canReadHousehold: context.profile.capabilities.includes("viewHouseholdStatus") };
        for (const id of [body.questionArtifactId,body.checkpointArtifactId]) {
          if (typeof id !== "string") continue;
          const artifact = await platform.artifacts.get(id, principal);
          if (artifact.ownerProfileId !== context.profile.id || artifact.conversationId !== conversationId ||
            !["conversation:" + conversationId,body.nativeGoalId].includes(artifact.taskId)) {
            sendJson(response, 404, { error: "artifact_not_found" }); return true;
          }
        }
        const result = await store.updateCheckpoint(context.profile, conversationId, body as unknown as HouseholdCheckpointUpdate,
          context.device.kind === "signed" ? context.device.deviceId : undefined);
        sendJson(response, result ? 200 : 404, result ? { checkpoint: result } : { error: "conversation_not_found" });
        return true;
      }

      const list = url.pathname.match(/^\/v1\/conversations\/([^/]+)\/artifacts$/);
      const item = url.pathname.match(/^\/v1\/conversations\/([^/]+)\/artifacts\/([^/]+)(\/content)?$/);
      if (!list && !item) return false;
      if (!requireCapability(response, context, "chat")) return true;
      const conversationId = decodeURIComponent((list ?? item)![1]);
      const conversation = store.getConversation(context.profile, conversationId);
      if (!conversation) { sendJson(response, 404, { error: "conversation_not_found" }); return true; }
      const principal = { profileId: context.profile.id, canReadHousehold: context.profile.capabilities.includes("viewHouseholdStatus") };
      if (list && request.method === "GET") {
        const artifacts = await platform.artifacts.list(principal, { conversationId, limit: 100 });
        sendJson(response, 200, { artifacts }); return true;
      }
      if (list && request.method === "POST") {
        if (!requireCapability(response, context, "attachImages")) return true;
        if (conversation.ownerProfileId !== context.profile.id || conversation.agentId !== context.profile.agentId) {
          sendJson(response, 404, { error: "conversation_not_found" }); return true;
        }
        const body = parseJson(bytes);
        if (Object.keys(body).some(key => !["filename", "mimeType", "contentBase64", "idempotencyKey", "audience"].includes(key)) ||
          typeof body.filename !== "string" || body.filename.length > 180 || typeof body.mimeType !== "string" ||
          typeof body.contentBase64 !== "string" || body.contentBase64.length > Math.ceil(platform.artifacts.maxBytes / 3) * 4 ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.contentBase64) ||
          typeof body.idempotencyKey !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/.test(body.idempotencyKey) ||
          body.audience !== undefined && body.audience !== "private" && body.audience !== "household") {
          sendJson(response, 400, { error: "invalid_artifact_request" }); return true;
        }
        if (body.audience === "household" && !principal.canReadHousehold) {
          sendJson(response, 403, { error: "artifact_audience_not_allowed" }); return true;
        }
        // Stage inputs in an explicit conversation namespace until an admitted native task binds them.
        // Client input cannot claim another owner/task or publish a generated output.
        const metadata = await platform.artifacts.put({
          ownerProfileId: context.profile.id, conversationId, taskId: "conversation:" + conversationId,
          audience: body.audience === "household" ? "household" : "private",
        }, principal, { bytes: Buffer.from(body.contentBase64, "base64"), filename: body.filename, mimeType: body.mimeType, kind: "input", idempotencyKey: body.idempotencyKey });
        sendJson(response, 201, { artifact: metadata }); return true;
      }
      if (item && request.method === "GET") {
        const artifactId = decodeURIComponent(item[2]);
        const metadata = await platform.artifacts.get(artifactId, principal);
        if (metadata.conversationId !== conversationId) { sendJson(response, 404, { error: "artifact_not_found" }); return true; }
        if (!item[3]) { sendJson(response, 200, { artifact: metadata }); return true; }
        const result = await platform.artifacts.read(artifactId, principal);
        response.writeHead(200, artifactResponseHeaders(result.metadata));
        response.end(result.bytes); return true;
      }
      sendJson(response, 405, { error: "method_not_allowed" }); return true;
    } catch (error) {
      if (error instanceof PlatformError) { sendJson(response, error.statusCode, { error: error.code }); return true; }
      throw error;
    }
  };
}
