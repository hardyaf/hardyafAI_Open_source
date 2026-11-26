import assert from "node:assert/strict";
import test from "node:test";
import { ConnectionsService } from "../src/connections/service.ts";
import type { ConnectionRecord, ConnectionsStore, ConnectionVault, GoogleProvider } from "../src/connections/contracts.ts";

function fixture() {
  const rows = new Map<string, ConnectionRecord>(), secrets = new Map<string, string>();
  const store: ConnectionsStore = {
    list: owner => [...rows.values()].filter(row => row.ownerProfileId === owner),
    get: (owner, id) => rows.get(id)?.ownerProfileId === owner ? rows.get(id) : undefined,
    save: row => { rows.set(row.id, row); },
  };
  const vault: ConnectionVault = {
    configured: async () => true, bootstrap: async () => {},
    put: async (id, value) => { secrets.set(id, value); return {secretId:id,revision:"fixture"}; },
    read: async id => secrets.get(id)!,
    replace: async () => { throw new Error("unused"); },
  };
  let authorizationSecret = "";
  const google = {
    authorizationUrl: async input => { authorizationSecret = input.clientSecret; return "https://accounts.google.com/o/oauth2/v2/auth?state=" + input.state; },
  } as GoogleProvider;
  return { rows, secrets, authorizationSecret: () => authorizationSecret,
    service: new ConnectionsService({store,vault,google,securityReady:()=>true}) };
}
const setup = {operationId:"client-normalization-0001",clientId:"fixture.apps.googleusercontent.com",
  redirectUri:"http://localhost:8787/oauth2/callback"};

test("Google client clipboard whitespace is removed before vault storage and authorization", async () => {
  const f = fixture(), clean = "fixture-google-client-secret";
  await f.service.configureGoogle("owner", {...setup,clientSecret:" \t\r\n" + clean + "\r\n\t "}, () => {});
  assert.equal(JSON.parse([...f.secrets.values()][0]).clientSecret,clean);
  await f.service.startGoogle("owner",{operationId:"client-normalization-start-0001",label:"Fixture Gmail",expectedEmail:"owner@example.invalid",preset:"gmail_read"},()=>{});
  assert.equal(f.authorizationSecret(),clean);
  assert.doesNotMatch(JSON.stringify(await f.service.snapshot("owner")),/fixture-google-client-secret/);
});
test("blank Google client secret is rejected before any metadata or provider write", async () => {
  const f = fixture();
  await assert.rejects(f.service.configureGoogle("owner",{...setup,clientSecret:" \t\r\n "},()=>{}),/invalid_google_client/);
  assert.equal(f.rows.size,0);
  assert.equal(f.secrets.size,0);
});
test("password whitespace remains part of the delegated password", async () => {
  const f = fixture(), password = "  fixture-password-with-spaces  ";
  await f.service.savePassword("owner",{operationId:"password-whitespace-0001",label:"Fixture account",username:"owner",
    password,origin:"https://provider.example.invalid"},()=>{});
  assert.equal(JSON.parse([...f.secrets.values()][0]).password,password);
});
