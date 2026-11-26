import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdtemp,mkdir,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {createOwnedDomainRuntime} from "../src/domain-runtime/owned-runtime.ts";

test("native owned runtime uses protected control environment consumer socket without process environment inheritance",async()=>{
  const root=await mkdtemp(path.join(tmpdir(),"hardy-owned-credentials-"));
  const socket=path.join(root,"consumer.sock"),workspace=path.join(root,"workspace");await mkdir(workspace);
  let calls=0;
  const consumer=createServer(async(request,response)=>{
    const chunks:Buffer[]=[];for await(const chunk of request)chunks.push(chunk);
    const input=JSON.parse(Buffer.concat(chunks).toString("utf8"));assert.equal(input.action,"list");calls++;
    response.writeHead(200,{"content-type":"application/json"});response.end(JSON.stringify({connections:[{id:"fixture-connected-account"}]}));
  });
  await new Promise<void>((resolve,reject)=>{consumer.once("error",reject);consumer.listen(socket,()=>resolve());});
  const environment=path.join(root,"control.env"),configuration=path.join(root,"domains.json");
  await writeFile(environment,["HARDY_HOME_DATABASE="+path.join(root,"household.sqlite"),"OPENCLAW_GATEWAY_URL=ws://127.0.0.1:9","OPENCLAW_GATEWAY_TOKEN=fixture-only","HARDY_CREDENTIALS_CONSUMER_SOCKET="+socket].join("\n")+"\n",{mode:0o600});
  const config={version:1,profiles:{},capture:{python:"/usr/bin/python3",script:"/fixture/capture.py",workspaces:{main:workspace}},
    google:{gogBinary:"/fixture/gog",account:"fixture@example.invalid",client:"fixture",calendarId:"fixture",timezone:"America/New_York"},
    memory:{workspaces:{main:workspace},sharedAgentId:"household-knowledge",wikiVaults:{main:path.join(root,"wiki")}},
    execution:{skillsRoot:"/fixture/skills",nativeConfigPath:"/fixture/openclaw.json",openclawBinary:"/fixture/openclaw",sandboxImage:"fixture-image",sandboxRoots:[root],nativeEntries:[],schedulingEnabled:false},
    documents:{python:"/usr/bin/python3",script:"/fixture/documents.py",cacheRoot:path.join(root,"documents")},
    uplift:{python:"/usr/bin/python3",moduleRoot:"/fixture/uplift",database:path.join(root,"uplift.sqlite"),vaultRoot:path.join(root,"uplift")}};
  await writeFile(configuration,JSON.stringify(config),{mode:0o600});
  const inherited=process.env.HARDY_CREDENTIALS_CONSUMER_SOCKET;delete process.env.HARDY_CREDENTIALS_CONSUMER_SOCKET;
  let owned:Awaited<ReturnType<typeof createOwnedDomainRuntime>>|undefined;
  try{
    owned=await createOwnedDomainRuntime({controlEnvironmentPath:environment,configurationPath:configuration});
    const result=await (owned.runtime as any).google.execute("household_email_connections",{},
      {profileId:"alex",agentId:"main",sessionKey:"fixture",conversationId:"fixture",audience:"private",allowedScopes:["personal"],authorizedAttendees:[],
       credentialAuthority:{agentId:"main",sessionKey:"fixture",sessionId:"fixture",runId:"fixture"},assertCurrent(){}});
    assert.deepEqual(result,{connections:[{id:"fixture-connected-account"}]});assert.equal(calls,1);
  }finally{
    if(inherited===undefined)delete process.env.HARDY_CREDENTIALS_CONSUMER_SOCKET;else process.env.HARDY_CREDENTIALS_CONSUMER_SOCKET=inherited;
    await owned?.close();consumer.closeAllConnections();await new Promise<void>(resolve=>consumer.close(()=>resolve()));await rm(root,{recursive:true,force:true});
  }
});
