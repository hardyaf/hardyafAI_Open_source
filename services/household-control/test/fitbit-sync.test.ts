import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { HouseholdDatabase } from "../src/database.ts";
import { DeviceAuthenticator, canonicalDeviceRequest } from "../src/device-auth.ts";
import { createHouseholdServer } from "../src/server.ts";
import { MockHouseholdAgentAdapter } from "../src/mock-adapter.ts";
import { SqliteHouseholdStore } from "../src/sqlite-household-store.ts";
import { createFitbitRoutes } from "../src/fitbit/routes.ts";
import { DeviceEffectStore } from "../src/fitbit/device-effects.ts";

const snapshot = (phase = "running") => ({version:1,ok:true,phase,sessionId:"a".repeat(32),
  startedAt:"2026-11-16T23:00:00Z",endsAt:"2026-11-16T23:20:00Z",
  account:"must-not-leak@example.invalid",path:"/private/host/path",steps:12345,lastSyncTime:"2026-11-16T23:01:00Z"});
async function fixture(options: { database?: HouseholdDatabase; helperPath?: string; dispatch?: (action: string, current: () => void) => Promise<unknown> } = {}) {
  const db = options.database ?? new HouseholdDatabase(":memory:");
  const store = new SqliteHouseholdStore(db,new MockHouseholdAgentAdapter([]),{dispatcherEnabled:false});
  let calls = 0;
  const controller = {async execute(action: "status"|"start"|"stop", guest: "guest1"|"guest2", current:()=>void) {
    current(); assert.equal(guest,"guest1"); calls++;
    return options.dispatch ? options.dispatch(action,current) : snapshot(action === "stop" ? "stopping" : "running");
  }};
  const routes = createFitbitRoutes({configuration:{controller:options.helperPath??"/fixture/controller",profiles:{belle:{guestId:"guest1"}}},
    effects:new DeviceEffectStore(db.domainConnection()),...(options.helperPath?{}:{controller}),
    assertCurrent(context) {
      const device = db.getDevice(context.device.deviceId);
      if (!device || device.status !== "active" || device.profileId !== context.profile.id) throw Object.assign(new Error("device_authority_revoked"),{statusCode:403});
    }});
  const server = createHouseholdServer({database:db,store,authenticator:new DeviceAuthenticator({database:db}),route:routes.route});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const base = "http://127.0.0.1:"+(server.address() as AddressInfo).port;
  const keys = generateKeyPairSync("ec",{namedCurve:"prime256v1"});
  const enrolled = new Map<string,string>();
  const enroll = (profileId: string) => {
    if (!enrolled.has(profileId)) {
      const invite=db.createInvitation(profileId);
      const claimed=db.claimInvitation({code:invite.code,displayName:"Fitbit fixture",
        publicKeyDerBase64:keys.publicKey.export({format:"der",type:"spki"}).toString("base64")});
      enrolled.set(profileId,claimed!.deviceId);
    }
    return enrolled.get(profileId)!;
  };
  const request = (method: string, path="/v1/fitbit", body?: unknown, profileId="belle") => {
    const deviceId=enroll(profileId), text=body===undefined?"":JSON.stringify(body);
    const timestamp=String(Date.now()),nonce="nonce-"+randomUUID();
    const signature=sign("sha256",Buffer.from(canonicalDeviceRequest({method,path,timestamp,nonce,body:Buffer.from(text)})),keys.privateKey).toString("base64");
    return fetch(base+path,{method,body:body===undefined?undefined:text,headers:{"content-type":"application/json",
      "x-hardy-device-id":deviceId,"x-hardy-timestamp":timestamp,"x-hardy-nonce":nonce,"x-hardy-signature":signature}});
  };
  return {db,request,enroll,calls:()=>calls,
    close:async()=>{await routes.close();await server.shutdown();}};
}

