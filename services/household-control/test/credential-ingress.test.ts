import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdtemp, chmod, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { HouseholdDatabase } from "../src/database.ts";
import { canonicalDeviceRequest } from "../src/device-auth.ts";
import { createSecureListener } from "../src/platform/secure-listener.ts";
import { createCredentialIngress } from "../src/connections/server.ts";
import { ConnectionsService } from "../src/connections/service.ts";
import { ConnectionRepository } from "../src/connections/repository.ts";
import type { GoogleProvider } from "../src/connections/contracts.ts";

test("protected ingress keeps credential bodies outside control traffic and rejects unsigned or HTTP entry", async () => {
  const root = await mkdtemp(join(tmpdir(), "credential-ingress-"));
  const key = join(root, "server.key"), cert = join(root, "server.pem");
  execFileSync("/usr/bin/openssl", ["req","-x509","-newkey","rsa:2048","-nodes","-days","1",
    "-subj","/CN=Credential fixture","-addext","subjectAltName=IP:127.0.0.1","-keyout",key,"-out",cert], {stdio:"ignore"});
  await chmod(key, 0o600); await chmod(cert, 0o600);
  const database = new HouseholdDatabase(":memory:");
  const forwarded: string[] = [];
  const control = createServer((request,response) => { forwarded.push(request.url!); response.end("ordinary"); });
  await new Promise<void>(resolve => control.listen(0, "127.0.0.1", resolve));
  const saved: string[] = [];
  const service = new ConnectionsService({ store: new ConnectionRepository(database.domainConnection()), securityReady: () => true,
    vault: { configured: async () => true, bootstrap: async () => {}, read: async () => "",
      put: async (_key,value) => { saved.push(value); return {secretId:"00000000-0000-0000-0000-000000000001",revision:new Date().toISOString()}; },
      replace: async () => { throw new Error("unused"); } }, google: {} as GoogleProvider });
  const application = createCredentialIngress({ database, service, homeRoot: root,
    publicOrigin: "https://fixture.example.invalid", controlUrl: new URL("http://127.0.0.1:" + (control.address() as AddressInfo).port) });
  await new Promise<void>(resolve => application.listen(0, "127.0.0.1", resolve));
  const secure = await createSecureListener(application, {certificate:cert,privateKey:key});
  await new Promise<void>(resolve => secure.listen(0,"127.0.0.1",resolve));
  const ca = await readFile(cert), port = (secure.address() as AddressInfo).port;
  const tls = (method:string,path:string,body:string,headers:Record<string,string> = {}) => new Promise<{status:number;text:string}>((resolve,reject) => {
    const request=httpsRequest({hostname:"127.0.0.1",port,method,path,ca,headers:{"content-type":"application/json",...headers}},response=>{
      const chunks:Buffer[]=[];response.on("data",chunk=>chunks.push(Buffer.from(chunk)));
      response.on("end",()=>resolve({status:response.statusCode!,text:Buffer.concat(chunks).toString()}));
    });request.on("error",reject);request.end(body);
  });
  try {
    const plain = "http://127.0.0.1:" + (application.address() as AddressInfo).port;
    const body = JSON.stringify({operationId:"login-"+randomUUID(),label:"Fixture",username:"bot@example.invalid",password:"SYNTHETIC-SECRET",origin:"https://mail.example.invalid"});
    assert.equal((await fetch(plain+"/v1/connections/password",{method:"POST",body})).status,426);
    assert.equal((await tls("POST","/v1/connections/password",body)).status,401);
    assert.deepEqual(forwarded,[]); assert.deepEqual(saved,[]);
    assert.equal(await (await fetch(plain+"/ordinary")).text(),"ordinary");
    const keys=generateKeyPairSync("ec",{namedCurve:"prime256v1"});
    const invite=database.createInvitation("alex");
    const device=database.claimInvitation({code:invite.code,displayName:"Fixture owner",publicKeyDerBase64:keys.publicKey.export({type:"spki",format:"der"}).toString("base64")})!;
    const timestamp=String(Date.now()),nonce=randomUUID(),path="/v1/connections/password";
    const signature=sign("sha256",Buffer.from(canonicalDeviceRequest({method:"POST",path,timestamp,nonce,body:Buffer.from(body)})),keys.privateKey).toString("base64");
    const headers={"x-hardy-device-id":device.deviceId,"x-hardy-timestamp":timestamp,"x-hardy-nonce":nonce,"x-hardy-signature":signature};
    const result=await tls("POST",path,body,headers);
    assert.equal(result.status,200); assert.equal(saved.length,1);
    assert.equal(result.text.includes("SYNTHETIC-SECRET"),false);
    assert.equal(JSON.stringify(database.domainConnection().prepare("SELECT * FROM credential_connections").all()).includes("SYNTHETIC-SECRET"),false);
    assert.deepEqual(forwarded,["/ordinary"]);
    assert.equal((await tls("POST",path,body,headers)).status,401);
  } finally {
    application.closeConnections();
    await new Promise<void>(resolve=>secure.close(()=>resolve()));
    application.closeAllConnections(); control.closeAllConnections();
    await new Promise<void>(resolve=>application.close(()=>resolve()));
    await new Promise<void>(resolve=>control.close(()=>resolve()));
    database.close(); await rm(root,{recursive:true,force:true});
  }
});
