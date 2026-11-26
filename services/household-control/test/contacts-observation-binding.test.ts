import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import Ajv from "ajv";
import {ContactsService,contactsMigrationSql,contactsToolDescriptors} from "../src/domains/contacts/index.ts";
import type {ContactObservationInput,ContactPrincipal,ContactSource,ContactsExtractionAccess,ContactsSourceAccess} from "../src/domains/contacts/types.ts";

const artifact=(value:string)=>"artifact-"+createHash("sha256").update(value).digest("hex");
function fixture(texts=["Casey Example\nTelephone: (111) 222-3333"]){
  const db=new DatabaseSync(":memory:");db.exec("PRAGMA foreign_keys=ON;"+contactsMigrationSql);
  const sourceMap=new Map<string,ContactSource>(),textMap=new Map<string,string>();
  const sources=texts.map((text,index)=>{
    const source:ContactSource={artifactId:artifact("source:"+index),sha256:createHash("sha256").update(text).digest("hex"),mimeType:"image/png",byteLength:100,filename:"side-"+index+".png",audience:"private",ownerProfileId:"alex",conversationId:"obs-conversation",taskId:"obs-task"};
    sourceMap.set(source.artifactId,source);textMap.set(source.artifactId,text);return source;
  });
  let extractionCalls=0,published=0,available=true,validHash=true;
  const access:ContactsSourceAccess={async inspect(principal,id){
    assert.ok(principal.allowedArtifactIds?.includes(id),"Source must already be authorized");
    const source=sourceMap.get(id);assert.ok(source);return {...source};
  },async publishCardSource(_principal,source,audience,operationId){
    published++;const mapped={...source,artifactId:artifact(operationId),audience};sourceMap.set(mapped.artifactId,mapped);textMap.set(mapped.artifactId,textMap.get(source.artifactId)!);return mapped;
  }};
  const extractions:ContactsExtractionAccess={async resolve(principal,ids,_requested,executionOperationId){
    extractionCalls++;assert.ok(ids.every(id=>principal.allowedArtifactIds?.includes(id)));
    return ids.map(sourceArtifactId=>available?{state:"extracted" as const,sourceArtifactId,sourceSha256:validHash?sourceMap.get(sourceArtifactId)!.sha256:"f".repeat(64),
      executionOperationId,extractionArtifactId:artifact("extraction:"+sourceArtifactId),text:textMap.get(sourceArtifactId)!,pageCount:2,warnings:[]}:
      {state:"unavailable" as const,sourceArtifactId,sourceSha256:sourceMap.get(sourceArtifactId)!.sha256,warnings:["Reader unavailable"]});
  }};
  const principal:ContactPrincipal={profileId:"alex",agentId:"main",conversationId:"obs-conversation",taskId:"obs-task",audience:"private",canReadHousehold:true,canWriteHousehold:true,canEditContacts:true,sourcePromptId:"obs-human-intake",allowedArtifactIds:sources.map(source=>source.artifactId)};
  const service=new ContactsService(db,access,extractions);
  const capture=(observations?:ContactObservationInput[])=>service.captureCard(principal,{operationId:"obs-capture-operation",sourceArtifactIds:sources.map(source=>source.artifactId),fields:{phone:["111-222-3333"]},observations});
  return {db,sources,principal,service,capture,extractionCalls:()=>extractionCalls,published:()=>published,setAvailable(value:boolean){available=value;},setValidHash(value:boolean){validHash=value;}};
}

test("observation schema permits omitted source ID but rejects an abbreviated explicit ID",()=>{
  const tool=contactsToolDescriptors.find(value=>value.name==="contacts.capture_card")!;
  const validate=new Ajv({strict:false}).compile(tool.inputSchema);
  const args={operationId:"schema-capture-1",sourceArtifactIds:[artifact("source")],observations:[{field:"phone",value:"111-222-3333",quote:"(111) 222-3333"}]};
  assert.equal(validate(args),true);
  assert.equal(validate({...args,observations:[{...args.observations[0],sourceArtifactId:"artifact-123…"}]}),false);
});

