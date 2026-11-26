import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {ContactsService,contactsMigrationSql,createContactsTools} from "../src/domains/contacts/index.ts";
import type {ContactPrincipal,ContactSource,ContactsSourceAccess,ContactsExtractionAccess} from "../src/domains/contacts/types.ts";

const id=(label:string)=>'artifact-'+createHash('sha256').update(label).digest('hex');
function context(overrides:Partial<ContactPrincipal>={}):ContactPrincipal{return {profileId:'alex',agentId:'main',conversationId:'conv-contacts',taskId:'task-contacts',audience:'private',
  canReadHousehold:true,canWriteHousehold:true,canEditContacts:true,sourcePromptId:'capture-prompt-1',...overrides};}
function fixtures(){
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON;'+contactsMigrationSql);
  const source:ContactSource={artifactId:id('front'),sha256:'a'.repeat(64),mimeType:'image/png',byteLength:100,filename:'front.png',
    audience:'private',ownerProfileId:'alex',conversationId:'conv-contacts',taskId:'task-contacts'};
  const port:ContactsSourceAccess={
    async inspect(principal,artifactId){return {...source,artifactId,ownerProfileId:principal.profileId};},
    async publishCardSource(principal,input,audience,operation){return {...input,artifactId:id(operation),audience,ownerProfileId:principal.profileId};},
  };
  const extractionText={value:'ocr@example.test\nCasey Example\nExample Company\n111-222-3333'};
  const extractions:ContactsExtractionAccess={async resolve(_principal,sourceIds,_requested,executionOperationId){return sourceIds.map(sourceArtifactId=>({state:'extracted',sourceArtifactId,sourceSha256:source.sha256,
    executionOperationId,extractionArtifactId:id('extraction:'+sourceArtifactId),text:extractionText.value,pageCount:1,warnings:[]}));}};
  return {db,source,port,extractions,extractionText,service:new ContactsService(db,port,extractions)};
}
function followup(contactId:string,revision:number,action:'revise'|'ocr_redo'|'change_audience'='revise',overrides:Partial<ContactPrincipal>={}):ContactPrincipal{
  return context({sourcePromptId:'followup-prompt-1',userPromptBinding:{promptId:'followup-prompt-1',conversationId:'conv-contacts',taskId:'task-contacts',targetContactId:contactId,expectedRevision:revision,allowedActions:[action]},...overrides});
}

test('an unreadable card commits a sparse shared contact and a truthful source receipt',async()=>{
  const {db,source,service}=fixtures();try{
    const result=await service.captureCard(context(),{operationId:'capture-unreadable',sourceArtifactIds:[source.artifactId]});
    assert.equal(result.receipt.saved,true);assert.equal(result.receipt.audience,'household');assert.equal(result.receipt.readableFieldCount,0);
    assert.equal(result.contact.sources.length,1);assert.deepEqual(result.contact.fields,{});assert.ok(result.receipt.warnings.some(item=>item.includes('No readable')));
    assert.equal('conversationId' in result.contact,false);assert.equal('taskId' in result.contact.sources[0],false);
  }finally{db.close();}
});

test('front/back remain distinct and exact replay never creates a second card',async()=>{
  const {db,source,service}=fixtures();try{
    const args={operationId:'capture-front-back',sourceArtifactIds:[source.artifactId,id('back')]};
    const saved=await service.captureCard(context(),args),replay=await service.captureCard(context(),args);
    assert.equal(replay.replayed,true);assert.equal(replay.contact.id,saved.contact.id);assert.notEqual(saved.contact.sources[0].artifactId,saved.contact.sources[1].artifactId);
    assert.equal(db.prepare('SELECT count(*) AS n FROM contact_cards').get()!.n,1);
    await assert.rejects(service.captureCard(context(),{...args,fields:{full_name:['Changed']}}),{code:'contacts_operation_conflict'});
  }finally{db.close();}
});

test('distinct intakes retain distinct records even when source bytes match',async()=>{
  const {db,source,service}=fixtures();try{
    const one=await service.captureCard(context(),{operationId:'capture-distinct-one',sourceArtifactIds:[source.artifactId]});
    const two=await service.captureCard(context(),{operationId:'capture-distinct-two',sourceArtifactIds:[source.artifactId]});
    assert.notEqual(one.contact.id,two.contact.id);assert.equal(db.prepare('SELECT count(*) AS n FROM contacts').get()!.n,2);
  }finally{db.close();}
});

