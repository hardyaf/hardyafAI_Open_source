import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {MemoryDomain} from "../src/domains/memory/index.ts";
import {WorkspaceMemorySources} from "../src/domains/memory/source-files.ts";
import type {NativeDomainContext,NativeRpcPort} from "../src/domains/native-contracts.ts";

function context():NativeDomainContext{return {profileId:"adult",agentId:"main",sessionKey:"session",conversationId:"conversation",audience:"private",allowedScopes:["personal"],authorizedAttendees:[],
  confirmedSourceIds:["user:actual-submission"],confirmedSourceText:{"user:actual-submission":"Please remember: Sam's position this season is goalkeeper. Fred is 100."},assertCurrent(){}};}
async function fixture(){
  const directory=await mkdtemp(path.join(tmpdir(),"memory-provenance-")),workspace=path.join(directory,"workspace");await mkdir(workspace);
  const sources=new WorkspaceMemorySources({main:workspace}),rpc:NativeRpcPort={async request(){return {ready:true};}};
  return {directory,sources,domain:new MemoryDomain({enabled:true},rpc,sources)};
}

test("current human provenance is bound automatically without a model-copied identifier",async()=>{
  const f=await fixture();try{
    const result=await f.domain.execute("household_memory_source_save",{operationId:"capture-auto-provenance",scope:"personal",title:"Sam",text:"Sam's position this season is goalkeeper.",certainty:"fact"},context()) as any;
    assert.equal(result.source.certainty,"confirmed");assert.equal("text" in result.source,false);
    const source=await f.sources.read("main","personal",result.source.id,context());
    assert.deepEqual(source.sourceIds,["user:actual-submission"]);
    assert.equal(source.text,"Sam's position this season is goalkeeper.");
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("a wrong model reference cannot override current authenticated quote attribution",async()=>{
  const f=await fixture();try{
    const result=await f.domain.execute("household_memory_source_save",{operationId:"capture-wrong-copied-id",scope:"personal",title:"Sam",text:"Sam's position this season is goalkeeper.",sourceIds:["user:invented"],certainty:"fact"},context()) as any;
    assert.equal(result.source.certainty,"confirmed");
    assert.deepEqual((await f.sources.read("main","personal",result.source.id,context())).sourceIds,["user:actual-submission"]);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("automatic attribution does not confirm paraphrases, invented values or number prefixes",async()=>{
  const f=await fixture();try{
    for(const [index,body] of ["Sam plays goalkeeper","Sam plays forward","Fred is 10"].entries()){
      const result=await f.domain.execute("household_memory_source_save",{operationId:"capture-candidate-"+index,scope:"personal",title:"Candidate",text:body,certainty:"fact"},context()) as any;
      assert.equal(result.source.certainty,"candidate");
    }
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("private source capture cannot borrow household scope without its current grant",async()=>{
  const f=await fixture();try{
    await assert.rejects(()=>f.domain.execute("household_memory_source_save",{operationId:"capture-forbidden-scope",scope:"household",title:"Sam",text:"Sam's position this season is goalkeeper.",certainty:"fact"},context()),{code:"scope_not_authorized"});
  }finally{await rm(f.directory,{recursive:true,force:true});}
});
