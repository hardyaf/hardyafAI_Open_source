import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { HouseholdDatabase } from "../src/database.ts";
import { createNativeCredentialConsumer, listenNativeCredentialConsumer } from "../src/connections/native-consumer.ts";
import { ConnectedGoogleClient } from "../src/domain-runtime/connected-google.ts";
import { GoogleDomain } from "../src/domains/google/index.ts";
import { createGoogleProvider } from "../src/connections/google.ts";
import { redirect } from "../src/connections/contracts.ts";

async function fixture(audience: "private" | "household" = "private") {
  const directory = await mkdtemp(path.join(tmpdir(), "hardy-connected-google-"));
  const database = new HouseholdDatabase(":memory:"), sql = database.domainConnection();
  sql.prepare("INSERT INTO devices(id,profile_id,display_name,public_key_der_base64,status,enrolled_at) VALUES ('fixture-device','alex','Fixture','not-a-real-key','active',?)").run(new Date().toISOString());
  const conversation = { id: "fixture-conversation", ownerProfileId: "alex", agentId: "main", sessionKey: "hardy-home:fixture", title: "Fixture", presetId: null, audience, updatedAt: new Date().toISOString() };
  database.insertConversation(conversation);
  database.submissions.enqueue({ submissionId: "fixture-submission", conversationId: conversation.id, profileId: "alex", agentId: "main", textHash: createHash("sha256").update("Read fixture mail").digest("hex"),
    requestHash: "fixture-request-hash", payload: { kind: "message", text: "Read fixture mail" }, originDeviceId: "fixture-device" });
  const claim = database.submissions.claimNext(2, 120000)!;
  database.submissions.accepted(claim.receipt.submissionId, claim.leaseToken!, { ...claim.receipt, status: "running", runId: "fixture-native-run" });
  const grant = { enabled: true, domains: ["email"], scopes: ["personal", "household"], contactEditing: false, projectCodes: [], canManageProjects: false,
    canReviewReceipts: false, allowedAttendees: [], sharedDomains: [] };
  let calls = 0, finish: (() => void) | undefined, entered: (() => void) | undefined;
  let hold: Promise<void> | undefined;
  const service = {
    assertSecure() {},
    async snapshot(owner: string) { assert.equal(owner, "alex"); return { connections: [
      { id: "connection-" + "0".repeat(32), kind: "google", status: "connected", preset: "gmail_read", label: "Fixture mail" },
      { id: "connection-" + "1".repeat(32), kind: "google", status: "connected", preset: "calendar_read", label: "Fixture calendar" },
    ] }; },
    async readGoogle(owner: string, connectionId: string, operation: string, args: unknown, current: () => void) {
      current(); calls++; assert.equal(owner, "alex"); assert.equal(operation, "gmail.search"); assert.deepEqual(args, { query: "from:school" });
      entered?.(); if (hold) await hold;
      return { connectionId, result: { messages: [{ id: "fixture-message", snippet: "private-mail-body" }] }, untrusted: true };
    },
  };
  const server = createNativeCredentialConsumer({ database, service: service as any, configuration: { profiles: { alex: grant }, execution: { nativeEntries: [] } } as any });
  const socketPath = path.join(directory, "consumer.sock"); await listenNativeCredentialConsumer(server, socketPath);
  const authority = { agentId: "main", sessionKey: conversation.sessionKey, sessionId: "fixture-session", nativeSessionId: "fixture-session", runId: "fixture-native-run" };
  const context = { profileId: "alex", agentId: "main", sessionKey: conversation.sessionKey, conversationId: conversation.id, audience,
    allowedScopes: ["personal", "household"], authorizedAttendees: [], credentialAuthority: authority, assertCurrent() {} } as any;
  return { database, sql, context, client: new ConnectedGoogleClient(socketPath), calls: () => calls,
    hold() { hold = new Promise<void>(resolve => { finish = resolve; }); return new Promise<void>(resolve => { entered = resolve; }); },
    release() { finish?.(); },
    async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); database.close(); await rm(directory, { recursive: true, force: true }); } };
}