test('operation receipt can resolve an uncertain response without replaying its effect',async()=>{
  const {db,source,service}=fixtures();try{
    const saved=await service.captureCard(context(),{operationId:'capture-receipt-lookup',sourceArtifactIds:[source.artifactId]});
    const status=service.operationStatus(context(),saved.receipt.operationId);
    assert.equal(status!.state,'committed');assert.equal(status!.receipt.contactId,saved.contact.id);assert.equal(status!.currentRevision,1);
    assert.equal(service.operationStatus(context({profileId:'natasha'}),saved.receipt.operationId),null);
    assert.equal(db.prepare('SELECT count(*) AS n FROM contacts').get()!.n,1);
  }finally{db.close();}
});

test('unsupported initial fields do not prevent source capture or become invented saved facts',async()=>{
  const {db,source,service}=fixtures();try{
    const saved=await service.captureCard(context(),{operationId:'capture-no-evidence',sourceArtifactIds:[source.artifactId],fields:{full_name:['Unsupported Name']}});
    assert.deepEqual(saved.contact.fields,{});assert.ok(saved.receipt.warnings.some(item=>item.includes('unsupported')));
  }finally{db.close();}
});

test('a later human correction is CAS revisioned and preserves initial evidence',async()=>{
  const {db,source,service}=fixtures();try{
    const saved=await service.captureCard(context(),{operationId:'capture-evidence',sourceArtifactIds:[source.artifactId],fields:{email:['ocr@example.test']},
      observations:[{field:'email',value:'ocr@example.test',sourceArtifactId:source.artifactId,quote:'ocr@example.test',confidence:.7}]});
    const revised=service.revise(followup(saved.contact.id,1),{operationId:'correct-email',contactId:saved.contact.id,expectedRevision:1,fields:{email:['corrected@example.test']},reason:'correction'});
    assert.equal(revised.contact.currentRevision,2);assert.deepEqual(revised.contact.fields.email,['corrected@example.test']);
    assert.deepEqual(service.revisions(context(),saved.contact.id).items.map(item=>item.fields.email),[['corrected@example.test'],['ocr@example.test']]);
    assert.throws(()=>service.revise(followup(saved.contact.id,1),{operationId:'stale-correction',contactId:saved.contact.id,expectedRevision:1,fields:{},reason:'correction'}),{code:'contact_revision_conflict'});
  }finally{db.close();}
});

test('capture prompt and background work cannot rewrite a reported contact',async()=>{
  const {db,source,service}=fixtures();try{
    const saved=await service.captureCard(context(),{operationId:'capture-no-rewrite',sourceArtifactIds:[source.artifactId]});
    const args={operationId:'rewrite-original',contactId:saved.contact.id,expectedRevision:1,fields:{full_name:['New']},reason:'correction' as const};
    assert.throws(()=>service.revise(context(),args),{code:'contact_user_prompt_binding_required'});
    const origin=context({userPromptBinding:{promptId:'capture-prompt-1',conversationId:'conv-contacts',taskId:'task-contacts',targetContactId:saved.contact.id,expectedRevision:1,allowedActions:['revise']}});
    assert.throws(()=>service.revise(origin,args),{code:'contact_followup_prompt_required'});
    assert.equal(service.get(context(),saved.contact.id).currentRevision,1);
  }finally{db.close();}
});

test('redo requires source-bound observations and never erases the previous revision on failure',async()=>{
  const {db,source,service}=fixtures();try{
    const saved=await service.captureCard(context(),{operationId:'capture-before-redo',sourceArtifactIds:[source.artifactId]});
    assert.throws(()=>service.revise(followup(saved.contact.id,1,'ocr_redo'),{operationId:'redo-without-evidence',contactId:saved.contact.id,expectedRevision:1,fields:{full_name:['Guess']},reason:'ocr_redo'}),{code:'contact_redo_evidence_required'});
    assert.equal(service.get(context(),saved.contact.id).currentRevision,1);
  }finally{db.close();}
});

