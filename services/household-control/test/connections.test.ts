import assert from "node:assert/strict";
import test from "node:test";
import { ConnectionsService } from "../src/connections/service.ts";
import { createConnectionsRoutes } from "../src/connections/routes.ts";
import { ConnectionsError } from "../src/connections/contracts.ts";
import type { ConnectionRecord, ConnectionsStore, ConnectionVault, GoogleProvider } from "../src/connections/contracts.ts";

const current = () => {};
function fixture() {
  const rows = new Map<string, ConnectionRecord>(), values = new Map<string, string>();
  let ready = true, configured = false, exchanged = 0, failPut = false, active = true;
  const store: ConnectionsStore = { list: owner => [...rows.values()].filter(row => row.ownerProfileId === owner), get: (owner, id) => rows.get(id)?.ownerProfileId === owner ? rows.get(id) : undefined,
    save: row => { rows.set(row.id, row); } };
  const vault: ConnectionVault = {
    configured: async () => configured,
    bootstrap: async () => { configured = true; },
    put: async (key, value) => {
      if (failPut) { failPut = false; values.set(key, value); throw new ConnectionsError("credential_vault_outcome_unknown", 503, "unknown"); }
      if (values.has(key) && values.get(key) !== value) throw new ConnectionsError("connection_operation_conflict", 409);
      values.set(key, value); return { secretId: key, revision: "2026-11-25T00:00:00Z" };
    },
    read: async key => values.get(key)!,
    replace: async (key, expected, value) => { if (failPut) { failPut = false; throw new ConnectionsError("credential_vault_outcome_unknown",503,"unknown"); }
      assert.equal(values.get(key), expected); values.set(key, value); return {secretId:key,revision:"2026-11-25T00:00:00Z"}; },
  };
  const google: GoogleProvider = {
    authorizationUrl: async input => "https://accounts.google.com/o/oauth2/v2/auth?state=" + input.state,
    exchange: async input => { exchanged++; return { refreshToken: "fixture-refresh-secret", accountId: "fixture-google-subject", email: input.expectedEmail, scopes: input.scopes }; },
    revoke: async () => {},
    refresh: async () => ({accessToken:"fixture-access-token"}),
    read: async () => ({messages:[{id:"fixture-message"}]}),
  };
  const service = new ConnectionsService({ store, vault, google, securityReady: () => ready, now: () => Date.parse("2026-11-25T00:00:00Z") });
  return { service, rows, values, google, exchanged: () => exchanged, failPut: () => { failPut = true; }, ready: (value: boolean) => { ready = value; },
    active: (value: boolean) => { active = value; }, assertCurrent: () => { if (!active) throw new ConnectionsError("connections_not_allowed", 403); } };
}
const googleConfig = { operationId: "google-config-0001", clientId: "fixture.apps.googleusercontent.com", clientSecret: "fixture-client-secret", redirectUri: "https://credentials.example.invalid/v1/connections/google/callback" };
const googleStart = { operationId: "google-start-0001", label: "Personal Gmail", expectedEmail: "owner@example.invalid", preset: "gmail_read" };
async function begin(f: ReturnType<typeof fixture>) {
  await f.service.configureGoogle("owner", googleConfig, f.assertCurrent);
  const start = await f.service.startGoogle("owner", googleStart, f.assertCurrent);
  const state = new URL(start.authorizationUrl).searchParams.get("state")!;
  return { start, callbackUrl: googleConfig.redirectUri + "?state=" + state + "&code=fixture-authorization-code" };
}

