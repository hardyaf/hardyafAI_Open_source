import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {ArtifactStore} from "../src/platform/artifacts.ts";
import {ArtifactDocumentAccess,DocumentsService} from "../src/domains/documents/index.ts";
import {ArtifactContactsSourceAccess,ContactsService,contactsMigrationSql} from "../src/domains/contacts/index.ts";
import {composeContactExtraction} from "../src/domain-runtime/contact-extraction.ts";
import type {ContactPrincipal} from "../src/domains/contacts/types.ts";
import type {DocumentExtractor,DocumentPrincipal,SavedExtraction} from "../src/domains/documents/types.ts";

function principal(overrides:Partial<ContactPrincipal>={}):ContactPrincipal{return {profileId:"alex",agentId:"main",conversationId:"conv-card",taskId:"task-card",audience:"private",
  canReadHousehold:true,canWriteHousehold:true,canEditContacts:true,sourcePromptId:"capture-prompt",assertCurrent(){},...overrides};}
async function fixture(){
  const directory=await mkdtemp(path.join(tmpdir(),"contact-extraction-adapter-")),artifacts=new ArtifactStore({root:path.join(directory,"artifacts")});await artifacts.initialize();
  const context=principal(),actor={profileId:context.profileId,canReadHousehold:true};
  const source=await artifacts.put({ownerProfileId:context.profileId,conversationId:context.conversationId,taskId:context.taskId,audience:"private"},actor,
    {bytes:Buffer.from("%PDF-card source"),mimeType:"application/pdf",filename:"card.pdf",kind:"input",idempotencyKey:"card-input"});
  const state={executions:0,text:"Casey Example\nold@example.test",fail:false,allowed:true};
  const extractor:DocumentExtractor={async readiness(){return {status:"ready",detail:"fixture"};},async extract(input){state.executions++;if(state.fail)throw Error("local reader failed");
    return {engine:"fixture-local",pageCount:1,sourceSha256:input.sha256,text:state.text,structured:{},warnings:[]};}};
  const access=new ArtifactDocumentAccess(artifacts),documents=new DocumentsService(access,extractor);
  const adapter=composeContactExtraction({access,documents,allowed:()=>state.allowed});
  const documentContext:DocumentPrincipal={...context,canProcessDocuments:true};
  return {directory,artifacts,context,actor,source,state,access,documents,adapter,documentContext};
}