test("signed self-scoped Fitbit status never leaks account, host path, health values or fabricated sync proof",async()=>{
  const f=await fixture();
  try {
    const response=await f.request("GET");assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.fitbit.phase,"running");assert.equal(body.fitbit.syncVerified,false);
    assert.equal(body.fitbit.lastSyncTime,null);assert.equal(body.fitbit.dataConnection,"not_connected");
    assert.equal(JSON.stringify(body).includes("must-not-leak"),false);
    assert.equal(JSON.stringify(body).includes("/private/"),false);
    assert.equal("steps" in body.fitbit,false);
    assert.equal((await f.request("GET","/v1/fitbit",undefined,"fred")).status,403);
    assert.equal((await f.request("GET","/v1/fitbit",undefined,"alex")).status,403);
    assert.equal((await f.request("GET","/v1/fitbit?profileId=alex")).status,400);
    assert.equal(f.calls(),1);
  }finally{await f.close();}
});
test("Fitbit start receipts replay once, reject changed operations and do not need a chat",async()=>{
  const f=await fixture();
  try {
    const body={operationId:"fitbit-"+randomUUID()};
    assert.equal((await f.request("POST","/v1/fitbit/sync",body)).status,202);
    const replay=await f.request("POST","/v1/fitbit/sync",body);assert.equal(replay.status,200);
    assert.equal((await replay.json()).replayed,true);assert.equal(f.calls(),2);
    assert.equal((await f.request("DELETE","/v1/fitbit/sync",body)).status,409);
    assert.equal((await f.request("POST","/v1/fitbit/sync",{...body,profileId:"alex"})).status,400);
    assert.equal((await f.request("POST","/v1/fitbit/sync",{operationId:"../../host"})).status,400);
    assert.equal((await f.request("POST","/v1/fitbit/sync",{operationId:"fitbit-"+randomUUID()},"fred")).status,403);
    assert.equal((await f.request("DELETE","/v1/fitbit/sync",{operationId:"fitbit-"+randomUUID()})).status,202);
    assert.equal(f.calls(),3);
  }finally{await f.close();}
});
test("ambiguous Fitbit effects are retained and never automatically replayed",async()=>{
  const f=await fixture({dispatch:async()=>{throw new Error("simulated_transport_loss");}});
  try {
    const body={operationId:"fitbit-"+randomUUID()};
    assert.equal((await f.request("POST","/v1/fitbit/sync",body)).status,500);
    const retry=await f.request("POST","/v1/fitbit/sync",body);assert.equal(retry.status,409);
    assert.equal((await retry.json()).error,"fitbit_operation_unconfirmed");assert.equal(f.calls(),1);
    const row=f.db.domainConnection().prepare("SELECT state FROM device_effects WHERE operation_id=?").get(body.operationId);
    assert.equal(row!.state,"unknown");
  }finally{await f.close();}
});
test("revocation during an accepted host effect blocks the reply while retaining its receipt",async()=>{
  let f:Awaited<ReturnType<typeof fixture>>;
  f=await fixture({dispatch:async()=>{f.db.revokeDevice(f.enroll("belle"));return snapshot();}});
  try {
    const body={operationId:"fitbit-"+randomUUID()};
    assert.equal((await f.request("POST","/v1/fitbit/sync",body)).status,403);
    assert.equal((await f.request("GET")).status,401);
    assert.equal(f.db.domainConnection().prepare("SELECT state FROM device_effects WHERE operation_id=?").get(body.operationId)!.state,"committed");
  }finally{await f.close();}
});
test("device receipts survive SQLite reopen and are not rebound to another device",async()=>{
  const root=await mkdtemp(join(tmpdir(),"fitbit-receipts-"));
  try {
    const path=join(root,"household.sqlite"),db=new HouseholdDatabase(path);
    const keys=generateKeyPairSync("ec",{namedCurve:"prime256v1"});
    const invite=db.createInvitation("belle");
    const device=db.claimInvitation({code:invite.code,displayName:"Fixture",publicKeyDerBase64:keys.publicKey.export({type:"spki",format:"der"}).toString("base64")})!;
    const effects=new DeviceEffectStore(db.domainConnection()),id="fitbit-"+randomUUID();
    effects.begin("belle",device.deviceId,id,"fitbit.start",{guestId:"guest1"});
    effects.finish("belle",id,"committed",{accepted:true});db.close();
    const reopened=new HouseholdDatabase(path),next=new DeviceEffectStore(reopened.domainConnection());
    assert.deepEqual(next.begin("belle",device.deviceId,id,"fitbit.start",{guestId:"guest1"}),{replayed:true,result:{accepted:true}});
    assert.throws(()=>next.begin("belle","another-device",id,"fitbit.start",{guestId:"guest1"}),/conflict/);
    assert.equal(reopened.schemaVersion,8);reopened.close();
  }finally{await rm(root,{recursive:true,force:true});}
});

test("a known busy preflight is not dispatched and allows a fresh request after release",async()=>{
  let busy=true;
  const f=await fixture({dispatch:async()=>{if(busy)throw Object.assign(new Error("fitbit_radio_busy"),{statusCode:409,outcome:"not_sent"});return snapshot();}});
  try{
    const id="fitbit-"+randomUUID();
    assert.equal((await f.request("POST","/v1/fitbit/sync",{operationId:id})).status,409);
    assert.equal(f.db.domainConnection().prepare("SELECT state FROM device_effects WHERE operation_id=?").get(id)!.state,"failed");
    busy=false;
    assert.equal((await f.request("POST","/v1/fitbit/sync",{operationId:"fitbit-"+randomUUID()})).status,202);
  }finally{await f.close();}
});

test("isolated Fitbit controller receives only its current user's service bus context",async()=>{
 const root=await mkdtemp(join(tmpdir(),"fitbit-environment-")),helper=join(root,"helper");
 await writeFile(helper,"#!"+process.execPath+"\n"+String.raw`const runtime='/run/user/'+process.getuid();const ok=process.env.XDG_RUNTIME_DIR===runtime&&process.env.DBUS_SESSION_BUS_ADDRESS==='unix:path='+runtime+'/bus';process.stdout.write(JSON.stringify({version:1,ok:true,phase:ok?'idle':'unavailable'}));`,{mode:0o700});
 const f=await fixture({helperPath:helper});
 try{const response=await f.request("GET");assert.equal(response.status,200);assert.equal((await response.json()).fitbit.phase,"idle");}
 finally{await f.close();await rm(root,{recursive:true,force:true});}
});