test('private contact/history stay private while only the current revision is deliberately shared',async()=>{
  const {db,source,service}=fixtures();try{
    const saved=await service.captureCard(context(),{operationId:'capture-private-card',sourceArtifactIds:[source.artifactId],audience:'private'});
    const other=context({profileId:'natasha',agentId:'natasha',canWriteHousehold:false,canEditContacts:false});
    assert.throws(()=>service.get(other,saved.contact.id),{code:'contact_not_found'});
    const shared=await service.changeAudience(followup(saved.contact.id,1,'change_audience'),{operationId:'share-current-card',contactId:saved.contact.id,expectedRevision:1,audience:'household'});
    assert.equal(service.get(other,shared.contact.id).audience,'household');
    assert.deepEqual(service.revisions(other,shared.contact.id).items.map(item=>item.revision),[2]);
    assert.equal(service.authorizeSource(other,shared.contact.sources[0].artifactId),true);
    assert.equal(service.authorizeSource(other,saved.contact.sources[0].artifactId),false);
  }finally{db.close();}
});

test('a revoked task cannot commit after asynchronous source publication',async()=>{
  const {db,source,port}=fixtures();try{
    let active=true;const original=port.publishCardSource;
    port.publishCardSource=async(...args)=>{const published=await original(...args);active=false;return published;};
    const service=new ContactsService(db,port),principal=context({assertCurrent(){if(!active)throw Object.assign(Error('revoked'),{code:'operation_cancelled'});}});
    await assert.rejects(service.captureCard(principal,{operationId:'capture-revoked',sourceArtifactIds:[source.artifactId]}),{code:'operation_cancelled'});
    assert.equal(db.prepare('SELECT count(*) AS n FROM contacts').get()!.n,0);
  }finally{db.close();}
});

test('write tool receipts remain bounded even for worst-case escaped field and warning content',async()=>{
  const {db,source,service,extractionText}=fixtures();try{
    const names=['full_name','organization','job_title','email','phone','website','address','notes'] as const;
    const fields=Object.fromEntries(names.map(name=>[name,Array.from({length:12},(_,index)=>String(index)+'\u0001'.repeat(1198))]));
    const observations=names.flatMap(field=>fields[field].map(value=>({field,value,sourceArtifactId:source.artifactId})));
    extractionText.value=Object.values(fields).flat().join('\n');
    const result=await createContactsTools(service).execute('contacts.capture_card',{operationId:'capture-bounded-result',sourceArtifactIds:[source.artifactId],fields,observations,
      uncertainties:Array.from({length:100},(_,index)=>String(index)+'\u0001'.repeat(990))},context()) as {contact:{fieldsTruncated:boolean};receipt:{warningsTruncated:boolean}};
    assert.ok(Buffer.byteLength(JSON.stringify(result))<128*1024);assert.equal(result.contact.fieldsTruncated,true);assert.equal(result.receipt.warningsTruncated,true);
  }finally{db.close();}
});

test('a household context cannot read even its owner private contacts or private operation receipts',async()=>{
  const {db,source,service}=fixtures();try{
    const saved=await service.captureCard(context(),{operationId:'capture-private-context-test',sourceArtifactIds:[source.artifactId],audience:'private',uncertainties:['private note']});
    const shared=context({audience:'household'});
    assert.throws(()=>service.get(shared,saved.contact.id),{code:'contact_not_found'});
    assert.deepEqual(service.search(shared,{query:''}).items,[]);
    assert.equal(service.authorizeSource(shared,saved.contact.sources[0].artifactId),false);
    await service.changeAudience(followup(saved.contact.id,1,'change_audience'),{operationId:'publish-current-record',contactId:saved.contact.id,expectedRevision:1,audience:'household'});
    assert.deepEqual(service.revisions(shared,saved.contact.id).items.map(item=>item.revision),[2]);
    assert.equal(service.revisions(shared,saved.contact.id).items[0].promptId,null);
    assert.throws(()=>service.operationStatus(shared,saved.receipt.operationId),{code:'contact_operation_private_context_required'});
    assert.equal(service.operationStatus(shared,'publish-current-record')!.receipt.audience,'household');
  }finally{db.close();}
});

