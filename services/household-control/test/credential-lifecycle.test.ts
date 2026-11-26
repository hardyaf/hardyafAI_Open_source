import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp,writeFile,rm,mkdir,symlink,chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BitwardenCredentialConnector } from "../../../tools/bitwarden-credential-connector.mjs";

const id="00000000-0000-4000-8000-000000000001";
async function fixture(t:any){
  const dir=await mkdtemp(path.join(os.tmpdir(),"credential-lifecycle-"));t.after(()=>rm(dir,{recursive:true,force:true}));
  const binary=path.join(dir,"bws"),config=path.join(dir,"automation.toml"),python=path.join(dir,"python"),script=path.join(dir,"bridge.py");
  for(const file of [binary,python,script])await writeFile(file,"fixture never executed",{mode:0o700});
  await writeFile(config,'[profiles.hardy_home]\nstate_opt_out = "true"\n',{mode:0o600});
  const environment={BWS_BIN:binary,BWS_CONFIG_FILE:config,BWS_ACCESS_TOKEN:"fixture-bootstrap",BWS_ALLOWED_SECRET_IDS:id,
    BWS_ALLOWED_WRITE_SECRET_IDS:id,BWS_SDK_PYTHON:python,BWS_SDK_SCRIPT:script,BWS_SDK_API_URL:"https://api.example.invalid",BWS_SDK_IDENTITY_URL:"https://identity.example.invalid",HOME:"must-not-inherit"};
  const binding={id:"mail",secretId:id,profileIds:["alex"],uses:["provider_refresh","browser_login"] as Array<"provider_refresh"|"browser_login">,origins:["https://mail.example.invalid"]};
  const context={profileId:"alex",taskId:"task-1",sourcePromptId:"prompt-1",assertCurrent(){}};
  return {environment,binding,context};
}
test("credential refresh reports success only after exact authoritative writeback without secret argv or receipts",async(t)=>{
  const f=await fixture(t);let writes=0;
  const connector=new BitwardenCredentialConnector({bindings:[f.binding],environment:f.environment,
    invoke:()=>({status:0,stdout:JSON.stringify({id,value:"old-fixture-token"})}),
    sdkInvoke:(_binary:string,args:string[],options:any)=>{
      if(args.includes("--check")){assert.equal(options.env.BWS_ACCESS_TOKEN,undefined);assert.equal(options.input,undefined);return {status:0,stdout:JSON.stringify({status:"ready",sdkVersion:"2.1.0"})};}
      writes++;assert.equal(args.includes("replacement-fixture-token"),false);assert.equal(options.env.HOME,undefined);
      assert.equal(options.env.BWS_SERVER_URL,undefined);assert.equal(Object.values(options.env).includes("replacement-fixture-token"),false);
      assert.deepEqual(JSON.parse(options.input),{protocolVersion:1,id,expectedValue:"old-fixture-token",value:"replacement-fixture-token"});
      return {status:0,stdout:JSON.stringify({id,status:"committed",revision:"2026-11-04T12:00:00Z"})};
    }});
  const result=await connector.refreshProvider("mail",f.context,async old=>{assert.equal(old,"old-fixture-token");return {status:"replaced",value:"replacement-fixture-token"};});
  assert.equal(result.authoritativeWriteback,true);assert.equal(writes,1);
  assert.equal(JSON.stringify(result).includes("fixture-token"),false);
});
test("unknown writeback cannot become successful rotation and wrong identities never read",async(t)=>{
  const f=await fixture(t);let reads=0;
  const connector=new BitwardenCredentialConnector({bindings:[f.binding],environment:f.environment,
    invoke:()=>{reads++;return {status:0,stdout:JSON.stringify({id,value:"old"})};},
    sdkInvoke:(_binary:string,args:string[])=>({status:0,stdout:JSON.stringify(args.includes("--check")?{status:"ready",sdkVersion:"2.1.0"}:{status:"unknown",error:"must-not-escape"})})});
  await assert.rejects(()=>connector.refreshProvider("mail",{...f.context,profileId:"natasha"},async()=>({status:"unchanged"})),/CREDENTIAL_USE_NOT_AUTHORIZED/);
  assert.equal(reads,0);
  await assert.rejects(()=>connector.refreshProvider("mail",f.context,async()=>({status:"replaced",value:"new"})),(error:any)=>error.code==="CREDENTIAL_WRITEBACK_UNKNOWN"&&error.outcome==="unknown");
});
test("browser delegation is exact-origin and task bound; credentials stay in the trusted consumer",async(t)=>{
  const f=await fixture(t);let consumed=0;
  const connector=new BitwardenCredentialConnector({bindings:[f.binding],environment:f.environment,invoke:()=>({status:0,stdout:JSON.stringify({id,value:JSON.stringify({username:"fixture-user",password:"fixture-password"})})})});
  const consume=async(credentials:any,delegation:any)=>{consumed++;assert.equal(credentials.password,"fixture-password");assert.equal(delegation.taskId,"task-1");return {status:"human_required" as const,unexpectedSecret:"must-not-escape"};};
  await assert.rejects(()=>connector.useBrowserLogin("mail",f.context,{origin:"https://evil.example.invalid"},consume),/CREDENTIAL_BROWSER_DELEGATION_DENIED/);
  assert.equal(consumed,0);
  const result=await connector.useBrowserLogin("mail",f.context,{origin:"https://mail.example.invalid"},consume);
  assert.deepEqual(result,{bindingId:"mail",status:"human_required"});
  assert.equal(consumed,1);
});