test("exact unique quote binds full owning IDs before saving normalized fields and provenance",async()=>{
  const f=fixture();try{
    const observation:ContactObservationInput={field:"phone",value:"111-222-3333",quote:"(111) 222-3333",page:2,blockId:"telephone-block",confidence:.8,inferred:false};
    const saved=await f.capture([observation]);
    assert.deepEqual(saved.contact.fields.phone,["111-222-3333"]);assert.equal(saved.receipt.scanState,"fields_saved");
    const expectedExtraction=artifact("extraction:"+f.sources[0].artifactId);
    assert.deepEqual(saved.contact.observations,[{...observation,sourceArtifactId:saved.contact.sources[0].artifactId,extractionArtifactId:expectedExtraction}]);
    assert.equal(saved.contact.sources[0].sha256,f.sources[0].sha256);assert.equal(saved.receipt.extraction?.[0].extractionArtifactId,expectedExtraction);
    assert.equal(observation.sourceArtifactId,undefined,"Binding must not mutate model input");
    assert.equal(f.extractionCalls(),1);
  }finally{f.db.close();}
});

test("quote appearing in multiple authorized sources requires disambiguation",async()=>{
  const f=fixture(["Telephone: (111) 222-3333","Same number: (111) 222-3333"]);try{
    await assert.rejects(f.capture([{field:"phone",value:"111-222-3333",quote:"(111) 222-3333"}]),{code:"contact_observation_evidence_ambiguous"});
    assert.equal(f.published(),0);assert.equal(f.db.prepare("SELECT count(*) AS n FROM contacts").get()!.n,0);
  }finally{f.db.close();}
});

test("an exact authorized extraction reference disambiguates a repeated quote",async()=>{
  const f=fixture(["Telephone: (111) 222-3333","Same number: (111) 222-3333"]);try{
    const extractionArtifactId=artifact("extraction:"+f.sources[1].artifactId);
    const saved=await f.capture([{field:"phone",value:"111-222-3333",quote:"(111) 222-3333",extractionArtifactId}]);
    assert.equal(saved.contact.observations[0].sourceArtifactId,saved.contact.sources[1].artifactId);
    assert.equal(saved.contact.observations[0].extractionArtifactId,extractionArtifactId);
  }finally{f.db.close();}
});

test("wrong or out-of-scope explicit source ID is never inferred from the quote",async()=>{
  for(const sourceArtifactId of [artifact("not-authorized"),"artifact-123..."]){const f=fixture();try{
    await assert.rejects(f.capture([{field:"phone",value:"111-222-3333",quote:"(111) 222-3333",sourceArtifactId}]),{code:"contact_observations_invalid"});
    assert.equal(f.extractionCalls(),0);assert.equal(f.published(),0);
  }finally{f.db.close();}}
});

test("an explicitly wrong authorized side cannot fall through to another side's literal evidence",async()=>{
  const f=fixture(["111-222-3333","Other side without a phone"]);try{
    await assert.rejects(f.capture([{field:"phone",value:"111-222-3333",quote:"111-222-3333",sourceArtifactId:f.sources[1].artifactId}]),{code:"contact_observation_evidence_mismatch"});
    assert.equal(f.published(),0);
  }finally{f.db.close();}
});

test("an explicit wrong extraction ID is not replaced by a matching source quote",async()=>{
  const f=fixture();try{
    await assert.rejects(f.capture([{field:"phone",value:"111-222-3333",quote:"(111) 222-3333",sourceArtifactId:f.sources[0].artifactId,extractionArtifactId:artifact("wrong-extraction")}]),{code:"contact_observation_evidence_mismatch"});
    assert.equal(f.published(),0);
  }finally{f.db.close();}
});

test("implicit source requires an actual exact quote and an available hash-verified extraction",async()=>{
  const tests=[
    {observation:{field:"phone",value:"111-222-3333"},code:"contact_observation_quote_required"},
    {observation:{field:"phone",value:"111-222-3333",quote:"not present"},code:"contact_observation_evidence_missing"},
    {observation:{field:"phone",value:"111-222-3333",quote:"(111) 222-3333",page:3},code:"contact_observation_evidence_missing"},
    {observation:{field:"phone",value:"111-222-3333",quote:"(111) 222-3333"},available:false,code:"contact_observation_evidence_missing"},
    {observation:{field:"phone",value:"111-222-3333",quote:"(111) 222-3333"},hash:false,code:"contact_observation_evidence_missing"},
  ];
  for(const scenario of tests){const f=fixture();try{
    if(scenario.available===false)f.setAvailable(false);if(scenario.hash===false)f.setValidHash(false);
    await assert.rejects(f.capture([scenario.observation as ContactObservationInput]),{code:scenario.code});assert.equal(f.published(),0);
  }finally{f.db.close();}}
});

