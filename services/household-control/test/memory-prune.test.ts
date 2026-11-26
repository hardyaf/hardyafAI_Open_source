import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,readFile,readdir,writeFile,rm} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import {stringify as stringifyYaml} from "yaml";
import {MemoryDomain} from "../src/domains/memory/index.ts";
import {WorkspaceMemorySources} from "../src/domains/memory/source-files.ts";
import {LocalManagedWikiPages} from "../src/domains/memory/managed-pages.ts";
import {pruneManagedEntry} from "../src/domains/memory/entry-pruning.ts";
import type {NativeDomainContext,NativeRpcPort} from "../src/domains/native-contracts.ts";

const start="<!-- openclaw:wiki:generated:start -->",end="<!-- openclaw:wiki:generated:end -->";
// Shape emitted by the installed native 2026.9.8 Related renderer, observed on
// synthetic topic/journal pages after create_synthesis and compiler refresh.
const related="## Related\n<!-- openclaw:wiki:related:start -->\n### Related Pages\n\n- [Household topic Daily journal](household-topic-daily-journal.md)\n<!-- openclaw:wiki:related:end -->\n";
function context(body:string,id:string,approved=false):NativeDomainContext{return {profileId:"adult",agentId:"main",sessionKey:"session",conversationId:"conversation",audience:"private",allowedScopes:["personal"],authorizedAttendees:[],confirmedSourceIds:[id],confirmedSourceText:{[id]:body},destructiveApproved:approved,assertCurrent(){}};}
async function fixture(){
  const directory=await mkdtemp(path.join(tmpdir(),"memory-prune-")),workspace=path.join(directory,"workspace"),vault=path.join(directory,"wiki");
  await mkdir(workspace);await mkdir(path.join(vault,"syntheses"),{recursive:true});
  const sources=new WorkspaceMemorySources({main:workspace}),pages=new LocalManagedWikiPages({vaults:{main:vault}}),counts={compile:0,index:0};
  const rpc:NativeRpcPort={async request(method,mutation){
    if(method==="wiki.compile"){counts.compile++;return {compiled:true};}
    assert.equal(method,"wiki.apply");
    const slug=String(mutation.title).toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu,"-").replace(/^-|-$/g,"");
    const lookup="syntheses/"+slug+".md",prior=await pages.readManaged("main",lookup,context("fixture","user:fixture"));
    const prefix=prior?.body??"# "+String(mutation.title)+"\n\n## Notes\n<!-- openclaw:human:start -->\n<!-- openclaw:human:end -->\n";
    let body=prefix.includes(start)?prefix.slice(0,prefix.indexOf(start))+start+"\n"+String(mutation.body)+"\n"+prefix.slice(prefix.indexOf(end)):
      prefix+"\n## Summary\n"+start+"\n"+String(mutation.body)+"\n"+end+"\n";
    if(!body.includes("<!-- openclaw:wiki:related:start -->"))body+="\n"+related;
    await writeFile(path.join(vault,lookup),"---\n"+stringifyYaml({...prior?.metadata,pageType:"synthesis",id:"synthesis."+slug,title:mutation.title,sourceIds:mutation.sourceIds,claims:mutation.claims,questions:mutation.questions,contradictions:mutation.contradictions,status:mutation.status})+"---\n\n"+body);
    return {changed:true,pagePath:lookup};
  }};
  const domain=new MemoryDomain({enabled:true,timeZone:"America/New_York"},rpc,sources,pages,async()=>{counts.index++;return {indexed:true};});
  async function remember(person:string,fact:string,id:string,certainty="fact"){
    return domain.execute("household_memory_remember",{operationId:"remember-"+id,scope:"personal",topic:person,sourceQuote:fact,claims:[{text:fact,certainty}]},context(fact,"user:"+id)) as Promise<any>;
  }
  return {directory,workspace,vault,sources,pages,domain,counts,remember,rpc};
}

