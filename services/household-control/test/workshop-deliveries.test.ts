import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ArtifactStore } from "../src/platform/artifacts.ts";
import { workshopFileLinks,selectWorkshopContainer } from "../src/domain-runtime/workshop-deliveries.ts";
import { buildWorkshopProfile } from "../src/platform/workshop-profile.ts";
import { verifyTaskArtifact } from "../src/task-flow/evidence.ts";
test("final file links are optional and do not require output folders, prefixes or publisher calls",()=>{
  assert.deepEqual(workshopFileLinks({content:[{type:"text",text:"[report](workshop:/workspace/project/report.md) [script](/workspace/library/tool.py) [same](sandbox:/workspace/project/report.md) [public](https://example.com)"}]}),["/workspace/project/report.md","/workspace/library/tool.py"]);
  assert.deepEqual(workshopFileLinks({content:[{type:"thinking",thinking:"[hidden](/workspace/hidden.txt)"}]}),[]);
});
test("a linked path supplies container bytes, never a host path or unrelated container",()=>{
  const config={ownerProfileId:"alex",image:"sha256:fixture",dataRoot:"/data/lab",sandboxRoot:"/data/lab/sandboxes"};
  const Mounts=buildWorkshopProfile(config).sandbox.docker.binds.map(bind=>{const [Source,Destination,mode]=bind.split(":");return{Type:"bind",Source,Destination,RW:mode==="rw"};});
  Mounts.push({Type:"bind",Source:config.sandboxRoot+"/workspace-fixture",Destination:"/workspace",RW:true});
  const row={Id:"a".repeat(64),Image:config.image,State:{Running:true},Config:{Labels:{"openclaw.sandbox":"1","openclaw.sessionKey":"agent:main:workspace:fixture"}},Mounts};
  assert.equal(selectWorkshopContainer([row],config),row.Id);
  for(const mutate of [(r:any)=>r.Image="other",(r:any)=>r.Config.Labels["openclaw.sessionKey"]="agent:other:fixture",(r:any)=>r.Mounts.push({Type:"bind",Source:"/etc",Destination:"/secrets",RW:false})]){
    const bad=structuredClone(row);mutate(bad);assert.throws(()=>selectWorkshopContainer([bad],config));
  }
});
test("generated files exceed the model input buffer limit and download with actual integrity and owner scope",async()=>{
  const root=await mkdtemp(path.join(tmpdir(),"workshop-artifacts-"));
  try{
    const store=new ArtifactStore({root,maxBytes:1024}),owner={profileId:"alex",canReadHousehold:true};await store.initialize();
    const bytes=Buffer.alloc(32*1024*1024,45),scope={ownerProfileId:"alex",conversationId:"conversation-a",taskId:"conversation:conversation-a",audience:"private" as const};
    const meta=await store.importOutput(scope,owner,{filename:"large.bin",mimeType:"application/octet-stream",idempotencyKey:"native-file-a"},destination=>writeFile(destination,bytes),()=>{});
    assert.equal(meta.byteLength,bytes.length);await assert.rejects(()=>store.get(meta.id,{profileId:"another",canReadHousehold:true}));
    const download=await store.openDownload(meta.id,owner),digest=createHash("sha256");let count=0;for await(const chunk of download.stream){count+=chunk.length;digest.update(chunk);}
    assert.equal(count,bytes.length);assert.equal(digest.digest("hex"),meta.sha256);
    const proof=await verifyTaskArtifact({scope,principal:owner,assertCurrent(){}} as any,meta.id,store);
    assert.equal(proof.verified,true);assert.equal(proof.digest,meta.sha256);
    await assert.rejects(()=>store.importOutput(scope,owner,{filename:"link.txt",mimeType:"text/plain",idempotencyKey:"native-link-a"},destination=>symlink(path.join(root,"objects",meta.id,"content"),destination),()=>{}));
  }finally{await rm(root,{recursive:true,force:true});}
});
