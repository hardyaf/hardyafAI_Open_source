import { googleMessageReadInput } from "../domains/google/message-read.ts";
import { projectGoogleMessage } from "./google-message.ts";
import { createHash, timingSafeEqual } from "node:crypto";
import { ConnectionsError, fields, object, string } from "./contracts.ts";
import type { GoogleAuthorization, GoogleProvider, GoogleReadOperation } from "./contracts.ts";

export async function createGoogleProvider(): Promise<GoogleProvider> {
  const { OAuth2Client } = await import("google-auth-library");
  const client = (configuration: {clientId?: string; clientSecret?: string; redirectUri?: string} = {}) => {
    const oauth = new OAuth2Client({...configuration, transporterOptions: {timeout: 15_000, retry: false}});
    const request = oauth.transporter.request.bind(oauth.transporter);
    // The SDK sets retry:true on individual POSTs, overriding constructor defaults.
    // Gaxios also honors numeric retryConfig when retry is false. Pin both at the final boundary.
    // Consumed codes and rotating refreshes must never be replayed automatically.
    oauth.transporter.request = options => request({...options, timeout: 15_000, retry: false, retryConfig: {retry: 0, noResponseRetries: 0}});
    return oauth;
  };
  return {
    async authorizationUrl(input) {
      return client(input).generateAuthUrl({ access_type: "offline", prompt: "consent", scope: ["openid", "email", ...input.scopes], state: input.state,
        nonce: input.nonce, login_hint: input.expectedEmail, include_granted_scopes: false, code_challenge_method: "S256" as never,
        code_challenge: createHash("sha256").update(input.verifier).digest("base64url") });
    },
    async exchange(input, code) {
      const oauth = client(input);
      let tokens: {id_token?: string | null; refresh_token?: string | null; scope?: string} | undefined;
      try {
        ({ tokens } = await oauth.getToken({ code, codeVerifier: input.verifier, redirect_uri: input.redirectUri }));
      } catch (error) {
        throw oauthFailure(error, "code_exchange");
      }
      if (typeof tokens?.id_token !== "string" || !tokens.id_token || typeof tokens.refresh_token !== "string" || !tokens.refresh_token || typeof tokens.scope !== "string" || !tokens.scope)
        throw new ConnectionsError("google_grant_incomplete", 409);
      let payload: {sub?: string; email?: string; email_verified?: boolean; nonce?: string} | undefined;
      try {
        const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: input.clientId });
        payload = ticket.getPayload();
      } catch (error) {
        throw oauthFailure(error, "identity_verification");
      }
      const expected = Buffer.from(input.nonce), actual = Buffer.from(payload?.nonce ?? "");
      if (!payload?.sub || !payload.email || payload.email_verified !== true || expected.length !== actual.length || !timingSafeEqual(expected, actual))
        throw new ConnectionsError("google_identity_not_verified", 403);
      const scopes = tokens.scope.split(/\s+/).filter(Boolean);
      const allowed = new Set(["openid", "email", "https://www.googleapis.com/auth/userinfo.email", ...input.scopes]);
      if (scopes.some(scope => !allowed.has(scope))) throw new ConnectionsError("google_scope_exceeds_request", 403);
      return { refreshToken: tokens.refresh_token, email: payload.email, accountId: payload.sub, scopes };
    },
    async refresh(configuration, refreshToken) {
      try {
        const oauth = client(configuration);
        oauth.setCredentials({ refresh_token: refreshToken });
        let replacement: string | undefined;
        oauth.on("tokens", tokens => { if (tokens.refresh_token) replacement = tokens.refresh_token; });
        const { credentials } = await oauth.refreshAccessToken();
        if (!credentials.access_token) throw new ConnectionsError("google_refresh_failed");
        return {accessToken: credentials.access_token, ...(replacement ? {refreshToken: replacement} : {})};
      } catch { throw new ConnectionsError("google_refresh_failed", 503, "unknown"); }
    },
    async read(accessToken, operation, input, context) {
      const messageInput = operation === "gmail.get" ? googleMessageReadInput(input) : undefined;
      if (messageInput && (!context || !/^[a-f0-9]{64}$/.test(context.messageScope))) throw new ConnectionsError("google_message_scope_required", 403);
      const url = readUrl(operation, messageInput ?? input);
      let response: Response;
      try { response = await fetch(url, { headers: { authorization: "Bearer " + accessToken }, signal: AbortSignal.timeout(15_000), redirect: "error" }); }
      catch { throw new ConnectionsError("google_read_unavailable"); }
      if (!response.ok || !response.body) { await response.body?.cancel(); throw new ConnectionsError("google_read_unavailable"); }
      const chunks: Uint8Array[] = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 2_000_000) { await response.body.cancel().catch(() => {}); throw new ConnectionsError("google_read_too_large"); }
        chunks.push(chunk);
      }
      let value: unknown;
      try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { throw new ConnectionsError("google_read_invalid"); }
      return messageInput ? projectGoogleMessage(value, messageInput, context!.messageScope) : value;
    },
    async revoke(refreshToken) {
      try { await client().revokeToken(refreshToken); }
      catch (error) {
        if ((error as {response?: {status?:number;data?:{error?:string}}}).response?.status === 400 &&
          (error as {response?:{data?:{error?:string}}}).response?.data?.error === "invalid_token") return;
        throw new ConnectionsError("google_revocation_outcome_unknown", 503, "unknown");
      }
    },
  };
}

