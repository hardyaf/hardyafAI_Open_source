import assert from "node:assert/strict";
import {generateKeyPairSync,randomUUID,sign} from "node:crypto";
import {mkdtemp,readFile,chmod,rm,symlink} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {request as httpsRequest} from "node:https";
import type {AddressInfo} from "node:net";
import test from "node:test";
import {createHouseholdServer} from "../src/server.ts";
import {HouseholdDatabase} from "../src/database.ts";
import {DeviceAuthenticator,canonicalDeviceRequest} from "../src/device-auth.ts";
import {createSecureListener} from "../src/platform/secure-listener.ts";

async function certificate() {
 const root=await mkdtemp(join(tmpdir(),"household-tls-"));
 const key=join(root,"server.key"),cert=join(root,"server.pem");
 execFileSync("/usr/bin/openssl",["req","-x509","-newkey","rsa:2048","-nodes","-days","1",
  "-subj","/CN=Household TLS fixture","-addext","subjectAltName=IP:127.0.0.1","-keyout",key,"-out",cert],{stdio:"ignore"});
 await chmod(key,0o600);await chmod(cert,0o600);
 return {root,key,cert};
}
test("HTTPS shares the application's identity, nonce ledger and one startup",async()=>{
 const files=await certificate(),db=new HouseholdDatabase(":memory:");
 let starts=0;
 const application=createHouseholdServer({database:db,authenticator:new DeviceAuthenticator({database:db}),startup:async()=>{starts++;}});
 const secure=await createSecureListener(application,{certificate:files.cert,privateKey:files.key});
 await new Promise<void>(resolve=>application.listen(0,"127.0.0.1",resolve));
 await new Promise<void>(resolve=>secure.listen(0,"127.0.0.1",resolve));
 const plain="http://127.0.0.1:"+(application.address() as AddressInfo).port;
 const port=(secure.address() as AddressInfo).port,ca=await readFile(files.cert);
 const tls=(method:string,path:string,body?:unknown,headers:Record<string,string>={})=>new Promise<{status:number;body:any}>((resolve,reject)=>{
  const text=body===undefined?"":JSON.stringify(body);
  const request=httpsRequest({hostname:"127.0.0.1",port,method,path,ca,headers:{"content-type":"application/json",...headers}},response=>{
   const chunks:Buffer[]=[];response.on("data",part=>chunks.push(Buffer.from(part)));response.on("end",()=>resolve({status:response.statusCode!,body:JSON.parse(Buffer.concat(chunks).toString())}));
  });request.on("error",reject);request.end(text);
 });
 try{
  const keys=generateKeyPairSync("ec",{namedCurve:"prime256v1"}),invitation=db.createInvitation("belle");
  const claimed=await tls("POST","/v1/enrollment/claim",{code:invitation.code,deviceName:"HTTPS fixture",
   publicKeyDerBase64:keys.publicKey.export({type:"spki",format:"der"}).toString("base64")});
  assert.equal(claimed.status,201);
  const timestamp=String(Date.now()),nonce="nonce-"+randomUUID(),path="/v1/me";
  const signature=sign("sha256",Buffer.from(canonicalDeviceRequest({method:"GET",path,timestamp,nonce,body:Buffer.alloc(0)})),keys.privateKey).toString("base64");
  const headers={"x-hardy-device-id":claimed.body.deviceId,"x-hardy-timestamp":timestamp,"x-hardy-nonce":nonce,"x-hardy-signature":signature};
  const me=await tls("GET",path,undefined,headers);assert.equal(me.status,200);assert.equal(me.body.profile.id,"belle");
  assert.equal((await fetch(plain+path,{headers})).status,401,"a nonce used on TLS cannot be replayed on HTTP");
  assert.equal((await tls("GET","/ready")).body.ready,true);assert.equal(starts,1);
 }finally{
  await new Promise<void>(resolve=>secure.close(()=>resolve()));await application.shutdown();
  await rm(files.root,{recursive:true,force:true});
 }
});
test("HTTPS rejects linked and broadly readable private material",async()=>{
 const files=await certificate(),application=createHouseholdServer();
 try{
  await chmod(files.key,0o644);
  await assert.rejects(createSecureListener(application,{certificate:files.cert,privateKey:files.key}),/tls_configuration_unavailable/);
  await chmod(files.key,0o600);
  const linked=join(files.root,"linked.key");await symlink(files.key,linked);
  await assert.rejects(createSecureListener(application,{certificate:files.cert,privateKey:linked}),/tls_configuration_unavailable/);
 }finally{await application.shutdown().catch(()=>{});await rm(files.root,{recursive:true,force:true});}
});
