// Consolidated Slice 3 campaign only; no domain scenarios at intermediate build checks.
import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {LocalManagedWikiPages,MemoryDomain,WorkspaceMemorySources} from "../src/domains/native-domains.ts";
import type {NativeDomainContext,NativeRpcPort} from "../src/domains/native-contracts.ts";

function context(overrides:Partial<NativeDomainContext>={}):NativeDomainContext{return {profileId:"adult",agentId:"main",sessionKey:"session",conversationId:"conversation",audience:"private",allowedScopes:["personal","household"],authorizedAttendees:[],confirmedSourceIds:["user:original"],confirmedSourceText:{"user:original":"Avery prefers apples."},assertCurrent(){},...overrides};}
async function fixture(){
  const directory=await mkdtemp(path.join(tmpdir(),"memory-lifecycle-")),workspace=path.join(directory,"workspace"),vault=path.join(directory,"wiki");
  await mkdir(workspace);await mkdir(path.join(vault,"syntheses"),{recursive:true});
  const sources=new WorkspaceMemorySources({main:workspace});
  const source=await sources.save("main","personal",{operationId:"capture-original-01",title:"Preference",text:"Avery prefers apples.",sourceIds:["user:original"],certainty:"fact"},context());
  await writeFile(path.join(vault,"syntheses","household-topic-food.md"),"---\nsourceIds: ["+source.id+"]\n---\nAvery prefers apples.\n");
  await writeFile(path.join(vault,"syntheses","independent.md"),"Unmanaged page remains.\n");
  return {directory,workspace,vault,sources,source,pages:new LocalManagedWikiPages({vaults:{main:vault}})};
}

test("forget requires trusted approval and never removes unmanaged wiki pages",async()=>{
  const f=await fixture();try{
    let indexed=0;const rpc:NativeRpcPort={async request(){return {compiled:true};}};
    const domain=new MemoryDomain({enabled:true},rpc,f.sources,f.pages,async()=>{indexed++;});
    const input={scope:"personal",sourceId:f.source.id,expectedFingerprint:f.source.fingerprint,operationId:"forget-original-01"};
    await assert.rejects(()=>domain.execute("household_memory_source_forget",input,context()),{code:"destructive_approval_required"});
    assert.equal((await f.sources.read("main","personal",f.source.id,context())).certainty,"confirmed");
    const result=await domain.execute("household_memory_source_forget",input,context({destructiveApproved:true})) as {state:string;removedTopicRefs:string[]};
    assert.equal(result.state,"committed");assert.equal(result.removedTopicRefs.length,1);assert.match(result.removedTopicRefs[0],/^topic-[a-f0-9]{64}$/);assert.equal(indexed,1);
    assert.equal(await readFile(path.join(f.vault,"syntheses","independent.md"),"utf8"),"Unmanaged page remains.\n");
    await assert.rejects(()=>f.sources.read("main","personal",f.source.id,context()),{code:"memory_source_retired"});
    const state=path.join(f.workspace,"memory","household-sources",".household-state");
    for(const name of await readdir(state))assert.equal((await readFile(path.join(state,name),"utf8")).includes("Avery prefers apples"),false);
    await assert.rejects(()=>f.sources.save("main","personal",{operationId:"capture-original-01",title:"Preference",text:"Avery prefers apples.",sourceIds:["user:original"],certainty:"fact"},context()),{code:"memory_source_retired"});
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("failed index refresh blocks stale recall and identical forget resumes after restart",async()=>{
  const f=await fixture();try{
    const rpc:NativeRpcPort={async request(method){return method==="wiki.search"?[]:{compiled:true};}};
    const first=new MemoryDomain({enabled:true},rpc,f.sources,f.pages,async()=>{throw Error("offline");});
    const input={scope:"personal",sourceId:f.source.id,expectedFingerprint:f.source.fingerprint,operationId:"forget-restart-01"};
    await assert.rejects(()=>first.execute("household_memory_source_forget",input,context({destructiveApproved:true})),{code:"memory_projection_refresh_required"});
    await assert.rejects(()=>first.execute("household_memory_search",{scope:"personal",query:"Avery"},context()),{code:"memory_projection_refresh_required"});
    const reopened=new WorkspaceMemorySources({main:f.workspace});let indexed=0;
    const restarted=new MemoryDomain({enabled:true},rpc,reopened,f.pages,async()=>{indexed++;});
    const result=await restarted.execute("household_memory_source_forget",input,context({destructiveApproved:true})) as {state:string;removedTopicRefs:string[]};
    assert.equal(result.state,"committed");assert.equal(indexed,1);assert.equal(result.removedTopicRefs.length,1);
    await restarted.execute("household_memory_search",{scope:"personal",query:"Avery"},context());
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("correction requires a later verified human source and forget removes superseded history",async()=>{
  const f=await fixture();try{
    const rpc:NativeRpcPort={async request(){return {};}};
    const domain=new MemoryDomain({enabled:true},rpc,f.sources,f.pages,async()=>{});
    const input={scope:"personal",sourceId:f.source.id,expectedFingerprint:f.source.fingerprint,operationId:"correct-source-01",title:"Preference",text:"Avery prefers apples.",sourceIds:["user:original"],certainty:"fact"};
    await assert.rejects(()=>domain.execute("household_memory_source_supersede",input,context()),{code:"memory_correction_requires_later_user_source"});
    assert.equal((await readdir(path.join(f.workspace,"memory","household-sources"))).filter(name=>name.endsWith(".md")).length,1);
    const reply=context({confirmedSourceIds:["user:reply"],confirmedSourceText:{"user:reply":"Avery now prefers pears."}});
    const result=await domain.execute("household_memory_source_supersede",{...input,text:"Avery now prefers pears.",sourceIds:["user:reply"]},reply) as {replacementSourceId:string;historyRetained:boolean};
    assert.equal(result.historyRetained,true);assert.equal((await f.sources.read("main","personal",result.replacementSourceId,reply)).text,"Avery now prefers pears.");
    const history=path.join(f.workspace,"memory","household-sources",".household-state",f.source.id+".history.json");
    assert.ok((await readFile(history,"utf8")).includes("Avery prefers apples."));
    await domain.execute("household_memory_source_forget",{scope:"personal",sourceId:f.source.id,expectedFingerprint:f.source.fingerprint,operationId:"forget-old-history-01"},context({destructiveApproved:true}));
    await assert.rejects(()=>readFile(history),{code:"ENOENT"});
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("managed recall filters out unmanaged wiki pages and rejects broad get lookups",async()=>{
  const f=await fixture();try{
    let gets=0;const rpc:NativeRpcPort={async request(method){if(method==="wiki.get")gets++;return [{path:"syntheses/household-topic-food.md",snippet:"saved"},{path:"reports/daily.md",snippet:"outside managed scope"},{path:"memory/transcript.md",corpus:"memory",snippet:"retained chat"}];}};
    const domain=new MemoryDomain({enabled:true},rpc,f.sources,f.pages,async()=>{});
    const result=await domain.execute("household_memory_search",{scope:"personal",query:"food"},context()) as {result:unknown[]};
    assert.equal(result.result.length,1);
    await assert.rejects(()=>domain.execute("household_memory_get",{scope:"personal",lookup:"reports/daily.md"},context()),{code:"managed_topic_required"});assert.equal(gets,0);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});