test("native Google broker reuses admitted private source and filters discovery by current domain grants", async () => {
  const f = await fixture();
  try {
    const discovered = await f.client.list(f.context) as any;
    assert.equal(discovered.connections.length, 1); assert.equal(discovered.connections[0].preset, "gmail_read");
    const runner = { async runJson() { throw new Error("legacy provider must not run for selected connection"); } };
    const google = new GoogleDomain({ gogBinary: "/trusted/gog", account: "bot@example.invalid", client: "house", calendarId: "house", timeZone: "America/New_York" }, runner, f.client);
    const result = await google.execute("household_email_search", { connectionId: discovered.connections[0].id, query: "from:school" }, f.context);
    assert.equal(f.calls(), 1); assert.equal((result as any).source, "connected_google");
    await assert.rejects(google.execute("household_calendar_create", { connectionId: discovered.connections[0].id }, f.context), /connected_google_unavailable/);
    await assert.rejects(f.client.read(discovered.connections[0].id, "household_calendar_list", {}, f.context), /not_allowed/);
    await assert.rejects(f.client.read(discovered.connections[0].id, "household_email_search", { query: "from:school" }, { ...f.context, credentialAuthority: { ...f.context.credentialAuthority, runId: "unrelated-run" } }), /lineage_not_authorized/);
    assert.equal(f.calls(), 1);
  } finally { await f.close(); }
});
test("native Google broker rejects shared audience and revoked device before private content returns", async () => {
  const shared = await fixture("household");
  try { await assert.rejects(async () => shared.client.list(shared.context), /private_connection_context_required/); assert.equal(shared.calls(), 0); }
  finally { await shared.close(); }
  const f = await fixture();
  try {
    const entered = f.hold();
    const pending = f.client.read("connection-" + "0".repeat(32), "household_email_search", { query: "from:school" }, f.context);
    await entered; f.sql.prepare("UPDATE devices SET status='revoked' WHERE id='fixture-device'").run(); f.release();
    await assert.rejects(pending, error => { assert.doesNotMatch(String(error), /private-mail-body/); return /domain_authority_revoked/.test(String(error)); });
  } finally { f.release(); await f.close(); }
});
test("Google read provider uses fixed read URLs and rejects caller-selected accounts and write shapes", async () => {
  const provider = await createGoogleProvider(), previous = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input, options) => { calls.push(String(input)); assert.equal((options?.headers as any).authorization, "Bearer fixture-access"); return new Response(JSON.stringify({ messages: [] }), { status: 200 }); };
  try {
    await provider.read("fixture-access", "gmail.search", { query: "from:school", limit: 10 });
    assert.equal(new URL(calls[0]).origin, "https://gmail.googleapis.com"); assert.equal(new URL(calls[0]).pathname, "/gmail/v1/users/me/messages");
    await assert.rejects(provider.read("fixture-access", "gmail.search", { query: "from:school", account: "other" }), /invalid_connection_request/);
    await assert.rejects(provider.read("fixture-access", "calendar.list", { from: "2026-11-01T00:00:00Z", to: "2026-12-01T00:00:00Z", calendarId: "other" }), /invalid_connection_request/);
    assert.equal(calls.length, 1);
  } finally { globalThis.fetch = previous; }
  assert.throws(() => redirect("https://192.168.1.127:4321/v1/connections/google/callback"), /invalid_google_redirect/);
  assert.equal(redirect("http://localhost:8787/oauth2/callback"), "http://localhost:8787/oauth2/callback");
});

test("connected Gmail read projects plain text and omits raw MIME HTML and attachment data", async () => {
  const provider = await createGoogleProvider(), previous = globalThis.fetch;
  const fixture = {id:"fixture-message",threadId:"fixture-thread",snippet:"Provider plain snippet",payload:{headers:[{name:"Subject",value:"Fixture mail"},{name:"X-Provider-Secret",value:"hidden-header"}],parts:[
    {mimeType:"text/plain",body:{data:Buffer.from("Plain fixture body").toString("base64url")}},
    {mimeType:"text/html",body:{data:Buffer.from("<script>hidden-html</script>").toString("base64url")}},
    {mimeType:"text/plain",filename:"attachment.txt",body:{data:Buffer.from("hidden-attachment").toString("base64url"),attachmentId:"hidden-attachment-id"}},
  ]}};
  globalThis.fetch = async () => new Response(JSON.stringify(fixture),{status:200});
  try {
    const value = await provider.read("fixture-access","gmail.get",{messageId:"fixture-message"},{messageScope:"a".repeat(64)}) as any;
    assert.equal(value.body,"Plain fixture body"); assert.equal(value.bodySource,"text/plain");
    assert.doesNotMatch(JSON.stringify(value),/hidden-header|hidden-html|hidden-attachment|attachmentId|payload/);
    fixture.payload.parts = [fixture.payload.parts[1]];
    const htmlOnly = await provider.read("fixture-access","gmail.get",{messageId:"fixture-message"},{messageScope:"a".repeat(64)}) as any;
    assert.equal(htmlOnly.body,"Provider plain snippet"); assert.equal(htmlOnly.bodySource,"snippet");
  } finally {globalThis.fetch=previous;}
});

test("connected calendar date windows retain configured midnight offsets across DST", async () => {
  let received: Record<string, unknown> | undefined;
  const domain = new GoogleDomain({gogBinary:"/usr/bin/gog",account:"bot@example.invalid",client:"house",calendarId:"primary",timeZone:"America/New_York"},
    {runJson:async()=>{throw new Error("unexpected_legacy_provider");}},
    {list:async()=>({connections:[]}),read:async(_id,_tool,args)=>{received=args as Record<string,unknown>;return {};}});
  await domain.execute("household_calendar_list",{connectionId:"fixture",from:"2026-03-08",to:"2026-03-09"},
    {profileId:"alex",agentId:"main",sessionKey:"fixture",conversationId:"fixture",audience:"private",allowedScopes:["personal"],authorizedAttendees:[],assertCurrent(){}});
  assert.equal(received?.from,"2026-03-08T00:00:00-05:00");
  assert.equal(received?.to,"2026-03-09T00:00:00-04:00");
});