test('private captures in shared context fail closed while the agreed default-shared card capture works',async()=>{
  const {db,source,service}=fixtures();try{
    const shared=context({audience:'household'});
    await assert.rejects(service.captureCard(shared,{operationId:'capture-private-in-shared',sourceArtifactIds:[source.artifactId],audience:'private'}),{code:'contact_private_conversation_required'});
    assert.equal(db.prepare('SELECT count(*) AS n FROM contacts').get()!.n,0);
    const saved=await service.captureCard(shared,{operationId:'capture-shared-card',sourceArtifactIds:[source.artifactId]});
    assert.equal(saved.receipt.audience,'household');assert.equal(service.get(shared,saved.contact.id).id,saved.contact.id);
  }finally{db.close();}
});


test('a field patch preserves unrelated fields, observations, uncertainties and history',async()=>{
  const {db,source,service}=fixtures();try{
    const saved=await service.captureCard(context(),{operationId:'capture-patch-base',sourceArtifactIds:[source.artifactId],
      fields:{full_name:['Casey Example'],organization:['Example Company'],email:['ocr@example.test']},uncertainties:['Phone absent']});
    const revised=service.revise(followup(saved.contact.id,1),{operationId:'patch-email-only',contactId:saved.contact.id,
      patch:{set:{email:['corrected@example.test']}},reason:'correction'});
    assert.deepEqual(revised.contact.fields,{full_name:['Casey Example'],organization:['Example Company'],email:['corrected@example.test']});
    assert.equal(revised.contact.observations.length,2);assert.ok(revised.contact.observations.every(item=>item.field!=='email'));
    assert.deepEqual(revised.contact.uncertainties,['Phone absent']);assert.equal(service.revisions(context(),saved.contact.id).items.length,2);
    assert.equal(service.revise(followup(saved.contact.id,1),{operationId:'patch-email-only',contactId:saved.contact.id,
      patch:{set:{email:['corrected@example.test']}},reason:'correction'}).replayed,true);
    assert.throws(()=>service.revise(followup(saved.contact.id,1),{operationId:'patch-stale-mail',contactId:saved.contact.id,
      patch:{remove:['email']},reason:'correction'}),{code:'contact_revision_conflict'});
  }finally{db.close();}
});

test('patch removal affects only the explicitly named field and requires later human authority',async()=>{
  const {db,source,service}=fixtures();try{
    const saved=await service.captureCard(context(),{operationId:'capture-remove-base',sourceArtifactIds:[source.artifactId],fields:{full_name:['Casey Example'],email:['ocr@example.test']}});
    const input={operationId:'patch-remove-email',contactId:saved.contact.id,expectedRevision:1,patch:{remove:['email'] as const},reason:'correction' as const};
    assert.throws(()=>service.revise(context(),input as any),{code:'contact_user_prompt_binding_required'});
    const revised=service.revise(followup(saved.contact.id,1),input as any);
    assert.deepEqual(revised.contact.fields,{full_name:['Casey Example']});
  }finally{db.close();}
});

test('repeating a field as a model observation cannot replace owning extraction evidence',async()=>{
  const {db,source,port}=fixtures();try{
    const service=new ContactsService(db,port);
    const saved=await service.captureCard(context(),{operationId:'capture-no-owning-ocr',sourceArtifactIds:[source.artifactId],fields:{email:['invented@example.test']},
      observations:[{field:'email',value:'invented@example.test',sourceArtifactId:source.artifactId,quote:'invented@example.test'}]});
    assert.deepEqual(saved.contact.fields,{});assert.equal(saved.receipt.scanState,'extraction_unavailable');
    assert.equal(saved.contact.sources.length,1);assert.equal(saved.receipt.extraction?.[0].state,'unavailable');
  }finally{db.close();}
});