test("trusted virtualenv interpreter alias preserves its invocation path and rejects writable targets",async(t)=>{
  const f=await fixture(t),directory=path.dirname(f.environment.BWS_SDK_PYTHON),target=path.join(directory,"system-python"),bin=path.join(directory,"venv","bin");
  await writeFile(target,"fixture interpreter is not executed",{mode:0o700});await mkdir(bin,{recursive:true,mode:0o700});
  const executable=path.join(bin,"python");await symlink(target,executable);f.environment.BWS_SDK_PYTHON=executable;
  let calls=0,refreshes=0;
  const connector=new BitwardenCredentialConnector({bindings:[f.binding],environment:f.environment,
    invoke:()=>({status:0,stdout:JSON.stringify({id,value:"previous-fixture-token"})}),
    sdkInvoke:(binary:string,args:string[])=>{assert.equal(binary,executable);assert.notEqual(binary,target);if(args.includes("--check"))return {status:0,stdout:JSON.stringify({status:"ready",sdkVersion:"2.1.0"})};calls++;return {status:0,stdout:JSON.stringify({id,status:"committed",revision:"2026-11-04T12:00:00Z"})};}});
  const refresh=async()=>{refreshes++;return {status:"replaced" as const,value:"replacement-fixture-token"};};
  await connector.refreshProvider("mail",f.context,refresh);assert.equal(calls,1);
  await chmod(target,0o722);
  await assert.rejects(()=>connector.refreshProvider("mail",f.context,refresh),(error:any)=>{
    assert.equal(error.code,"CREDENTIAL_WRITE_PROVIDER_UNAVAILABLE");assert.equal(error.message.includes("fixture-token"),false);assert.equal(error.message.includes(executable),false);return true;
  });
  assert.equal(calls,1);assert.equal(refreshes,1);
  await chmod(target,0o700);await chmod(bin,0o777);
  await assert.rejects(()=>connector.refreshProvider("mail",f.context,refresh),/CREDENTIAL_WRITE_PROVIDER_UNAVAILABLE/);
  assert.equal(calls,1);assert.equal(refreshes,1);
});

test("unavailable write authority/configuration or SDK prevents both secret resolution and provider refresh",async(t)=>{
  const f=await fixture(t);
  for(const changes of [{BWS_ALLOWED_WRITE_SECRET_IDS:""},{BWS_SDK_API_URL:"http://invalid.example.invalid"},{BWS_SDK_PYTHON:""},{}]){
    let reads=0,refreshes=0;
    const connector=new BitwardenCredentialConnector({bindings:[f.binding],environment:{...f.environment,...changes},
      invoke:()=>{reads++;return {status:0,stdout:JSON.stringify({id,value:"previous-fixture-token"})};},
      sdkInvoke:()=>({status:0,stdout:JSON.stringify({status:"provider_unavailable",error:"private-probe-details"})})});
    await assert.rejects(()=>connector.refreshProvider("mail",f.context,async()=>{refreshes++;return {status:"replaced",value:"replacement-fixture-token"};}),(error:any)=>{
      assert.equal(error.outcome,"not_sent");assert.equal(error.message.includes("private"),false);return true;
    });
    assert.equal(reads,0);assert.equal(refreshes,0);
  }
});

test("grant loss after a potentially rotating refresh is unknown and never leaks callback errors",async(t)=>{
  const f=await fixture(t);let current=true,writes=0;
  const connector=new BitwardenCredentialConnector({bindings:[f.binding],environment:f.environment,
    invoke:()=>({status:0,stdout:JSON.stringify({id,value:"previous-fixture-token"})}),
    sdkInvoke:(_binary:string,args:string[])=>{if(args.includes("--check"))return {status:0,stdout:JSON.stringify({status:"ready",sdkVersion:"2.1.0"})};writes++;return {status:0,stdout:"{}"};}});
  const context={...f.context,assertCurrent(){if(!current)throw Error("private callback token must never escape");}};
  await assert.rejects(()=>connector.refreshProvider("mail",context,async()=>{current=false;return {status:"replaced",value:"replacement-fixture-token"};}),(error:any)=>{
    assert.equal(error.code,"CREDENTIAL_REFRESH_OUTCOME_UNKNOWN");assert.equal(error.outcome,"unknown");assert.equal(error.message.includes("private"),false);return true;
  });
  assert.equal(writes,0);
});
