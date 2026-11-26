import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,readFile,readdir,stat,writeFile,rm} from "node:fs/promises";
import {createHash} from "node:crypto";
import path from "node:path";
import {tmpdir} from "node:os";
import {parse as parseYaml,stringify as stringifyYaml} from "yaml";
import {MemoryDomain} from "../src/domains/memory/index.ts";
import {WorkspaceMemorySources} from "../src/domains/memory/source-files.ts";
import {LocalManagedWikiPages} from "../src/domains/memory/managed-pages.ts";
import type {NativeDomainContext,NativeJson,NativeRpcPort} from "../src/domains/native-contracts.ts";

const start="<!-- openclaw:wiki:generated:start -->",end="<!-- openclaw:wiki:generated:end -->";
function context(message="Sam's position this season is goalkeeper.",id="user:current"):NativeDomainContext{return {profileId:"adult",agentId:"main",sessionKey:"session",conversationId:"conversation",audience:"private",allowedScopes:["personal"],authorizedAttendees:[],confirmedSourceIds:[id],confirmedSourceText:{[id]:message},assertCurrent(){}};}
async function fixture(humanNotes=true){
  const directory=await mkdtemp(path.join(tmpdir(),"memory-remember-")),workspace=path.join(directory,"workspace"),vault=path.join(directory,"wiki");
  await mkdir(workspace);await mkdir(path.join(vault,"syntheses"),{recursive:true});
  const sharedWorkspace=path.join(directory,"household-workspace"),sharedVault=path.join(directory,"household-wiki");
  await mkdir(sharedWorkspace);await mkdir(path.join(sharedVault,"syntheses"),{recursive:true});
  const vaults:Record<string,string>={main:vault,"household-knowledge":sharedVault};
  const sources=new WorkspaceMemorySources({main:workspace,"household-knowledge":sharedWorkspace}),pages=new LocalManagedWikiPages({vaults}),mutations:NativeJson[]=[],rpcCalls:string[]=[];
  let indexed=0;
  const rpc:NativeRpcPort={async request(method,mutation,ctx){
    rpcCalls.push(method);const agentId=String(mutation.agentId);assert.ok(vaults[agentId]);
    if(method==="wiki.get"){const page=await pages.readManaged(agentId,String(mutation.lookup),ctx);return page?{content:page.body,path:String(mutation.lookup),updatedAt:page.fingerprint}:null;}
    if(method==="wiki.compile")return {compiled:true};
    if(method==="wiki.status")return {ready:true};
    assert.equal(method,"wiki.apply");mutations.push(structuredClone(mutation));
    const slug=String(mutation.title).toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu,"-").replace(/^-|-$/g,"");
    const lookup="syntheses/"+slug+".md",prior=await pages.readManaged(agentId,lookup,ctx);
    const prefix=prior?.body??"# "+String(mutation.title)+"\n\n"+(humanNotes?"Human notes remain here.\n":"");
    const body=prefix.includes(start)?prefix.slice(0,prefix.indexOf(start))+start+"\n"+String(mutation.body)+"\n"+prefix.slice(prefix.indexOf(end)):
      prefix+"\n## Summary\n"+start+"\n"+String(mutation.body)+"\n"+end+"\n";
    await writeFile(path.join(vaults[agentId],lookup),"---\n"+stringifyYaml({...prior?.metadata,pageType:"synthesis",id:"synthesis."+slug,title:mutation.title,sourceIds:mutation.sourceIds,claims:mutation.claims,questions:mutation.questions,contradictions:mutation.contradictions,status:mutation.status})+"---\n\n"+body);
    return {changed:true,pagePath:lookup,compile:{largeNativeResult:"x".repeat(30_000)}};
  }};
  const domain=new MemoryDomain({enabled:true,timeZone:"America/New_York",sharedAgentId:"household-knowledge"},rpc,sources,pages,async()=>{indexed++;});
  const input={operationId:"remember-sam-position",scope:"personal",topic:"Sam",sourceQuote:"Sam's position this season is goalkeeper.",claims:[{text:"Sam plays goalkeeper",evidenceQuote:"Sam's position this season is goalkeeper.",certainty:"fact"}]};
  return {directory,workspace,vault,sharedWorkspace,sharedVault,sources,pages,mutations,rpc,rpcCalls,domain,input,indexed:()=>indexed};
}