test("card adapter uses the actual Documents owner and repeats an operation without another extraction",async()=>{
  const f=await fixture();try{
    const first=await f.adapter.resolve(f.context,[f.source.id],[],"capture-adapter-01");
    assert.equal(first[0].state,"extracted");assert.equal(first[0].sourceSha256,f.source.sha256);assert.equal(f.state.executions,1);
    const repeated=await f.adapter.resolve(f.context,[f.source.id],[],"capture-adapter-01");
    assert.deepEqual(repeated,first);assert.equal(f.state.executions,1);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("a verified existing extraction handle avoids new local work",async()=>{
  const f=await fixture();try{
    const extracted=await f.documents.extract(f.documentContext,{artifactId:f.source.id,operationId:"existing-card-ocr"});
    const result=await f.adapter.resolve(f.context,[f.source.id],[extracted.extractionArtifactId],"capture-existing-ocr");
    assert.equal(result[0].state,"extracted");assert.equal(f.state.executions,1);
    assert.equal((result[0] as any).extractionArtifactId,extracted.extractionArtifactId);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("an extraction lookup identifier does not grant access to another task",async()=>{
  const f=await fixture();try{
    const otherContext={...f.documentContext,conversationId:"conv-elsewhere",taskId:"task-elsewhere",allowedArtifactIds:[f.source.id]};
    const extracted=await f.documents.extract(otherContext,{artifactId:f.source.id,operationId:"other-task-card-ocr"});
    await assert.rejects(()=>f.adapter.resolve(f.context,[f.source.id],[extracted.extractionArtifactId],"capture-ungranted-handle"),{code:"document_artifact_scope_mismatch"});
    assert.equal(f.state.executions,1);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("source identity and source hash are checked against real stored extraction evidence",async()=>{
  const f=await fixture();try{
    const forged:SavedExtraction={schemaVersion:1,requestFingerprint:"a".repeat(64),sourceArtifactId:f.source.id,sourceSha256:"b".repeat(64),mode:"auto",engine:"fixture-local",
      pageCount:1,text:"invented@example.test",structured:{},warnings:[],createdAt:new Date().toISOString(),trust:"untrusted_document_data"};
    const handle=await f.artifacts.put({ownerProfileId:f.context.profileId,conversationId:f.context.conversationId,taskId:f.context.taskId,audience:"private"},f.actor,
      {bytes:Buffer.from(JSON.stringify(forged)),filename:"document-extraction.json",mimeType:"application/json",kind:"evidence",idempotencyKey:"wrong-hash-extraction"});
    await assert.rejects(()=>f.adapter.resolve(f.context,[f.source.id],[handle.id],"capture-wrong-source-hash"),{code:"contact_extraction_source_changed"});
    assert.equal(f.state.executions,0);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("contacts permission alone cannot authorize Documents and a real reader failure is explicit",async()=>{
  const f=await fixture();try{
    f.state.allowed=false;
    const unavailable=await f.adapter.resolve(f.context,[f.source.id],[],"capture-document-unavailable");
    assert.equal(unavailable[0].state,"unavailable");assert.equal(f.state.executions,0);
    f.state.allowed=true;f.state.fail=true;
    const failed=await f.adapter.resolve(f.context,[f.source.id],[],"capture-document-failed");
    assert.equal(failed[0].state,"failed");assert.equal(failed[0].sourceSha256,f.source.sha256);assert.equal(f.state.executions,1);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("private source data remains inaccessible from a shared context even with its ID",async()=>{
  const f=await fixture();try{
    await assert.rejects(()=>f.adapter.resolve({...f.context,audience:"household",allowedArtifactIds:[f.source.id]},[f.source.id],[],"capture-shared-private-source"),{code:"document_private_context_required"});
    assert.equal(f.state.executions,0);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("a later OCR redo carries only source grants obtained from the authorized contact owner",async()=>{
  const f=await fixture(),database=new DatabaseSync(":memory:");database.exec("PRAGMA foreign_keys=ON;"+contactsMigrationSql);
  try{
    const contacts=new ContactsService(database,new ArtifactContactsSourceAccess(f.artifacts),f.adapter);
    const saved=await contacts.captureCard(f.context,{operationId:"capture-real-contact",sourceArtifactIds:[f.source.id],fields:{full_name:["Casey Example"],email:["old@example.test"]}});
    f.state.text="Updated email: new@example.test";
    const later=principal({conversationId:"conv-later",taskId:"task-later",sourcePromptId:"later-human-prompt",userPromptBinding:{promptId:"later-human-prompt",conversationId:"conv-later",taskId:"task-later",
      targetContactId:saved.contact.id,expectedRevision:1,allowedActions:["ocr_redo"]}});
    const updated=await contacts.redo(later,{operationId:"redo-real-contact",contactId:saved.contact.id,patch:{set:{email:["new@example.test"]}},reason:"ocr_redo"});
    assert.deepEqual(updated.contact.fields,{full_name:["Casey Example"],email:["new@example.test"]});assert.equal(updated.contact.currentRevision,2);assert.equal(f.state.executions,2);
  }finally{database.close();await rm(f.directory,{recursive:true,force:true});}
});


test("fresh OCR cannot reuse an old supplied extraction; its own operation remains idempotent",async()=>{
  const f=await fixture();try{
    const old=await f.documents.extract(f.documentContext,{artifactId:f.source.id,operationId:"old-readable-card"});
    f.state.text="Fresh pass: new@example.test";
    const first=await f.adapter.resolve(f.context,[f.source.id],[old.extractionArtifactId],"new-redo-operation",{fresh:true});
    assert.equal(f.state.executions,2);assert.equal(first[0].state,"extracted");
    const result=first[0] as Extract<typeof first[number],{state:"extracted"}>;
    assert.notEqual(result.extractionArtifactId,old.extractionArtifactId);assert.equal(result.executionOperationId,"new-redo-operation");
    assert.match(result.text,/new@example/);assert.equal((await f.access.result(f.documentContext,result.extractionArtifactId)).mode,"ocr");
    const repeated=await f.adapter.resolve(f.context,[f.source.id],[old.extractionArtifactId],"new-redo-operation",{fresh:true});
    assert.deepEqual(repeated,first);assert.equal(f.state.executions,2);
    const next=await f.adapter.resolve(f.context,[f.source.id],[result.extractionArtifactId],"another-redo-operation",{fresh:true});
    assert.equal(f.state.executions,3);assert.notEqual((next[0] as any).extractionArtifactId,result.extractionArtifactId);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("failed fresh OCR does not fall back to an older successful extraction",async()=>{
  const f=await fixture();try{
    const old=await f.documents.extract(f.documentContext,{artifactId:f.source.id,operationId:"prior-successful-ocr"});
    f.state.fail=true;
    const result=await f.adapter.resolve(f.context,[f.source.id],[old.extractionArtifactId],"failed-fresh-redo",{fresh:true});
    assert.equal(result[0].state,"failed");assert.equal(f.state.executions,2);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});