type OAuthFailureStage = "code_exchange" | "identity_verification";
/** SDK errors can contain complete tokens, request bodies and provider descriptions. Retain only fixed classifications. */
function oauthFailure(error: unknown, stage: OAuthFailureStage): ConnectionsError {
  const failure = error as {response?: {status?: unknown; data?: {error?: unknown}}; code?: unknown; cause?: {code?: unknown}} | undefined;
  const status = failure?.response?.status;
  const networkCodes = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "UND_ERR_CONNECT_TIMEOUT", "ERR_NETWORK", "TimeoutError"]);
  const temporary = status === 408 || status === 429 || typeof status === "number" && status >= 500 && status <= 599 ||
    networkCodes.has(String(failure?.code ?? "")) || networkCodes.has(String(failure?.cause?.code ?? ""));
  if (stage === "identity_verification") return Object.assign(new ConnectionsError(
    temporary ? "google_identity_verification_unavailable" : "google_identity_verification_failed", temporary ? 503 : 403, "unknown"),
    {stage, reason: temporary ? "transport_unavailable" : "identity_validation_failed"});
  const providerError = failure?.response?.data?.error;
  const rejected: Record<string, {code: string; status: number}> = {
    invalid_client: {code: "google_client_credentials_rejected", status: 400},
    unauthorized_client: {code: "google_client_credentials_rejected", status: 400},
    invalid_grant: {code: "google_authorization_code_rejected", status: 409},
    redirect_uri_mismatch: {code: "google_redirect_uri_mismatch", status: 400},
    access_denied: {code: "google_consent_denied", status: 403},
  };
  if (typeof providerError === "string" && Object.hasOwn(rejected, providerError)) {
    const selected = rejected[providerError];
    return Object.assign(new ConnectionsError(selected.code, selected.status), {stage, reason: providerError});
  }
  return Object.assign(new ConnectionsError(temporary ? "google_token_exchange_unavailable" : "google_token_exchange_failed", 503, "unknown"),
    {stage, reason: temporary ? "transport_unavailable" : "exchange_failed"});
}

function readUrl(operation: GoogleReadOperation, input: unknown): URL {
  const body = object(input);
  let url: URL;
  if (operation === "gmail.search") {
    fields(body, ["query", "limit", "pageToken"]); url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    url.searchParams.set("q", string(body.query, 2000));
  } else if (operation === "gmail.get") {
    googleMessageReadInput(body); const id = string(body.messageId, 128);
    if (!/^[A-Za-z0-9_-]+$/.test(id) || body.format !== undefined && !["full", "metadata"].includes(String(body.format))) throw new ConnectionsError("invalid_google_read", 400);
    url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages/" + encodeURIComponent(id));
    url.searchParams.set("format", String(body.format ?? "full"));
  } else if (operation === "calendar.list") {
    fields(body, ["from", "to", "query", "limit", "pageToken"]); const from = string(body.from, 40), to = string(body.to, 40);
    if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || Date.parse(to) <= Date.parse(from)) throw new ConnectionsError("invalid_google_read", 400);
    url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.set("timeMin", from); url.searchParams.set("timeMax", to);
    if (body.query !== undefined) url.searchParams.set("q", string(body.query, 1000));
  } else if (operation === "calendar.get") {
    fields(body, ["eventId"]); const id = string(body.eventId, 1024);
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new ConnectionsError("invalid_google_read", 400);
    url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events/" + encodeURIComponent(id));
  } else throw new ConnectionsError("connection_operation_not_allowed", 403);
  if (operation.endsWith(".search") || operation.endsWith(".list")) {
    const limit = body.limit ?? 20;
    if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100) throw new ConnectionsError("invalid_google_read", 400);
    url.searchParams.set("maxResults", String(limit));
    if (body.pageToken !== undefined) url.searchParams.set("pageToken", string(body.pageToken, 4096));
  }
  return url;
}