test('owning extraction verifies exact evidence while allowing a normalized field',async()=>{
  const {db,source,service,extractionText}=fixtures();try{
    extractionText.value='Telephone: (111) 222-3333';
    const saved=await service.captureCard(context(),{operationId:'capture-normalized-phone',sourceArtifactIds:[source.artifactId],fields:{phone:['111-222-3333']},
      observations:[{field:'phone',value:'111-222-3333',sourceArtifactId:source.artifactId,quote:'(111) 222-3333'}]});
    assert.deepEqual(saved.contact.fields.phone,['111-222-3333']);assert.match(saved.contact.observations[0].extractionArtifactId!,/^artifact-/);
    assert.equal(saved.receipt.scanState,'fields_saved');
  }finally{db.close();}
});

test('wrong extraction source/hash and invented quote preserve the card without invented fields',async()=>{
  const {db,source,port}=fixtures();try{
    const extractions:ContactsExtractionAccess={async resolve(){return [{state:'extracted',sourceArtifactId:source.artifactId,sourceSha256:'b'.repeat(64),extractionArtifactId:id('forged-result'),text:'invented@example.test',pageCount:1,warnings:[]}];}};
    const service=new ContactsService(db,port,extractions),saved=await service.captureCard(context(),{operationId:'capture-wrong-ocr-source',sourceArtifactIds:[source.artifactId],
      fields:{email:['invented@example.test']},observations:[{field:'email',value:'invented@example.test',sourceArtifactId:source.artifactId,quote:'invented@example.test'}]});
    assert.deepEqual(saved.contact.fields,{});assert.equal(saved.contact.sources.length,1);assert.ok(saved.receipt.warnings.some(item=>item.includes('did not match')));
  }finally{db.close();}
});

test('an actual extraction failure still commits and reports the original card',async()=>{
  const {db,source,port}=fixtures();try{
    const service=new ContactsService(db,port,{async resolve(){throw Error('local reader failed');}});
    const saved=await service.captureCard(context(),{operationId:'capture-extraction-failed',sourceArtifactIds:[source.artifactId]});
    assert.equal(saved.receipt.saved,true);assert.equal(saved.receipt.scanState,'extraction_failed');assert.equal(saved.contact.sources.length,1);
  }finally{db.close();}
});

test('a requested OCR redo verifies owning extraction, preserves unrelated fields and replays exactly',async()=>{
  const {db,source,service,extractionText}=fixtures();try{
    const saved=await service.captureCard(context(),{operationId:'capture-before-owning-redo',sourceArtifactIds:[source.artifactId],fields:{full_name:['Casey Example'],email:['ocr@example.test']}});
    extractionText.value='Corrected email: updated@example.test';
    const principal=followup(saved.contact.id,1,'ocr_redo'),input={operationId:'redo-owning-extraction',contactId:saved.contact.id,expectedRevision:1,patch:{set:{email:['updated@example.test']}},reason:'ocr_redo'};
    const result=await createContactsTools(service).execute('contacts.revise',input,principal) as any;
    assert.deepEqual(result.contact.fields,{full_name:['Casey Example'],email:['updated@example.test']});assert.equal(result.receipt.revision,2);
    assert.ok(service.get(context(),saved.contact.id).observations.some(item=>item.field==='email'&&item.extractionArtifactId));
    const replay=await createContactsTools(service).execute('contacts.revise',input,principal) as any;
    assert.equal(replay.replayed,true);assert.equal(service.revisions(context(),saved.contact.id).items.length,2);
  }finally{db.close();}
});


test('OCR redo refuses a trusted adapter result that lacks the current redo-operation provenance',async()=>{
  const f=fixtures();try{
    const saved=await f.service.captureCard(context(),{operationId:'capture-before-stale-redo',sourceArtifactIds:[f.source.artifactId],fields:{email:['ocr@example.test']}});
    const resolve=f.extractions.resolve.bind(f.extractions);
    f.extractions.resolve=async(...args)=>{const result=await resolve(...args);return result.map(item=>{if(item.state!=='extracted')return item;const {executionOperationId,...stale}=item;return stale;});};
    await assert.rejects(()=>f.service.redo(followup(saved.contact.id,1,'ocr_redo'),{operationId:'redo-stale-owning-evidence',contactId:saved.contact.id,expectedRevision:1,patch:{set:{email:['ocr@example.test']}},reason:'ocr_redo'}),{code:'contact_redo_evidence_required'});
    assert.equal(f.service.get(context(),saved.contact.id).currentRevision,1);
  }finally{f.db.close();}
});