test("credential password values stay in vault and retry identities cannot overwrite", async () => {
  const f = fixture(), body = { operationId: "password-operation-0001", label: "Provider", username: "owner", password: "fixture-password-secret", origin: "https://provider.example.invalid" };
  const first = await f.service.savePassword("owner", body, current);
  assert.deepEqual(await f.service.savePassword("owner", body, current), first);
  assert.equal(f.values.size, 1);
  assert.doesNotMatch(JSON.stringify([...f.rows.values()]), /fixture-password-secret/);
  assert.doesNotMatch(JSON.stringify(await f.service.snapshot("owner")), /fixture-password-secret|secretId/);
  await assert.rejects(f.service.savePassword("owner", { ...body, password: "changed" }, current), /connection_operation_conflict/);
  assert.equal((await f.service.snapshot("other")).connections.length, 0);
});
test("OAuth state and redirect checks fail before a provider code exchange", async () => {
  const f = fixture(), { start, callbackUrl } = await begin(f);
  await assert.rejects(f.service.completeGoogle("other", { flowId: start.flowId, callbackUrl }, current), /expired/);
  await assert.rejects(f.service.completeGoogle("owner", { flowId: start.flowId, callbackUrl: callbackUrl.replace("state=", "state=wrong") }, current), /invalid_google_callback/);
  await assert.rejects(f.service.completeGoogle("owner", { flowId: start.flowId, callbackUrl: callbackUrl.replace("credentials.example.invalid", "attacker.example.invalid") }, current), /invalid_google_callback/);
  assert.equal(f.exchanged(), 0);
});
test("OAuth callback commits once and retry after vault uncertainty never exchanges code again", async () => {
  const f = fixture(), { start, callbackUrl } = await begin(f);
  f.failPut();
  await assert.rejects(f.service.acceptGoogleCallback(callbackUrl), /vault_outcome_unknown/);
  assert.equal(f.exchanged(), 1);
  const saved = await f.service.completeGoogle("owner", { flowId: start.flowId, callbackUrl }, current);
  assert.equal(f.exchanged(), 1);
  assert.deepEqual(await f.service.acceptGoogleCallback(callbackUrl), saved);
  assert.doesNotMatch(JSON.stringify(saved), /refresh-secret|client-secret|secretId/);
  const stored = JSON.parse(f.values.get(saved.connection.id)!);
  assert.equal(stored.clientSecretId, [...f.rows.values()].find(row => row.kind === "google_client")!.secretId);
});
test("live device authority is checked again on callback and after provider return", async () => {
  const f = fixture(), { callbackUrl } = await begin(f); f.active(false);
  await assert.rejects(f.service.acceptGoogleCallback(callbackUrl), /not_allowed/);
  assert.equal(f.exchanged(), 0);
  const g = fixture(), second = await begin(g);
  g.google.exchange = async input => { g.active(false); return { refreshToken: "fixture-refresh", email: input.expectedEmail, accountId: "fixture-sub", scopes: input.scopes }; };
  await assert.rejects(g.service.acceptGoogleCallback(second.callbackUrl), /not_allowed/);
  assert.equal([...g.rows.values()].filter(row => row.kind === "google").length, 0);
});
test("owner-only HTTPS route rejects before parsing credentials and isolation fails closed", async () => {
  const f = fixture(); let parsed = false;
  const routes = createConnectionsRoutes({ service: f.service, assertCurrent: current });
  const request = { method: "POST", socket: { encrypted: false } } as any;
  const context = { device: { kind: "signed", deviceKind: "personal", deviceId: "fixture-device" }, profile: { id: "owner", role: "admin", capabilities: ["manageAccess"] } } as any;
  const response = { writeHead: () => { parsed = true; }, end: () => {} } as any;
  await assert.rejects(routes.route(request, response, new URL("https://credentials.example.invalid/v1/connections/password"), Buffer.from("invalid JSON"), context), /https_required/);
  request.socket.encrypted = true; f.ready(false);
  await assert.rejects(routes.route(request, response, new URL("https://credentials.example.invalid/v1/connections/password"), Buffer.from("invalid JSON"), context), /isolation_unavailable/);
  context.profile.role = "adult";
  await assert.rejects(routes.route(request, response, new URL("https://credentials.example.invalid/v1/connections/password"), Buffer.from("invalid JSON"), context), /not_allowed/);
  assert.equal(parsed, false);
});

test("Google read enforces owner scope and writes rotated refresh token before provider read", async () => {
  const f = fixture(), {callbackUrl} = await begin(f);
  const saved = await f.service.acceptGoogleCallback(callbackUrl);
  await assert.rejects(f.service.readGoogle("other", saved.connection.id, "gmail.search", {query:"newer_than:7d"}, current), /not_available/);
  await assert.rejects(f.service.readGoogle("owner", saved.connection.id, "calendar.list", {from:"2026-11-01T00:00:00Z",to:"2026-12-01T00:00:00Z"}, current), /not_allowed/);
  f.google.refresh = async () => ({accessToken:"fixture-access-token",refreshToken:"rotated-fixture-refresh"});
  f.google.read = async (access, operation) => { assert.equal(access,"fixture-access-token"); assert.equal(operation,"gmail.search");
    assert.equal(JSON.parse(f.values.get(saved.connection.id)!).refreshToken,"rotated-fixture-refresh"); return {messages:[{id:"fixture-message"}]}; };
  const result = await f.service.readGoogle("owner",saved.connection.id,"gmail.search",{query:"newer_than:7d"},current);
  assert.equal(result.untrusted,true); assert.doesNotMatch(JSON.stringify(result),/access-token|rotated-fixture/);
});
test("uncertain rotating token writeback blocks further refresh and data reads", async () => {
  const f = fixture(), {callbackUrl} = await begin(f), saved = await f.service.acceptGoogleCallback(callbackUrl);
  let reads = 0; f.google.refresh = async () => ({accessToken:"fixture-access-token",refreshToken:"rotated-fixture-refresh"});
  f.google.read = async () => { reads++; return {}; }; f.failPut();
  await assert.rejects(f.service.readGoogle("owner",saved.connection.id,"gmail.search",{query:"test"},current),/outcome_unknown/);
  assert.equal(reads,0); assert.equal(f.rows.get(saved.connection.id)!.status,"unknown");
  await assert.rejects(f.service.readGoogle("owner",saved.connection.id,"gmail.search",{query:"test"},current),/not_available/);
});

test("unknown initial secret creation stays visible and blocks a fresh duplicate operation", async () => {
  const f = fixture(), body = {operationId:"unknown-password-0001",label:"Provider",username:"owner",password:"fixture-password-secret",origin:"https://provider.example.invalid"};
  f.failPut(); await assert.rejects(f.service.savePassword("owner",body,current),/outcome_unknown/);
  const pending = (await f.service.snapshot("owner")).connections[0]; assert.equal(pending.status,"unknown");
  await assert.rejects(f.service.savePassword("owner",{...body,operationId:"fresh-password-0002"},current),/reconciliation_required/);
  const saved = await f.service.savePassword("owner",body,current); assert.equal(saved.connection.id,pending.id); assert.equal(f.values.size,1);
});