for(const kind of ["forget","supersede"] as const)test(kind+" of one source preserves another remembered source in the same daily journal",async()=>{
  const f=await fixture();try{
    const target=await f.remember("Spruce Fixture","Spruce Fixture likes apricots.","target");
    const sentinelText="Birch Sentinel likes model trains.",certainty=kind==="supersede"?"inference":"fact";
    const sentinel=await f.remember("Birch Sentinel",sentinelText,"sentinel",certainty);
    const original=await f.sources.read("main","personal",target.sourceId,context("fixture","user:fixture"));
    const before=await f.pages.readManaged("main",target.journal.lookup,context("fixture","user:fixture"));assert.match(before!.body,/Birch Sentinel/);
    const journalPath=path.join(f.vault,target.journal.lookup),beforeRaw=await readFile(journalPath,"utf8");await writeFile(journalPath,beforeRaw.replace("---\n","---\nhouseholdCustom: keep\n"));
    const body=kind==="forget"?"Forget Spruce Fixture.":"Spruce Fixture now likes peaches.",ctx=context(body,"user:later",true);
    const result=await f.domain.execute("household_memory_source_"+kind,{operationId:"change-target-"+kind,scope:"personal",sourceId:target.sourceId,expectedFingerprint:original.fingerprint,
      ...(kind==="supersede"?{title:"Spruce Fixture",text:body,certainty:"fact"}:{})},ctx) as any;
    assert.equal(result.state,"committed");assert.equal(f.counts.compile,1);assert.equal(f.counts.index,1);
    assert.equal(result.prunedTopicCount,1);assert.equal(result.removedTopicCount,1);assert.equal(result.rebuildRequiredTopicCount,0);
    const journal=await f.pages.readManaged("main",target.journal.lookup,ctx);
    assert.ok(journal,"unrelated same-day journal disappeared");assert.match(journal!.body,/Birch Sentinel likes model trains/);assert.doesNotMatch(journal!.body,/apricots/);
    assert.deepEqual(journal!.metadata.sourceIds,[sentinel.sourceId]);
    assert.equal(journal!.metadata.householdCustom,"keep");
    const claims=journal!.metadata.claims as any[];assert.equal(claims.length,1);assert.equal(claims[0].status,certainty==="fact"?"supported":"candidate");
    assert.equal((await f.sources.read("main","personal",sentinel.sourceId,ctx)).text,sentinelText);
    await assert.rejects(()=>f.sources.read("main","personal",target.sourceId,ctx),{code:"memory_source_retired"});
    if(kind==="supersede"){
      assert.match(await readFile(path.join(f.workspace,"memory/household-sources/.household-state",target.sourceId+".history.json"),"utf8"),/apricots/);
      const activeBefore=(await readdir(path.join(f.workspace,"memory/household-sources"))).filter(name=>name.endsWith(".md")).sort();
      const replacement=await f.domain.execute("household_memory_remember",{operationId:"curate-replacement",scope:"personal",sourceId:result.replacementSourceId,topic:"Spruce Fixture",sourceQuote:body,claims:[{text:body,certainty:"fact"}]},ctx) as any;
      assert.equal(replacement.sourceId,result.replacementSourceId);assert.equal(replacement.sourceReused,true);
      assert.deepEqual((await readdir(path.join(f.workspace,"memory/household-sources"))).filter(name=>name.endsWith(".md")).sort(),activeBefore,"Curation must not capture a second replacement source");
      const rebuilt=await f.pages.readManaged("main",replacement.journal.lookup,ctx);assert.match(rebuilt!.body,/Birch Sentinel/);assert.match(rebuilt!.body,/peaches/);
    }
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("native Related projection is mechanical while arbitrary prose and malformed markers remain opaque",()=>{
  const id="source-"+"a".repeat(64),source="Source: `"+id+"`";
  const raw="---\n"+stringifyYaml({pageType:"synthesis",title:"Household topic Fred Fixture",sourceIds:[id],claims:[{id:"claim.fixture",text:"Fred likes blue.",status:"supported",evidence:[{sourceId:id}]}],questions:[],contradictions:[],status:"supported"})+
    "---\n\n# Household topic Fred Fixture\n\n## Notes\n<!-- openclaw:human:start -->\n<!-- openclaw:human:end -->\n\n## Summary\n"+start+"\n<!-- household-memory-entry:"+id+" -->\n\n### 2026-11-04 · Fred Fixture\n\n- Fred likes blue.\n\n"+source+"\n\n<!-- household-memory-entry-end:"+id+" -->\n"+end+"\n\n"+related;
  assert.deepEqual(pruneManagedEntry(raw,id),{action:"remove",rebuildRequired:false});
  assert.deepEqual(pruneManagedEntry(raw.replace(related,"## Related\n<!-- openclaw:wiki:related:start -->\n- No related pages yet.\n<!-- openclaw:wiki:related:end -->\n"),id),{action:"remove",rebuildRequired:false});
  for(const changed of [
    raw.replace("### Related Pages","A human's unattributed note.\n### Related Pages"),
    raw.replace("<!-- openclaw:wiki:related:end -->","<!-- openclaw:wiki:related:end -->\nA human's later note."),
    raw+"\n"+related,
    raw.replace("<!-- openclaw:wiki:related:end -->","<!-- malformed-related-end -->"),
  ])assert.deepEqual(pruneManagedEntry(changed,id),{action:"remove",rebuildRequired:true});
  const withoutRelated=raw.replace("\n"+related,"");
  for(const changed of [
    withoutRelated.replace("<!-- openclaw:human:start -->","<!-- openclaw:human:start -->\n"+related),
    withoutRelated+"\n## Notes\n<!-- openclaw:human:start -->\n"+related+"<!-- openclaw:human:end -->\n",
  ])assert.deepEqual(pruneManagedEntry(changed,id),{action:"remove",rebuildRequired:true},"A Related-shaped human note is not compiler-owned content");
});

test("a retired-source native Related link is dropped before compile without losing another attributed entry",()=>{
  const retired="source-"+"a".repeat(64),sentinel="source-"+"b".repeat(64);
  const entry=(id:string,fact:string)=>"<!-- household-memory-entry:"+id+" -->\n\n### 2026-11-04 · Fixture\n\n- "+fact+"\n\nSource: `"+id+"`\n\n<!-- household-memory-entry-end:"+id+" -->";
  const metadata={pageType:"synthesis",title:"Household topic Daily journal",sourceIds:[retired,sentinel],claims:[
    {id:"claim.old",text:"Old preference",status:"supported",evidence:[{sourceId:retired}]},
    {id:"claim.keep",text:"Sentinel fact",status:"supported",evidence:[{sourceId:sentinel}]},
  ],questions:[],contradictions:[],status:"supported"};
  const oldRelated="## Related\n<!-- openclaw:wiki:related:start -->\n### Sources\n\n- [Captured source](../sources/"+retired+".md)\n<!-- openclaw:wiki:related:end -->\n";
  const raw="---\n"+stringifyYaml(metadata)+"---\n\n# Household topic Daily journal\n\n## Notes\n<!-- openclaw:human:start -->\n<!-- openclaw:human:end -->\n\n## Summary\n"+start+"\n"+entry(retired,"Old preference")+"\n\n"+entry(sentinel,"Sentinel fact")+"\n"+end+"\n\n"+oldRelated;
  const result=pruneManagedEntry(raw,retired);assert.equal(result.action,"prune");
  if(result.action!=="prune")throw Error("Expected attributed prune");
  assert.match(result.content,/Sentinel fact/);assert.ok(result.content.includes(sentinel));assert.equal(result.content.includes(retired),false);
  assert.equal(result.content.includes("<!-- openclaw:wiki:related:start -->"),false,"Only the stale mechanical projection is removed for native regeneration");
  const human=raw.replace("\n"+oldRelated,"\n## Notes\n<!-- openclaw:human:start -->\n"+oldRelated+"<!-- openclaw:human:end -->\n");
  assert.deepEqual(pruneManagedEntry(human,retired),{action:"remove",rebuildRequired:true});
});

test("opaque human notes are invalidated with durable rebuild disclosure, never falsely called preserved",async()=>{
  const f=await fixture();try{
    const target=await f.remember("Spruce Fixture","Spruce Fixture likes apricots.","opaque-target");
    await f.remember("Birch Sentinel","Birch Sentinel likes model trains.","opaque-sentinel");
    const journalPath=path.join(f.vault,target.journal.lookup),raw=await readFile(journalPath,"utf8");
    await writeFile(journalPath,raw.replace("<!-- openclaw:human:start -->","<!-- openclaw:human:start -->\nA human note without source attribution."));
    const ctx=context("Forget Spruce Fixture.","user:forget-opaque",true),source=await f.sources.read("main","personal",target.sourceId,ctx);
    const input={operationId:"forget-opaque-source",scope:"personal",sourceId:target.sourceId,expectedFingerprint:source.fingerprint};
    const result=await f.domain.execute("household_memory_source_forget",input,ctx) as any;
    assert.equal(await f.pages.readManaged("main",target.journal.lookup,ctx),null);
    assert.equal(result.rebuildRequiredTopicCount,1);assert.equal(result.topicRebuild,"required_for_opaque_invalidated_pages");
    assert.equal(result.unrelatedContentPreservation,"source_attributed_entries_only");assert.ok(result.rebuildRequiredTopicRefs.every((ref:string)=>/^topic-[a-f0-9]{64}$/.test(ref)));
    const restarted=new MemoryDomain({enabled:true,timeZone:"America/New_York"},f.rpc,f.sources,f.pages,async()=>{f.counts.index++;});
    const replay=await restarted.execute("household_memory_source_forget",input,ctx) as any;
    assert.deepEqual(replay.rebuildRequiredTopicRefs,result.rebuildRequiredTopicRefs);assert.equal(f.counts.index,1);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("a changed preimage aborts pruning without overwriting the newer page",async()=>{
  const f=await fixture();try{
    const target=await f.remember("Spruce Fixture","Spruce Fixture likes apricots.","race-target");
    await f.remember("Birch Sentinel","Birch Sentinel likes model trains.","race-sentinel");
    const journalPath=path.join(f.vault,target.journal.lookup),newer=(await readFile(journalPath,"utf8"))+"\nOperator's newer note.\n";
    assert.ok(f.pages.pruneReferencing);
    await assert.rejects(()=>f.pages.pruneReferencing!("main",target.sourceId,context("fixture","user:fixture"),async()=>{await writeFile(journalPath,newer);}),{code:"memory_revision_conflict"});
    assert.equal(await readFile(journalPath,"utf8"),newer);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});
