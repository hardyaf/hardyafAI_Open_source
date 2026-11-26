import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DocumentsService,ArtifactDocumentAccess} from "../src/domains/documents/index.ts";
import {ArtifactStore} from "../src/platform/artifacts.ts";
import type {DocumentArtifacts,DocumentExtractor,DocumentPrincipal,SavedExtraction} from "../src/domains/documents/types.ts";

const artifactId='artifact-'+'a'.repeat(64);
const principal:DocumentPrincipal={profileId:'alex',agentId:'main',conversationId:'conv-documents',taskId:'task-documents',audience:'private',canReadHousehold:true,canProcessDocuments:true};
function fixtures(){
  const saved=new Map<string,{artifactId:string;result:SavedExtraction}>();let reads=0;
  const bytes=Buffer.from('%PDF-test');const digest=createHash('sha256').update(bytes).digest('hex');
  const artifacts:DocumentArtifacts={
    async source(context,id){context.assertCurrent?.();reads++;if(id!==artifactId)throw Object.assign(Error('scope'),{code:'document_artifact_scope_mismatch'});return {artifactId:id,sha256:digest,mimeType:'application/pdf',byteLength:bytes.length,bytes};},
    async find(_context,operation){return saved.get(operation);},
    async publish(_context,operation,result){const output={artifactId:'artifact-'+'b'.repeat(64),result};saved.set(operation,output);return output;},
    async result(_context,id){const item=[...saved.values()].find(item=>item.artifactId===id);if(!item)throw Error('missing');return item.result;},
  };
  let executions=0;
  const extractor:DocumentExtractor={async readiness(){return {status:'configured',detail:'test'};},async extract(){executions++;return {engine:'local-test',pageCount:1,sourceSha256:digest,text:'untrusted document text',structured:{pages:[]},warnings:[]};}};
  return {artifacts,extractor,service:new DocumentsService(artifacts,extractor),saved,get executions(){return executions;},get reads(){return reads;}};
}

test('local extraction returns immutable references and replay authorizes source without another OCR run',async()=>{
  const f=fixtures();const args={operationId:'extract-one',artifactId};
  const first=await f.service.extract(principal,args),replay=await f.service.extract(principal,args);
  assert.equal(first.trust,'untrusted_document_data');assert.equal(replay.replayed,true);assert.equal(f.executions,1);assert.equal(f.reads,2);
  assert.equal('markdown_path' in first,false);assert.equal('conversationId' in first,false);
  await assert.rejects(f.service.extract(principal,{...args,mode:'ocr'}),{code:'document_operation_conflict'});
});

test('bounded extraction read keeps source provenance and does not interpret downstream fields',async()=>{
  const f=fixtures();const first=await f.service.extract(principal,{operationId:'extract-read',artifactId});
  const part=await f.service.readExtraction(principal,{artifactId:first.extractionArtifactId,offset:0,limit:9});
  assert.equal(part.text,'untrusted');assert.equal(part.sourceArtifactId,artifactId);assert.equal(part.nextOffset,9);
  assert.equal('contacts' in part,false);assert.equal('accepted' in part,false);
});

test('task revocation after extraction prevents publication',async()=>{
  const f=fixtures();let active=true;const original=f.extractor.extract;
  f.extractor.extract=async(...args)=>{const result=await original(...args);active=false;return result;};
  const context={...principal,assertCurrent(){if(!active)throw Object.assign(Error('revoked'),{code:'operation_cancelled'});}};
  await assert.rejects(f.service.extract(context,{operationId:'extract-revoked',artifactId}),{code:'operation_cancelled'});assert.equal(f.saved.size,0);
});

test('a changed source hash from a reader cannot be published under the input identity',async()=>{
  const f=fixtures();const original=f.extractor.extract;
  f.extractor.extract=async(...args)=>({...await original(...args),sourceSha256:'c'.repeat(64)});
  await assert.rejects(f.service.extract(principal,{operationId:'extract-wrong-source',artifactId}),{code:'document_source_changed'});assert.equal(f.saved.size,0);
});

test('private inputs/extractions are not declassified by owner identity or explicit artifact IDs in shared context',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'hardy-document-privacy-'));
  try{
    const artifacts=new ArtifactStore({root:join(directory,'artifacts')});await artifacts.initialize();
    const source=await artifacts.put({ownerProfileId:principal.profileId,conversationId:principal.conversationId,taskId:principal.taskId,audience:'private'},
      {profileId:principal.profileId,canReadHousehold:true},{bytes:Buffer.from('%PDF-test'),filename:'private.pdf',mimeType:'application/pdf',kind:'input',idempotencyKey:'private-document-source'});
    let executions=0;
    const extractor:DocumentExtractor={async readiness(){return {status:'configured',detail:'test only'};},async extract(input){executions++;return {engine:'local-test',pageCount:1,sourceSha256:input.sha256,text:'private body',structured:{},warnings:[]};}};
    const service=new DocumentsService(new ArtifactDocumentAccess(artifacts),extractor);
    const shared={...principal,audience:'household' as const,allowedArtifactIds:[source.id]};
    await assert.rejects(service.extract(shared,{operationId:'shared-private-extract',artifactId:source.id}),{code:'document_private_context_required'});assert.equal(executions,0);
    const extracted=await service.extract(principal,{operationId:'private-extract',artifactId:source.id});
    await assert.rejects(service.readExtraction({...shared,allowedArtifactIds:[source.id,extracted.extractionArtifactId]},{artifactId:extracted.extractionArtifactId}),{code:'document_private_context_required'});
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('shared source may be analyzed privately and that output remains private',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'hardy-document-audience-'));
  try{
    const artifacts=new ArtifactStore({root:join(directory,'artifacts')});await artifacts.initialize();
    const source=await artifacts.put({ownerProfileId:principal.profileId,conversationId:principal.conversationId,taskId:principal.taskId,audience:'household'},
      {profileId:principal.profileId,canReadHousehold:true},{bytes:Buffer.from('%PDF-test'),filename:'shared.pdf',mimeType:'application/pdf',kind:'input',idempotencyKey:'shared-document-source'});
    const extractor:DocumentExtractor={async readiness(){return {status:'configured',detail:'test only'};},async extract(input){return {engine:'local-test',pageCount:1,sourceSha256:input.sha256,text:'private analysis of shared source',structured:{},warnings:[]};}};
    const service=new DocumentsService(new ArtifactDocumentAccess(artifacts),extractor);
    const extracted=await service.extract(principal,{operationId:'private-output-extract',artifactId:source.id});
    const metadata=await artifacts.get(extracted.extractionArtifactId,{profileId:principal.profileId,canReadHousehold:true});assert.equal(metadata.audience,'private');
    await assert.rejects(service.readExtraction({...principal,audience:'household',allowedArtifactIds:[extracted.extractionArtifactId,source.id]},{artifactId:extracted.extractionArtifactId}),{code:'document_private_context_required'});
  }finally{await rm(directory,{recursive:true,force:true});}
});