test("remember preserves prior topic/journal content, unknown metadata, source references and candidate status",async()=>{
  const f=await fixture();try{
    const old=await f.sources.save("main","personal",{operationId:"remember-old-source",title:"Sam",text:"Sam likes blue.",certainty:"fact",sourceIds:["user:previous"]},context("Sam likes blue.","user:previous"));
    const date=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
    const lookups=["syntheses/household-topic-sam.md","syntheses/household-topic-daily-journal-"+date+".md"];
    for(const lookup of lookups)await writeFile(path.join(f.vault,lookup),"---\n"+stringifyYaml({pageType:"synthesis",id:"synthesis.old",title:"Prior title",customFlag:"preserved",sourceIds:[old.id],claims:[{id:"claim.old",text:"Sam might prefer blue",status:"candidate",evidence:[{sourceId:old.id}]}],questions:["Ask Sam"],status:"review"})+"---\n\n# Prior heading\nHuman notes remain here.\n"+start+"\nOld useful content.\n"+end+"\n");
    const result=await f.domain.execute("household_memory_remember",f.input,context()) as any;
    assert.equal(result.state,"committed");assert.equal(result.supportedClaimCount,1);assert.equal(result.journalTimeZone,"America/New_York");
    assert.ok(Buffer.byteLength(JSON.stringify(result))<4000);assert.equal(f.mutations.length,2);
    for(const lookup of lookups){
      const snapshot=await f.pages.readManaged("main",lookup,context());
      assert.equal(snapshot!.metadata.customFlag,"preserved");assert.ok(snapshot!.body.includes("Human notes remain here."));assert.ok(snapshot!.body.includes("Old useful content."));
      assert.ok(snapshot!.body.includes("Sam plays goalkeeper"));assert.deepEqual(snapshot!.metadata.sourceIds,[old.id,result.sourceId]);
      assert.equal((snapshot!.metadata.claims as any[])[0].status,"candidate");assert.equal(snapshot!.metadata.status,"review");
      assert.deepEqual(snapshot!.metadata.questions,["Ask Sam"]);
    }
    const replay=await f.domain.execute("household_memory_remember",f.input,context()) as any;
    assert.equal(replay.topic.alreadyRecorded,true);assert.equal(replay.journal.alreadyRecorded,true);assert.equal(f.mutations.length,2);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("remember keeps inference as a candidate and its source references visible",async()=>{
  const f=await fixture();try{
    const result=await f.domain.execute("household_memory_remember",{...f.input,claims:[{text:"Sam enjoys playing goalkeeper",evidenceQuote:f.input.sourceQuote,certainty:"inference"}]},context()) as any;
    assert.equal(result.supportedClaimCount,0);assert.equal(result.candidateClaimCount,1);
    assert.ok(String(f.mutations[0].body).includes("[Candidate]"));assert.equal((f.mutations[0].claims as any[])[0].status,"candidate");
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("remember reuses the current supersede replacement without creating a duplicate source",async()=>{
  const f=await fixture();try{
    const oldQuote="Sam previously played midfield.",oldContext=context(oldQuote,"user:old");
    const old=await f.sources.save("main","personal",{operationId:"old-position",title:"Sam",text:oldQuote,sourceIds:["user:old"],certainty:"fact"},oldContext);
    const corrected=await f.domain.execute("household_memory_source_supersede",{operationId:"correct-position",scope:"personal",sourceId:old.id,expectedFingerprint:old.fingerprint,title:"Sam",text:f.input.sourceQuote,certainty:"fact"},context()) as any;
    const before=(await readdir(path.join(f.workspace,"memory/household-sources"))).filter(name=>name.endsWith(".md")).sort();
    const input={...f.input,sourceId:corrected.replacementSourceId};
    const result=await f.domain.execute("household_memory_remember",input,context()) as any;
    assert.equal(result.sourceId,corrected.replacementSourceId);assert.equal(result.sourceReused,true);assert.equal(result.supportedClaimCount,1);assert.equal(f.mutations.length,2);
    assert.deepEqual((await readdir(path.join(f.workspace,"memory/household-sources"))).filter(name=>name.endsWith(".md")).sort(),before);
    const again=await f.domain.execute("household_memory_remember",{...input,operationId:"curate-again-same-source"},context()) as any;
    assert.equal(again.topic.alreadyRecorded,true);assert.equal(again.journal.alreadyRecorded,true);assert.equal(f.mutations.length,2);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("remember cannot adopt old-human, candidate, wrong-body, wrong-scope, fabricated or retired sources",async()=>{
  for(const kind of ["old-human","candidate","wrong-body","wrong-scope","fabricated","retired"]){
    const f=await fixture();try{
      const body=kind==="wrong-body"?"Sam likes blue.":f.input.sourceQuote,id=kind==="old-human"?"user:old":"user:current";
      const source=await f.sources.save("main","personal",{operationId:"source-to-reject",title:"Sam",text:body,sourceIds:[id],certainty:kind==="candidate"?"inference":"fact"},context(body,id));
      if(kind==="retired")await f.domain.execute("household_memory_source_forget",{operationId:"retire-adopted-source",scope:"personal",sourceId:source.id,expectedFingerprint:source.fingerprint},{...context(),destructiveApproved:true});
      const sourceId=kind==="fabricated"?"source-"+"f".repeat(64):source.id;
      const ctx=kind==="wrong-body"?context(body+" "+f.input.sourceQuote):kind==="wrong-scope"?{...context(),audience:"household" as const,allowedScopes:["personal","household"] as const}:context();
      const before=f.rpcCalls.length,mutations=f.mutations.length;
      await assert.rejects(()=>f.domain.execute("household_memory_remember",{...f.input,sourceId,...(kind==="wrong-scope"?{scope:"household"}:{})},ctx));
      assert.equal(f.rpcCalls.length,before,kind+" reached native memory");assert.equal(f.mutations.length,mutations);
    }finally{await rm(f.directory,{recursive:true,force:true});}
  }
});

test("remember refuses an intervening managed-page change without replacing prior content",async()=>{
  const f=await fixture();try{
    const original=f.pages.assertManagedUnchanged.bind(f.pages);
    f.pages.assertManagedUnchanged=async(agent,lookup,fingerprint,ctx)=>{
      await writeFile(path.join(f.vault,lookup),"---\nid: synthesis.changed\n---\nOperator changed this page.\n");
      await original(agent,lookup,fingerprint,ctx);
    };
    await assert.rejects(()=>f.domain.execute("household_memory_remember",f.input,context()),(error:any)=>error.code==="memory_projection_refresh_required"&&error.cause?.code==="memory_revision_conflict");
    assert.equal(f.mutations.length,0);assert.match(await readFile(path.join(f.vault,"syntheses/household-topic-sam.md"),"utf8"),/Operator changed/);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("managed memory reads reject YAML aliases and preserve scope isolation",async()=>{
  const f=await fixture();try{
    await writeFile(path.join(f.vault,"syntheses/household-topic-sam.md"),"---\nsourceIds: &refs [source-one]\nclaims: *refs\n---\nData\n");
    await assert.rejects(()=>f.pages.readManaged("main","syntheses/household-topic-sam.md",context()),{code:"managed_topic_metadata_invalid"});
    await assert.rejects(()=>f.domain.execute("household_memory_remember",{...f.input,scope:"household"},context()),{code:"scope_not_authorized"});
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("same-operation recovery finishes a failed journal without duplicating its committed topic",async()=>{
  const f=await fixture();try{
    const original=f.rpc.request.bind(f.rpc);let failed=false;
    f.rpc.request=async(method,mutation,ctx)=>{
      if(!failed&&String(mutation.title).includes("Daily journal")){failed=true;throw Error("journal compile unavailable");}
      return original(method,mutation,ctx);
    };
    await assert.rejects(()=>f.domain.execute("household_memory_remember",f.input,context()),{code:"memory_projection_refresh_required",deliveryOutcome:"unknown"});
    assert.equal(f.mutations.length,1);
    const resumed=await f.domain.execute("household_memory_remember",f.input,context()) as any;
    assert.equal(resumed.topic.alreadyRecorded,true);assert.equal(resumed.journal.alreadyRecorded,false);assert.equal(f.mutations.length,2);
    const topic=await f.pages.readManaged("main","syntheses/household-topic-sam.md",context());
    assert.equal((topic!.body.match(/Sam plays goalkeeper/g)??[]).length,1);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

async function treeSnapshot(root:string):Promise<unknown[]> {
  const result:unknown[]=[];
  async function visit(directory:string){for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    const filename=path.join(directory,entry.name),info=await stat(filename),relative=path.relative(root,filename);
    if(entry.isDirectory()){result.push({path:relative,directory:true});await visit(filename);}
    else result.push({path:relative,mtime:info.mtimeMs,sha256:createHash("sha256").update(await readFile(filename)).digest("hex")});
  }}
  await visit(root);return result;
}

test("private capture stays personal and shared capture uses only the neutral household corpus",async()=>{
  const f=await fixture();try{
    const privateQuote="Fred Fixture likes blue.",sharedQuote="AYSO games begin Saturday.";
    const privateContext={...context(privateQuote,"user:private"),allowedScopes:["personal","household"] as const};
    const privateResult=await f.domain.execute("household_memory_remember",{operationId:"remember-private-fred",scope:"personal",topic:"Fred",sourceQuote:privateQuote,claims:[{text:privateQuote,certainty:"fact"}]},privateContext) as any;
    const sharedContext={...context(sharedQuote,"user:shared"),audience:"household" as const,allowedScopes:["personal","household"] as const};
    const sharedResult=await f.domain.execute("household_memory_remember",{operationId:"remember-shared-ayso",scope:"household",topic:"AYSO",sourceQuote:sharedQuote,claims:[{text:sharedQuote,certainty:"fact"}]},sharedContext) as any;
    assert.equal(privateResult.supportedClaimCount,1);assert.equal(sharedResult.supportedClaimCount,1);
    assert.equal((await f.sources.read("main","personal",privateResult.sourceId,privateContext)).certainty,"confirmed");
    assert.equal((await f.sources.read("household-knowledge","household",sharedResult.sourceId,sharedContext)).certainty,"confirmed");
    assert.ok(f.mutations.slice(0,2).every(value=>value.agentId==="main"));
    assert.ok(f.mutations.slice(2).every(value=>value.agentId==="household-knowledge"));
    assert.equal((await treeSnapshot(f.sharedWorkspace)).some(value=>JSON.stringify(value).includes(privateResult.sourceId)),false);
    assert.doesNotMatch(await readFile(path.join(f.sharedVault,sharedResult.topic.lookup),"utf8"),/Fred Fixture/);
    assert.doesNotMatch(await readFile(path.join(f.vault,privateResult.topic.lookup),"utf8"),/AYSO games/);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("every private-to-household content write is refused before source, topic, journal or provider changes",async()=>{
  const f=await fixture();try{
    const sharedContext={...context(),audience:"household" as const,allowedScopes:["personal","household"] as const};
    const seeded=await f.domain.execute("household_memory_remember",{...f.input,scope:"household"},sharedContext) as any;
    const source=await f.sources.read("household-knowledge","household",seeded.sourceId,sharedContext);
    const privateContext={...context("Fred Fixture likes blue.","user:private-later"),allowedScopes:["personal","household"] as const};
    const page=await f.domain.execute("household_memory_get",{scope:"household",lookup:seeded.topic.lookup},privateContext) as any;
    const quote="Fred Fixture likes blue.",base={scope:"household",operationId:"private-publication-01"};
    const cases=[
      {name:"household_memory_remember",args:{...base,topic:"Fred",sourceQuote:quote,claims:[{text:quote,certainty:"fact"}]}},
      {name:"household_memory_source_save",args:{...base,title:"Fred",text:quote,certainty:"fact"}},
      {name:"household_memory_source_supersede",args:{...base,sourceId:source.id,expectedFingerprint:source.fingerprint,title:"Fred",text:quote,certainty:"fact"}},
      {name:"household_memory_synthesize",args:{...base,title:"Fred",body:quote,sourceIds:[source.id],claims:[{text:quote,sourceIds:[source.id],certainty:"fact"}],expectedContentHash:null}},
      {name:"household_memory_annotate",args:{...base,lookup:seeded.topic.lookup,expectedContentHash:page.contentHash,questions:[quote]}},
    ];
    const before=await treeSnapshot(f.directory),calls=f.rpcCalls.length,mutations=f.mutations.length;
    for(const item of cases){
      await assert.rejects(()=>f.domain.execute(item.name,item.args,privateContext),{code:"memory_shared_write_requires_shared_conversation",statusCode:403,deliveryOutcome:"not_sent"});
      assert.deepEqual(await treeSnapshot(f.directory),before,item.name+" changed the memory tree");
      assert.equal(f.rpcCalls.length,calls,item.name+" reached native memory");assert.equal(f.mutations.length,mutations);
    }
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("scope access and model-claimed sharing fields cannot grant private memory publication",async()=>{
  const f=await fixture();try{
    const privateContext={...context(),allowedScopes:["personal","household"] as const};
    const before=await treeSnapshot(f.directory);
    await assert.rejects(()=>f.domain.execute("household_memory_remember",{...f.input,scope:"household",sharingApproved:true,publicationGrant:{scope:"household"}},
      {...privateContext,sharingApproved:true} as NativeDomainContext),{code:"memory_shared_write_requires_shared_conversation"});
    for(const audience of [undefined,"unknown"])
      await assert.rejects(()=>f.domain.execute("household_memory_remember",{...f.input,scope:"household"},
        {...privateContext,audience} as unknown as NativeDomainContext),{code:"memory_shared_write_requires_shared_conversation"});
    assert.deepEqual(await treeSnapshot(f.directory),before);
    await assert.rejects(()=>f.domain.execute("household_memory_remember",{...f.input,sharingApproved:true},privateContext),{code:"invalid_arguments"});
    // Existing readiness can initialize empty local lifecycle directories; no
    // malformed request may create source, topic or journal content.
    assert.ok((await treeSnapshot(f.directory)).every(value=>(value as {directory?:boolean}).directory===true));
    assert.equal(f.mutations.length,0);assert.equal(f.rpcCalls.length,0);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("private access may read, compile and explicitly approve content-free forgetting of existing shared memory",async()=>{
  const f=await fixture();try{
    const sharedContext={...context(),audience:"household" as const,allowedScopes:["personal","household"] as const};
    const seeded=await f.domain.execute("household_memory_remember",{...f.input,scope:"household"},sharedContext) as any;
    const privateContext={...context("Forget the selected shared source.","user:forget"),allowedScopes:["personal","household"] as const};
    const source=(await f.domain.execute("household_memory_source_read",{scope:"household",sourceId:seeded.sourceId},privateContext) as any).source;
    const page=await f.domain.execute("household_memory_get",{scope:"household",lookup:seeded.topic.lookup},privateContext) as any;
    assert.ok(page.contentHash);assert.equal(source.text,f.input.sourceQuote);
    assert.deepEqual(await f.domain.execute("household_memory_compile",{scope:"household",operationId:"compile-shared-01"},privateContext),{compiled:true});
    const forget={scope:"household",sourceId:source.id,expectedFingerprint:source.fingerprint,operationId:"forget-shared-01"};
    await assert.rejects(()=>f.domain.execute("household_memory_source_forget",forget,privateContext),{code:"destructive_approval_required"});
    const result=await f.domain.execute("household_memory_source_forget",forget,{...privateContext,destructiveApproved:true}) as any;
    assert.equal(result.state,"committed");assert.equal(f.indexed(),1);
    await assert.rejects(()=>f.sources.read("household-knowledge","household",source.id,sharedContext),{code:"memory_source_retired"});
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("a shared source cannot copy its content into a personal memory scope",async()=>{
  const f=await fixture();try{
    const sharedContext={...context(),audience:"household" as const,allowedScopes:["personal","household"] as const};
    const before=await treeSnapshot(f.directory);
    await assert.rejects(()=>f.domain.execute("household_memory_remember",f.input,sharedContext),{code:"scope_not_authorized"});
    assert.deepEqual(await treeSnapshot(f.directory),before);assert.equal(f.mutations.length,0);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});


function largeInput(operationId:string){return {operationId,scope:"personal",topic:"Long running topic",sourceQuote:"Please remember this long review.",claims:Array.from({length:12},(_,i)=>({text:"Candidate "+i+": "+"long retained detail ".repeat(85),certainty:"inference"}))};}

test("one large capture rolls topic and journal into bounded native parts and replays without duplication",async()=>{
  const f=await fixture();try{
    const input=largeInput("remember-large-capture"),ctx=context(input.sourceQuote,"user:large-capture");
    const result=await f.domain.execute("household_memory_remember",input,ctx) as any;
    assert.equal(result.state,"committed");assert.equal(result.topic.partCount,2);assert.equal(result.journal.partCount,2);assert.equal(f.mutations.length,4);
    for(const projection of [result.topic,result.journal]){
      const claims:any[]=[];
      for(const lookup of projection.lookups){const snapshot=await f.pages.readManaged("main",lookup,ctx);assert.ok(snapshot);claims.push(...snapshot.metadata.claims as any[]);
        const generated=snapshot.body.split(start)[1].split(end)[0].trim();assert.ok(generated.length<=20000);assert.ok(generated.split("\n").length<=350);}
      assert.equal(claims.length,12);assert.equal(new Set(claims.map(claim=>claim.id)).size,12);assert.ok(claims.every(claim=>claim.status==="candidate"));
    }
    const again=await f.domain.execute("household_memory_remember",input,ctx) as any;
    assert.equal(again.topic.alreadyRecorded,true);assert.equal(again.journal.alreadyRecorded,true);assert.equal(f.mutations.length,4);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("rollover recovers a partially committed large capture, then finishes its journal",async()=>{
  const f=await fixture();try{
    const input=largeInput("remember-partial-large"),ctx=context(input.sourceQuote,"user:partial-large"),original=f.rpc.request.bind(f.rpc);let failed=false;
    f.rpc.request=async(method,mutation,context)=>{if(!failed&&String(mutation.title).includes("continuation")){failed=true;throw Error("interrupted between page parts");}return original(method,mutation,context);};
    await assert.rejects(()=>f.domain.execute("household_memory_remember",input,ctx),{code:"memory_projection_refresh_required",deliveryOutcome:"unknown"});
    assert.equal(f.mutations.length,1);
    const result=await f.domain.execute("household_memory_remember",input,ctx) as any;
    assert.equal(result.topic.partCount,2);assert.equal(result.journal.partCount,2);assert.equal(f.mutations.length,4);
    const all=await Promise.all(result.topic.lookups.map((lookup:string)=>f.pages.readManaged("main",lookup,ctx)));
    assert.equal(all.flatMap(page=>(page!.metadata.claims as any[])).length,12);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("a full journal rolls over while preserving earlier notes and unknown metadata",async()=>{
  const f=await fixture();try{
    const date=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
    const lookup="syntheses/household-topic-daily-journal-"+date+".md",filename=path.join(f.vault,lookup);
    const original="---\n"+stringifyYaml({sourceIds:[],claims:[],customFlag:"unchanged"})+"---\n# Existing journal\nHuman notes.\n"+start+"\n"+"Retained line.\n".repeat(345)+end+"\n";
    await writeFile(filename,original);
    const result=await f.domain.execute("household_memory_remember",f.input,context()) as any;
    assert.notEqual(result.journal.lookup,lookup);assert.equal(result.journal.rootLookup,lookup);assert.equal(await readFile(filename,"utf8"),original);
    assert.equal((await f.pages.readManaged("main",lookup,context()))!.metadata.customFlag,"unchanged");
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("forgetting a source across rollover parts preserves a later source in the last part",async()=>{
  const f=await fixture(false);try{
    const input=largeInput("remember-forget-large"),ctx=context(input.sourceQuote,"user:forget-large");
    const saved=await f.domain.execute("household_memory_remember",input,ctx) as any;
    const sentinel="Keep this independent fact.",other=await f.domain.execute("household_memory_remember",{operationId:"remember-after-rollover",scope:"personal",topic:input.topic,sourceQuote:sentinel,claims:[{text:sentinel,certainty:"fact"}]},context(sentinel,"user:sentinel")) as any;
    assert.equal(other.topic.lookup,saved.topic.lookups[1]);
    const source=await f.sources.read("main","personal",saved.sourceId,ctx);
    const result=await f.domain.execute("household_memory_source_forget",{scope:"personal",sourceId:source.id,expectedFingerprint:source.fingerprint,operationId:"forget-spanning-parts"},{...ctx,destructiveApproved:true}) as any;
    assert.equal(result.state,"committed");
    const retained=await f.pages.readManaged("main",other.topic.lookup,ctx);assert.ok(retained);assert.match(retained.body,/Keep this independent fact/);assert.doesNotMatch(retained.body,/Candidate 0/);
    assert.deepEqual(retained.metadata.sourceIds,[other.sourceId]);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});
