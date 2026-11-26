import { googleMessageReadInput } from "../domains/google/message-read.ts";
import { createServer } from "node:http";
import { chmod } from "node:fs/promises";
import type { HouseholdDatabase } from "../database.ts";
import { NativeDomainAuthorization } from "../domain-runtime/native-scope.ts";
import type { NativeToolContext } from "../domain-runtime/native-scope.ts";
import type { DomainConfiguration } from "../domain-runtime/configuration.ts";
import type { ConnectionsService } from "./service.ts";
import { ConnectionsError, fields, object, string } from "./contracts.ts";
import { sendJson } from "../http-codec.ts";

const operations = {
  household_email_search: "gmail.search", household_email_read: "gmail.get",
  household_calendar_list: "calendar.list", household_calendar_get: "calendar.get",
} as const;

export function createNativeCredentialConsumer(options: {
  database: HouseholdDatabase; service: ConnectionsService; configuration: DomainConfiguration;
}) {
  const authorization = new NativeDomainAuthorization(options.database, options.configuration.profiles, (packet, profileId) => {
    const origin = packet.origin;
    return origin?.kind === "discord" && options.configuration.execution.nativeEntries.some(rule =>
      rule.profileId === profileId && rule.externalUserId === origin.externalUserId && rule.channelId === origin.channelId &&
      rule.audience === (origin.shared ? "household" : "private"));
  });
  return createServer({ requestTimeout: 30000, headersTimeout: 5000 }, async (request, response) => {
    const cancellation = new AbortController();
    response.on("close", () => { if (!response.writableFinished) cancellation.abort(); });
    try {
      if (request.method !== "POST" || request.url !== "/google") throw new ConnectionsError("connection_operation_not_allowed", 403);
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 32768) throw new ConnectionsError("invalid_connection_request", 400);
        chunks.push(chunk);
      }
      const input = object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      fields(input, ["action", "connectionId", "tool", "args", "context"]);
      const wire = object(input.context);
      fields(wire, ["agentId","sessionKey","sessionId","runId","nativeRunId","nativeGoalId","nativeGoalStatus","nativeSessionId"]);
      for (const value of Object.values(wire)) if (value != null && typeof value !== "string") throw new ConnectionsError("invalid_connection_request", 400);
      const context: NativeToolContext = { ...wire, assertInvocationCurrent() {
        if (cancellation.signal.aborted) throw new ConnectionsError("connection_request_cancelled", 409);
      } };
      const scope = authorization.resolve(context, cancellation.signal);
      const current = () => {
        scope.principal.assertCurrent();
        options.service.assertSecure();
        if (scope.mode !== "normal" || scope.principal.audience !== "private" ||
            !scope.grant.scopes.includes("personal")) throw new ConnectionsError("private_connection_context_required", 403);
      };
      current();
      if (input.action === "list") {
        const snapshot = await options.service.snapshot(scope.principal.profileId);
        current();
        const connections = snapshot.connections.filter(item => item.kind === "google" && item.status === "connected" &&
          scope.grant.domains.includes(item.preset === "gmail_read" ? "email" : "calendar"));
        sendJson(response, 200, { connections: connections.map(item => ({ ...item, connectionId: item.id })) }); return;
      }
      if (input.action === "read_default_email") {
        fields(input, ["action", "tool", "args", "context"]);
        if (typeof input.tool !== "string" || !["household_email_search", "household_email_read"].includes(input.tool) ||
            !scope.grant.domains.includes("email")) throw new ConnectionsError("connection_operation_not_allowed", 403);
        const tool = input.tool as "household_email_search" | "household_email_read";
        const result = await options.service.readDefaultGoogleEmail(scope.principal.profileId, options.configuration.google.account,
          operations[tool], tool === "household_email_read" ? googleMessageReadInput(input.args) : input.args, current);
        current(); sendJson(response, 200, { source: "connected_google", untrusted: true, result }); return;
      }
      if (input.action !== "read" || typeof input.tool !== "string" || !Object.hasOwn(operations, input.tool))
        throw new ConnectionsError("connection_operation_not_allowed", 403);
      const tool = input.tool as keyof typeof operations;
      if (!scope.grant.domains.includes(tool.startsWith("household_email_") ? "email" : "calendar"))
        throw new ConnectionsError("connection_operation_not_allowed", 403);
      const result = await options.service.readGoogle(scope.principal.profileId, string(input.connectionId, 128), operations[tool], tool === "household_email_read" ? googleMessageReadInput(input.args) : input.args, current);
      current(); sendJson(response, 200, { source: "connected_google", untrusted: true, result });
    } catch (error) {
      const raw = error as {code?: string; statusCode?: number; httpStatus?: number};
      const code = typeof raw.code === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(raw.code) ? raw.code : "connected_google_unavailable";
      const status = raw.statusCode ?? raw.httpStatus ?? 503;
      sendJson(response, [400,403,404,409,503].includes(status) ? status : 503, { error: code });
    }
  });
}

export async function listenNativeCredentialConsumer(server: ReturnType<typeof createNativeCredentialConsumer>, socketPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve());
  });
  await chmod(socketPath, 0o660);
}