test("literal fields still ground without observations and unavailable extraction still preserves every original",async()=>{
  const f=fixture(["111-222-3333"]);try{
    const saved=await f.capture();assert.deepEqual(saved.contact.fields.phone,["111-222-3333"]);assert.ok(saved.contact.observations[0].sourceArtifactId);
  }finally{f.db.close();}
  const unavailable=fixture();try{
    unavailable.setAvailable(false);const saved=await unavailable.capture();assert.deepEqual(saved.contact.fields,{});assert.equal(saved.receipt.scanState,"extraction_unavailable");assert.equal(saved.contact.sources.length,1);
  }finally{unavailable.db.close();}
});

test("a later human OCR redo can bind a quote but cannot bypass current focus or rewrite unrelated fields",async()=>{
  const f=fixture();try{
    const saved=await f.service.captureCard(f.principal,{operationId:"obs-initial-name",sourceArtifactIds:[f.sources[0].artifactId],fields:{full_name:["Casey Example"]}});
    const input={operationId:"obs-redo-phone",contactId:saved.contact.id,expectedRevision:1,patch:{set:{phone:["111-222-3333"]}},reason:"ocr_redo" as const,observations:[{field:"phone" as const,value:"111-222-3333",quote:"(111) 222-3333"}]};
    await assert.rejects(f.service.redo(f.principal,input),{code:"contact_user_prompt_binding_required"});
    const prompt="obs-human-followup",principal={...f.principal,sourcePromptId:prompt,userPromptBinding:{promptId:prompt,conversationId:f.principal.conversationId,taskId:f.principal.taskId,targetContactId:saved.contact.id,expectedRevision:1,allowedActions:["ocr_redo" as const]}};
    const revised=await f.service.redo(principal,input);
    assert.deepEqual(revised.contact.fields,{full_name:["Casey Example"],phone:["111-222-3333"]});assert.equal(revised.contact.currentRevision,2);
    assert.ok(revised.contact.observations.every(observation=>/^artifact-[a-f0-9]{64}$/.test(observation.sourceArtifactId)));
    assert.equal(f.service.revisions(f.principal,saved.contact.id).items.length,2);
  }finally{f.db.close();}
});

function sixFieldFixture(){
  const expected={full_name:["Casey Example"],organization:["Fixture Company"],job_title:["Community Coordinator"],email:["casey@example.test"],phone:["111-222-3333"],website:["https://example.test/casey"]};
  const f=fixture(["Casey Example\nFixture Company\nCommunity Coordinator\ncasey@example.test\nTelephone: (111) 222-3333\nhttps://example.test/casey"]);
  const observations:ContactObservationInput[]=Object.entries(expected).map(([field,values])=>({field:field as ContactObservationInput['field'],value:values[0],
    sourceArtifactId:f.sources[0].artifactId,extractionArtifactId:artifact("extraction:"+f.sources[0].artifactId),quote:field==="phone"?"(111) 222-3333":values[0]}));
  const input={operationId:"observations-six-fields",sourceArtifactIds:[f.sources[0].artifactId],extractionArtifactIds:[artifact("extraction:"+f.sources[0].artifactId)],observations};
  return {...f,expected,observations,input};
}

test("observations-only capture saves six interpreted fields and their full grounded evidence without duplication",async()=>{
  const f=sixFieldFixture();try{
    const saved=await f.service.captureCard(f.principal,f.input);
    assert.deepEqual(saved.contact.fields,f.expected);assert.equal(saved.receipt.readableFieldCount,6);assert.equal(saved.receipt.scanState,"fields_saved");
    assert.equal(saved.contact.observations.length,6);
    for(const observation of saved.contact.observations){
      assert.equal(observation.sourceArtifactId,saved.contact.sources[0].artifactId);
      assert.equal(observation.extractionArtifactId,f.input.extractionArtifactIds[0]);
      assert.equal(observation.quote,f.observations.find(item=>item.field===observation.field)!.quote);
    }
    const replay=await f.service.captureCard(f.principal,f.input);assert.equal(replay.replayed,true);assert.equal(replay.contact.id,saved.contact.id);
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM contacts").get()!.n,1);
  }finally{f.db.close();}
});

