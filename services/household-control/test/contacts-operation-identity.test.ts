import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {ContactsService,contactsMigrationSql,contactsToolDescriptors} from "../src/domains/contacts/index.ts";
import type {ContactPrincipal,ContactSource,ContactsSourceAccess,ContactsExtractionAccess} from "../src/domains/contacts/types.ts";
import {nativeOperationId} from "../src/domain-runtime/operation-id.ts";

const artifact=(value:string)=>"artifact-"+createHash("sha256").update(value).digest("hex");
const captureDescriptor=contactsToolDescriptors.find(tool=>tool.name==="contacts.capture_card")!;
const reviseDescriptor=contactsToolDescriptors.find(tool=>tool.name==="contacts.revise")!;
const capture={...captureDescriptor,nativeName:"household_contacts_capture_card"};
const revise={...reviseDescriptor,nativeName:"household_contacts_revise"};
function principal(sourcePromptId="human-intake-1",contactId?:string,revision=1):ContactPrincipal{return {profileId:"alex",agentId:"main",conversationId:"conv-card",taskId:"task-card",audience:"private",
  canReadHousehold:true,canWriteHousehold:true,canEditContacts:true,sourcePromptId,
  ...(contactId?{userPromptBinding:{promptId:sourcePromptId,conversationId:"conv-card",taskId:"task-card",targetContactId:contactId,expectedRevision:revision,allowedActions:["revise" as const]}}:{})};}
function fixture(){
  const database=new DatabaseSync(":memory:");database.exec("PRAGMA foreign_keys=ON;"+contactsMigrationSql);
  const source:ContactSource={artifactId:artifact("card"),sha256:"a".repeat(64),mimeType:"application/pdf",byteLength:100,filename:"card.pdf",audience:"private",ownerProfileId:"alex",conversationId:"conv-card",taskId:"task-card"};
  const sources:ContactsSourceAccess={async inspect(_principal,id){return {...source,artifactId:id};},async publishCardSource(_principal,item,audience,operationId){return {...item,artifactId:artifact(operationId),audience};}};
  const extractions:ContactsExtractionAccess={async resolve(_principal,ids){return ids.map(sourceArtifactId=>({state:"extracted",sourceArtifactId,sourceSha256:source.sha256,
    extractionArtifactId:artifact("extraction:"+sourceArtifactId),text:"Casey Example",pageCount:1,warnings:[]}));}};
  return {database,source,service:new ContactsService(database,sources,extractions)};
}

test("Contacts declares intake and revision identity independently of interpretation details",()=>{
  assert.deepEqual(capture.operationIdentity,{fields:["sourceArtifactIds","audience"],defaults:{audience:"household"}});
  assert.deepEqual(revise.operationIdentity,{fields:["contactId","reason"]});
  const first={sourceArtifactIds:[artifact("card")],fields:{full_name:["Casey Example"]}};
  const changed={...first,audience:"household",fields:{full_name:["Changed interpretation"]},extractionArtifactIds:[artifact("new-ocr")],observations:[]};
  assert.equal(nativeOperationId("human-intake-1",capture,first),nativeOperationId("human-intake-1",capture,changed));
  assert.notEqual(nativeOperationId("human-intake-1",capture,first),nativeOperationId("human-intake-2",capture,first));
  assert.notEqual(nativeOperationId("human-intake-1",capture,first),nativeOperationId("human-intake-1",capture,{...first,audience:"private"}));
});

test("changed interpretation of the same intake conflicts instead of creating a duplicate contact",async()=>{
  const f=fixture();try{
    const first={sourceArtifactIds:[f.source.artifactId],fields:{full_name:["Casey Example"]}};
    const changed={...first,fields:{full_name:["Changed interpretation"]},extractionArtifactIds:[artifact("later-result")]};
    const operationId=nativeOperationId("human-intake-1",capture,first);
    await f.service.captureCard(principal(),{...first,operationId});
    await assert.rejects(()=>f.service.captureCard(principal(),{...changed,operationId:nativeOperationId("human-intake-1",capture,changed)}),{code:"contacts_operation_conflict"});
    assert.equal(f.database.prepare("SELECT count(*) AS n FROM contacts").get()!.n,1);
    const later=await f.service.captureCard(principal("human-intake-2"),{...first,operationId:nativeOperationId("human-intake-2",capture,first)});
    assert.equal(later.receipt.saved,true);assert.equal(f.database.prepare("SELECT count(*) AS n FROM contacts").get()!.n,2);
  }finally{f.database.close();}
});

test("one human correction has a stable identity across patch, revision and OCR-handle changes",async()=>{
  const f=fixture();try{
    const saved=await f.service.captureCard(principal(),{operationId:"capture-revision-key",sourceArtifactIds:[f.source.artifactId],fields:{full_name:["Casey Example"]}});
    const first={contactId:saved.contact.id,reason:"correction" as const,expectedRevision:1,patch:{set:{email:["first@example.test"]}}};
    const changed={...first,expectedRevision:2,patch:{set:{email:["changed@example.test"]}},extractionArtifactIds:[artifact("new-result")]};
    const operationId=nativeOperationId("human-reply-1",revise,first);
    assert.equal(operationId,nativeOperationId("human-reply-1",revise,changed));
    f.service.revise(principal("human-reply-1",saved.contact.id,1),{...first,operationId});
    assert.throws(()=>f.service.revise(principal("human-reply-1",saved.contact.id,2),{...changed,operationId:nativeOperationId("human-reply-1",revise,changed)}),{code:"contacts_operation_conflict"});
    assert.deepEqual(f.service.get(principal(),saved.contact.id).fields.email,["first@example.test"]);
    const later=f.service.revise(principal("human-reply-2",saved.contact.id,2),{...changed,operationId:nativeOperationId("human-reply-2",revise,changed)});
    assert.equal(later.receipt.revision,3);assert.deepEqual(later.contact.fields.email,["changed@example.test"]);
  }finally{f.database.close();}
});

test("an explicit operation key permits an intentional distinct intake without a router exception",async()=>{
  const f=fixture();try{
    const args={sourceArtifactIds:[f.source.artifactId],fields:{full_name:["Casey Example"]}};
    await f.service.captureCard(principal(),{...args,operationId:nativeOperationId("human-intake-1",capture,args)});
    const explicit={...args,operationId:"intentional-second-intake"};
    assert.equal(nativeOperationId("human-intake-1",capture,explicit),explicit.operationId);
    await f.service.captureCard(principal(),{...args,operationId:nativeOperationId("human-intake-1",capture,explicit)});
    assert.equal(f.database.prepare("SELECT count(*) AS n FROM contacts").get()!.n,2);
  }finally{f.database.close();}
});
