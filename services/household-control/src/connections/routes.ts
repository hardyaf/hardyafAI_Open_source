import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestContext } from "../server.ts";
import { parseJson, sendJson } from "../http-codec.ts";
import { ConnectionsError } from "./contracts.ts";
import type { ConnectionsService } from "./service.ts";

/** This route is mounted only in the isolated HTTPS daemon, outside chat admission. */
export function createConnectionsRoutes(options: {
  service: ConnectionsService; assertCurrent(context: RequestContext): void;
  isSecureTransport?: (request: IncomingMessage) => boolean;
}) {
  return {
    async route(request: IncomingMessage, response: ServerResponse, url: URL, bytes: Buffer, context: RequestContext) {
      if (!url.pathname.startsWith("/v1/connections")) return false;
      options.assertCurrent(context);
      if (context.device.kind !== "signed" || context.device.deviceKind !== "personal" || context.profile.role !== "admin" || !context.profile.capabilities.includes("manageAccess"))
        throw new ConnectionsError("connections_not_allowed", 403);
      const secure = options.isSecureTransport?.(request) ?? !!(request.socket as { encrypted?: boolean }).encrypted;
      if (!secure) throw new ConnectionsError("credentials_https_required", 403);
      if (url.search || bytes.length > 40 * 1024) throw new ConnectionsError("invalid_connection_request", 400);
      const owner = context.profile.id;
      if (request.method === "GET" && url.pathname === "/v1/connections") {
        if (bytes.length) throw new ConnectionsError("invalid_connection_request", 400);
        const snapshot = await options.service.snapshot(owner); options.assertCurrent(context); sendJson(response, 200, snapshot); return true;
      }
      options.service.assertSecure();
      const handlers: Record<string, (owner: string, input: unknown, current: () => void) => Promise<unknown>> = {
        "/v1/connections/bitwarden": options.service.bootstrap.bind(options.service),
        "/v1/connections/password": options.service.savePassword.bind(options.service),
        "/v1/connections/google/config": options.service.configureGoogle.bind(options.service),
        "/v1/connections/google/start": options.service.startGoogle.bind(options.service),
        "/v1/connections/google/complete": options.service.completeGoogle.bind(options.service),
        "/v1/connections/google/read-only": options.service.setGoogleReadOnly.bind(options.service),
      };
      let result: unknown;
      if (request.method === "POST" && handlers[url.pathname]) result = await handlers[url.pathname](owner, parseJson(bytes), () => options.assertCurrent(context));
      else if (request.method === "DELETE" && /^\/v1\/connections\/connection-[a-f0-9]{32}$/.test(url.pathname))
        result = await options.service.disconnect(owner, url.pathname.split("/").at(-1)!, parseJson(bytes), () => options.assertCurrent(context));
      else { sendJson(response, 405, { error: "method_not_allowed" }); return true; }
      options.assertCurrent(context); sendJson(response, 200, result); return true;
    },
    async publicRoute(request: IncomingMessage, response: ServerResponse, url: URL) {
      if (url.pathname !== "/v1/connections/google/callback") return false;
      const secure = options.isSecureTransport?.(request) ?? !!(request.socket as { encrypted?: boolean }).encrypted;
      if (!secure || request.method !== "GET") throw new ConnectionsError("credentials_https_required", 403);
      // The daemon supplies its fixed configured origin. Never construct this URL from Host headers.
      await options.service.acceptGoogleCallback(url.href);
      const body = "<!doctype html><html><head><meta charset=utf-8><title>Google connected</title></head><body><p>Google connected. Return to Hardy Home and refresh Connections.</p></body></html>";
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'", "x-content-type-options": "nosniff" });
      response.end(body); return true;
    },
    close: () => options.service.close(),
  };
}