test("explicit fields choose saved values even when observations propose six fields, including explicit empty selection",async()=>{
  for(const selection of [{full_name:["Casey Example"]},{}]){const f=sixFieldFixture();try{
    const saved=await f.service.captureCard(f.principal,{...f.input,fields:selection});
    assert.deepEqual(saved.contact.fields,selection);assert.equal(saved.contact.observations.length,Object.keys(selection).length);
    assert.equal(saved.contact.sources.length,1);
  }finally{f.db.close();}}
});

test("observations-only proposal does not weaken wrong, ambiguous or untrusted evidence denial",async()=>{
  const wrong=sixFieldFixture();try{
    await assert.rejects(wrong.service.captureCard(wrong.principal,{...wrong.input,observations:[{...wrong.observations[0],sourceArtifactId:artifact("outside-source")}]}),{code:"contact_observations_invalid"});
    assert.equal(wrong.published(),0);
  }finally{wrong.db.close();}
  const ambiguous=fixture(["Casey Example","Casey Example"]);try{
    await assert.rejects(ambiguous.service.captureCard(ambiguous.principal,{operationId:"ambiguous-only-proposals",sourceArtifactIds:ambiguous.sources.map(source=>source.artifactId),
      observations:[{field:"full_name",value:"Casey Example",quote:"Casey Example"}]}),{code:"contact_observation_evidence_ambiguous"});
    assert.equal(ambiguous.published(),0);
  }finally{ambiguous.db.close();}
  const untrusted=fixture(["Casey Example"]);try{
    untrusted.setValidHash(false);
    await assert.rejects(untrusted.service.captureCard(untrusted.principal,{operationId:"untrusted-only-proposals",sourceArtifactIds:[untrusted.sources[0].artifactId],
      observations:[{field:"full_name",value:"Casey Example",quote:"Casey Example"}]}),{code:"contact_observation_evidence_missing"});
    assert.equal(untrusted.published(),0);
  }finally{untrusted.db.close();}
});

test("no fields or observations stays source-only and genuine reader unavailability never validates inferred fields",async()=>{
  const empty=fixture();try{
    const saved=await empty.service.captureCard(empty.principal,{operationId:"unchanged-source-only",sourceArtifactIds:[empty.sources[0].artifactId]});
    assert.deepEqual(saved.contact.fields,{});assert.deepEqual(saved.contact.observations,[]);assert.equal(saved.contact.sources.length,1);
  }finally{empty.db.close();}
  const unavailable=sixFieldFixture();try{
    unavailable.setAvailable(false);const observations=unavailable.observations.map(({extractionArtifactId,...item})=>item);
    const saved=await unavailable.service.captureCard(unavailable.principal,{...unavailable.input,observations});
    assert.deepEqual(saved.contact.fields,{});assert.deepEqual(saved.contact.observations,[]);assert.equal(saved.receipt.scanState,"extraction_unavailable");assert.equal(saved.contact.sources.length,1);
  }finally{unavailable.db.close();}
});

test("observations-only OCR redo patches observed fields while manual revision still requires explicit selection",async()=>{
  const f=fixture();try{
    const saved=await f.service.captureCard(f.principal,{operationId:"obs-only-redo-initial",sourceArtifactIds:[f.sources[0].artifactId],fields:{full_name:["Casey Example"]}});
    const prompt="observations-only-followup",principal={...f.principal,sourcePromptId:prompt,userPromptBinding:{promptId:prompt,conversationId:f.principal.conversationId,taskId:f.principal.taskId,targetContactId:saved.contact.id,expectedRevision:1,allowedActions:["ocr_redo" as const,"revise" as const]}};
    const observation:ContactObservationInput={field:"phone",value:"111-222-3333",quote:"(111) 222-3333"};
    assert.throws(()=>f.service.revise(principal,{operationId:"manual-still-explicit",contactId:saved.contact.id,expectedRevision:1,reason:"correction",observations:[observation]}),{code:"contact_fields_or_patch_required"});
    const revised=await f.service.redo(principal,{operationId:"observations-only-redo",contactId:saved.contact.id,expectedRevision:1,reason:"ocr_redo",observations:[observation]});
    assert.deepEqual(revised.contact.fields,{full_name:["Casey Example"],phone:["111-222-3333"]});assert.equal(revised.contact.currentRevision,2);
    assert.deepEqual(revised.contact.observations.find(item=>item.field==="full_name"),saved.contact.observations[0]);
    assert.ok(revised.contact.observations.find(item=>item.field==="phone")!.extractionArtifactId);
    assert.equal(f.service.revisions(f.principal,saved.contact.id).items.length,2);
  }finally{f.db.close();}
});
