import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ContactsError } from "./types.ts";
import type { CaptureCardInput, ContactAudience, ContactFields, ContactMutationResult, ContactObservation, ContactPrincipal, ContactRecord, ContactRevision, ContactExtractionSummary, ContactsSourceAccess, ContactsExtractionAccess, ReviseContactInput } from "./types.ts";
import { groundCardFields } from "./extraction-evidence.ts";
import { contactFieldNames } from "./types.ts";
import { artifactIdPattern, assertKeys, assertOperation, assertPrincipal, assertPrompt, assertRevision, contactIdPattern, fields, observationFields, observationInputs, observations, uncertainties } from "./validation.ts";

type Row = Record<string,unknown>;
type Connection = Pick<DatabaseSync,"prepare"|"exec">;
function hash(value:string):string{return createHash("sha256").update(value).digest("hex");}
function canonical(value:unknown):string{
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.entries(value).filter(([,item])=>item!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>JSON.stringify(key)+':'+canonical(item)).join(',')+'}';
  return JSON.stringify(value)??'null';
}
function countFields(value:ContactFields){return Object.values(value).reduce((total,items)=>total+(items?.length??0),0);}

/** Canonical contact authority; receives the application's existing SQLite connection. */
export class ContactsService {
  private readonly db:Connection;
  private readonly sources:ContactsSourceAccess;
  private readonly extractions?:ContactsExtractionAccess;
  constructor(db:Connection,sources:ContactsSourceAccess,extractions?:ContactsExtractionAccess){this.db=db;this.sources=sources;this.extractions=extractions;}

  private transaction<T>(action:()=>T):T{
    this.db.exec('BEGIN IMMEDIATE');
    try{const result=action();this.db.exec('COMMIT');return result;}
    catch(error){try{this.db.exec('ROLLBACK');}catch{}throw error;}
  }
  private readable(principal:ContactPrincipal,row:Row):boolean{
    if(principal.audience==='household')return row.audience==='household'&&principal.canReadHousehold;
    return row.owner_profile_id===principal.profileId||row.audience==='household'&&principal.canReadHousehold;
  }
  private contactRow(principal:ContactPrincipal,id:string,write=false):Row{
    assertPrincipal(principal,write);
    if(!contactIdPattern.test(id))throw new ContactsError('contact_not_found',404);
    const row=this.db.prepare('SELECT * FROM contacts WHERE id=?').get(id) as Row|undefined;
    if(!row||!this.readable(principal,row))throw new ContactsError('contact_not_found',404);
    if(write&&row.owner_profile_id!==principal.profileId&&!(row.audience==='household'&&principal.canWriteHousehold))throw new ContactsError('contact_write_not_authorized',403);
    return row;
  }
  private current(row:Row):ContactRecord{
    const revision=this.db.prepare('SELECT * FROM contact_revisions WHERE contact_id=? AND revision=?').get(String(row.id),Number(row.current_revision)) as Row|undefined;
    if(!revision)throw new ContactsError('contacts_state_unavailable',503);
    const sources=(this.db.prepare('SELECT artifact_id,sha256,mime_type,byte_length,filename FROM contact_card_sources WHERE card_id=? ORDER BY ordinal').all(String(row.card_id)) as Row[]).map(source=>({
      artifactId:String(source.artifact_id),sha256:String(source.sha256),mimeType:String(source.mime_type),byteLength:Number(source.byte_length),filename:String(source.filename),
    }));
    return {id:String(row.id),cardId:String(row.card_id),ownerProfileId:String(row.owner_profile_id),audience:row.audience as ContactAudience,
      currentRevision:Number(row.current_revision),createdAt:String(row.created_at),updatedAt:String(row.updated_at),
      fields:JSON.parse(String(revision.fields_json)),observations:JSON.parse(String(revision.observations_json)),uncertainties:JSON.parse(String(revision.uncertainties_json)),sources};
  }
  get(principal:ContactPrincipal,id:string):ContactRecord{return this.current(this.contactRow(principal,id));}

  authorizeSource(principal:ContactPrincipal,artifactId:string):boolean{
    assertPrincipal(principal);
    if(!artifactIdPattern.test(artifactId))return false;
    return Boolean(this.db.prepare(`SELECT c.id FROM contact_card_sources s JOIN contacts c ON c.card_id=s.card_id
      WHERE s.artifact_id=? AND (c.owner_profile_id=? OR (c.audience='household' AND ?=1)) AND (?=0 OR c.audience='household') LIMIT 1`).get(artifactId,principal.profileId,principal.canReadHousehold?1:0,principal.audience==='household'?1:0));
  }

  operationStatus(principal:ContactPrincipal,operationId:string):{state:'committed';receipt:ContactMutationResult['receipt'];currentRevision:number;currentAudience:ContactAudience}|null{
    assertPrincipal(principal);assertOperation(operationId);
    const operation=this.db.prepare('SELECT contact_id,response_json FROM contact_operations WHERE actor_profile_id=? AND operation_id=?').get(principal.profileId,operationId) as Row|undefined;
    if(!operation)return null;
    const current=this.contactRow(principal,String(operation.contact_id));
    const saved=JSON.parse(String(operation.response_json)) as ContactMutationResult;
    if(principal.audience==='household'&&saved.receipt.audience!=='household')throw new ContactsError('contact_operation_private_context_required',403);
    return {state:'committed',receipt:saved.receipt,currentRevision:Number(current.current_revision),currentAudience:current.audience as ContactAudience};
  }

  search(principal:ContactPrincipal,input:{query:string;limit?:number;offset?:number}){
    assertPrincipal(principal);
    assertKeys(input,['query','limit','offset']);
    if(typeof input.query!=='string'||input.query.length>300||input.query.includes('\u0000')||
      input.limit!==undefined&&(!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>50)||
      input.offset!==undefined&&(!Number.isSafeInteger(input.offset)||input.offset<0||input.offset>10000))throw new ContactsError('contact_search_invalid',400);
    const term='%'+input.query.trim().replace(/[\\%_]/g,'\\$&')+'%';
    const rows=this.db.prepare(`SELECT c.* FROM contacts c JOIN contact_revisions r ON r.contact_id=c.id AND r.revision=c.current_revision
      WHERE (c.owner_profile_id=? OR (c.audience='household' AND ?=1)) AND (?=0 OR c.audience='household') AND r.fields_json LIKE ? ESCAPE '\\'
      ORDER BY c.updated_at DESC,c.id LIMIT ? OFFSET ?`).all(principal.profileId,principal.canReadHousehold?1:0,principal.audience==='household'?1:0,term,(input.limit??20)+1,input.offset??0) as Row[];
    const limit=input.limit??20;return {items:rows.slice(0,limit).map(row=>this.current(row)),hasMore:rows.length>limit,nextOffset:rows.length>limit?(input.offset??0)+limit:null};
  }

  revisions(principal:ContactPrincipal,id:string,limit=30):{items:ContactRevision[];truncated:boolean}{
    const contact=this.contactRow(principal,id);
    if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new ContactsError('contact_limit_invalid',400);
    const rows=this.db.prepare("SELECT * FROM contact_revisions WHERE contact_id=? AND (?=1 OR audience='household') ORDER BY revision DESC LIMIT ?").all(id,contact.owner_profile_id===principal.profileId&&principal.audience==='private'?1:0,limit+1) as Row[];
    return {items:rows.slice(0,limit).map(row=>({revision:Number(row.revision),fields:JSON.parse(String(row.fields_json)),observations:JSON.parse(String(row.observations_json)),
      uncertainties:JSON.parse(String(row.uncertainties_json)),reason:row.reason as ContactRevision['reason'],actorProfileId:String(row.actor_profile_id),
      promptId:principal.audience==='private'&&row.actor_profile_id===principal.profileId&&row.prompt_id!==null?String(row.prompt_id):null,createdAt:String(row.created_at)})),truncated:rows.length>limit};
  }

  private replay(principal:ContactPrincipal,operationId:string,fingerprint:string):ContactMutationResult|undefined{
    const row=this.db.prepare('SELECT * FROM contact_operations WHERE actor_profile_id=? AND operation_id=?').get(principal.profileId,operationId) as Row|undefined;
    if(!row)return undefined;
    if(row.request_hash!==fingerprint)throw new ContactsError('contacts_operation_conflict',409);
    this.contactRow(principal,String(row.contact_id),true);
    return {...JSON.parse(String(row.response_json)),replayed:true};
  }
  private fingerprint(principal:ContactPrincipal,kind:string,input:unknown):string{
    return hash(canonical({actor:principal.profileId,conversation:principal.conversationId,task:principal.taskId,prompt:principal.sourcePromptId,kind,input}));
  }
  private recordOperation(principal:ContactPrincipal,operationId:string,fingerprint:string,record:ContactRecord,warnings:string[]):ContactMutationResult{
    const result:ContactMutationResult={receipt:{operationId,contactId:record.id,cardId:record.cardId,revision:record.currentRevision,audience:record.audience,saved:true,
      readableFieldCount:countFields(record.fields),warnings},contact:record,replayed:false};
    this.db.prepare('INSERT INTO contact_operations(actor_profile_id,operation_id,request_hash,contact_id,response_json,created_at) VALUES(?,?,?,?,?,?)')
      .run(principal.profileId,operationId,fingerprint,record.id,JSON.stringify(result),new Date().toISOString());
    return result;
  }
  private revision(contactId:string,revision:number,content:{fields:ContactFields;observations:ContactObservation[];uncertainties:string[]},reason:ContactRevision['reason'],audience:ContactAudience,principal:ContactPrincipal,at:string):void{
    this.db.prepare(`INSERT INTO contact_revisions(contact_id,revision,fields_json,observations_json,uncertainties_json,reason,audience,actor_profile_id,prompt_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(contactId,revision,JSON.stringify(content.fields),JSON.stringify(content.observations),JSON.stringify(content.uncertainties),reason,audience,principal.profileId,principal.sourcePromptId??null,at);
  }

  async captureCard(principal:ContactPrincipal,input:CaptureCardInput):Promise<ContactMutationResult>{
    assertKeys(input,['operationId','sourceArtifactIds','audience','fields','observations','uncertainties','extractionArtifactIds']);assertOperation(input.operationId);
    const audience=input.audience??'household';
    if(!['private','household'].includes(audience))throw new ContactsError('contact_audience_invalid',400);
    assertPrincipal(principal,true,audience);
    if(typeof principal.sourcePromptId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(principal.sourcePromptId))throw new ContactsError('contact_capture_prompt_required',403);
    if(!Array.isArray(input.sourceArtifactIds)||input.sourceArtifactIds.length<1||input.sourceArtifactIds.length>8||
      input.sourceArtifactIds.some(id=>typeof id!=='string'||!artifactIdPattern.test(id))||new Set(input.sourceArtifactIds).size!==input.sourceArtifactIds.length)throw new ContactsError('contact_sources_invalid',400);
    const originalObservations=observationInputs(input.observations,input.sourceArtifactIds);
    const proposed=input.fields===undefined?observationFields(originalObservations):fields(input.fields),warnings=uncertainties(input.uncertainties);
    if(input.extractionArtifactIds!==undefined&&(!Array.isArray(input.extractionArtifactIds)||input.extractionArtifactIds.length>16||input.extractionArtifactIds.some(id=>!artifactIdPattern.test(id))))throw new ContactsError('contact_extraction_references_invalid',400);
    const fingerprint=this.fingerprint(principal,'capture',input),existing=this.replay(principal,input.operationId,fingerprint);if(existing)return existing;
    const originals=[];
    for(const id of input.sourceArtifactIds)originals.push(await this.sources.inspect(principal,id));
    const grounded=await groundCardFields(principal,input.operationId,originals,proposed,originalObservations,input.extractionArtifactIds??[],this.extractions);
    const initialFields=grounded.fields;
    warnings.push(...grounded.warnings);
    if(!countFields(initialFields))warnings.push('No readable fields saved; original card sources are retained.');
    if(grounded.observations.some(item=>item.inferred))warnings.push('Some field observations are explicitly inferred.');
    const sourceItems=[];
    for(const source of originals){
      const published=await this.sources.publishCardSource(principal,source,audience,input.operationId+':'+sourceItems.length);
      if(published.audience!==audience||published.ownerProfileId!==principal.profileId||published.sha256!==source.sha256)throw new ContactsError('contact_source_projection_invalid',503);
      sourceItems.push({original:source.artifactId,source:published});
    }
    assertPrincipal(principal,true,audience);
    const mapping=new Map(sourceItems.map(item=>[item.original,item.source.artifactId]));
    const projectedObservations=grounded.observations.map(item=>({...item,sourceArtifactId:mapping.get(item.sourceArtifactId)!}));
    return this.transaction(()=>{
      assertPrincipal(principal,true,audience);
      const duplicate=this.replay(principal,input.operationId,fingerprint);if(duplicate)return duplicate;
      const suffix=hash(principal.profileId+'\n'+input.operationId).slice(0,32),cardId='card-'+suffix,contactId='contact-'+suffix,at=new Date().toISOString();
      this.db.prepare('INSERT INTO contact_cards(id,owner_profile_id,audience,origin_conversation_id,origin_task_id,origin_prompt_id,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(cardId,principal.profileId,audience,principal.conversationId,principal.taskId,principal.sourcePromptId,at);
      this.db.prepare('INSERT INTO contacts(id,card_id,owner_profile_id,audience,current_revision,created_at,updated_at) VALUES(?,?,?,?,1,?,?)').run(contactId,cardId,principal.profileId,audience,at,at);
      sourceItems.forEach((item,index)=>this.db.prepare('INSERT INTO contact_card_sources(card_id,ordinal,artifact_id,original_artifact_id,sha256,mime_type,byte_length,filename) VALUES(?,?,?,?,?,?,?,?)')
        .run(cardId,index,item.source.artifactId,item.original,item.source.sha256,item.source.mimeType,item.source.byteLength,item.source.filename));
      this.revision(contactId,1,{fields:initialFields,observations:projectedObservations,uncertainties:[...new Set(warnings)]},'initial_scan',audience,principal,at);
      const result=this.recordOperation(principal,input.operationId,fingerprint,this.get(principal,contactId),[...new Set(warnings)]);
      result.receipt.extraction=grounded.extraction;result.receipt.scanState=countFields(initialFields)?'fields_saved':grounded.extraction.some(item=>item.state==='extracted')?'source_saved_only':grounded.extraction.some(item=>item.state==='failed')?'extraction_failed':'extraction_unavailable';
      this.db.prepare('UPDATE contact_operations SET response_json=? WHERE actor_profile_id=? AND operation_id=?').run(JSON.stringify(result),principal.profileId,input.operationId);
      return result;
    });
  }

  revise(principal:ContactPrincipal,input:ReviseContactInput):ContactMutationResult{
    // Manual human corrections do not require OCR. A model-facing redo uses
    // redo() so repeated observations cannot stand in for an extraction owner.
    if(input.reason==='ocr_redo')throw new ContactsError('contact_redo_evidence_required',400);
    return this.reviseOwned(principal,input);
  }

  async redo(principal:ContactPrincipal,input:ReviseContactInput):Promise<ContactMutationResult>{
    assertPrincipal(principal,true);assertOperation(input.operationId);
    const expectedRevision=input.expectedRevision??principal.userPromptBinding?.expectedRevision;assertRevision(expectedRevision);
    assertPrompt(principal,input.contactId,expectedRevision,'ocr_redo');
    const fingerprint=this.fingerprint(principal,'revise',{...input,expectedRevision}),replayed=this.replay(principal,input.operationId,fingerprint);if(replayed)return replayed;
    const current=this.get(principal,input.contactId);
    if(current.currentRevision!==expectedRevision)throw new ContactsError('contact_revision_conflict',409);
    const evidence=observationInputs(input.observations,current.sources.map(source=>source.artifactId));
    const observationPatch=input.patch===undefined&&input.fields===undefined;
    const proposed=input.patch!==undefined?fields(input.patch.set??{}):input.fields!==undefined?fields(input.fields):observationFields(evidence);
    if(!countFields(proposed))throw new ContactsError('contact_redo_evidence_required',400);
    const originalSources=[];
    for(const source of current.sources)originalSources.push(await this.sources.inspect({...principal,allowedArtifactIds:[...(principal.allowedArtifactIds??[]),source.artifactId]},source.artifactId));
    const requested=input.extractionArtifactIds??[...new Set(evidence.flatMap(item=>item.extractionArtifactId?[item.extractionArtifactId]:[]))];
    const grounded=await groundCardFields({...principal,allowedArtifactIds:[...new Set([...(principal.allowedArtifactIds??[]),...originalSources.map(source=>source.artifactId)])]},input.operationId,originalSources,proposed,evidence,requested,this.extractions,{fresh:true});
    if(countFields(grounded.fields)!==countFields(proposed))throw new ContactsError('contact_redo_evidence_required',400);
    return this.reviseOwned(principal,{...input,...(observationPatch?{patch:{set:proposed}}:{}),reason:'ocr_redo',observations:grounded.observations},fingerprint,grounded.extraction);
  }

  private reviseOwned(principal:ContactPrincipal,input:ReviseContactInput,requestFingerprint?:string,extraction?:ContactExtractionSummary[]):ContactMutationResult{
    assertKeys(input,['operationId','contactId','expectedRevision','fields','patch','observations','uncertainties','extractionArtifactIds','reason']);assertOperation(input.operationId);
    const expectedRevision=input.expectedRevision??principal.userPromptBinding?.expectedRevision;assertRevision(expectedRevision);
    if((input.fields===undefined)===(input.patch===undefined))throw new ContactsError('contact_fields_or_patch_required',400);
    if(!['correction','ocr_redo','enrichment'].includes(input.reason))throw new ContactsError('contact_revision_reason_invalid',400);
    assertPrincipal(principal,true);assertPrompt(principal,input.contactId,expectedRevision,input.reason==='ocr_redo'?'ocr_redo':'revise');
    const fingerprint=requestFingerprint??this.fingerprint(principal,'revise',{...input,expectedRevision});
    return this.transaction(()=>{
      const existing=this.replay(principal,input.operationId,fingerprint);if(existing)return existing;
      const row=this.contactRow(principal,input.contactId,true),current=this.current(row);
      if(current.currentRevision!==expectedRevision)throw new ContactsError('contact_revision_conflict',409);
      const card=this.db.prepare('SELECT origin_prompt_id FROM contact_cards WHERE id=?').get(current.cardId) as Row;
      if(card.origin_prompt_id===principal.userPromptBinding!.promptId)throw new ContactsError('contact_followup_prompt_required',403);
      const changedFields=new Set<keyof ContactFields>();
      let revisedFields:ContactFields;
      if(input.patch!==undefined){
        assertKeys(input.patch,['set','remove']);
        const set=fields(input.patch.set??{}),remove=input.patch.remove??[];
        if(!Array.isArray(remove)||remove.some(name=>!contactFieldNames.includes(name))||(!Object.keys(input.patch.set??{}).length&&!remove.length))throw new ContactsError('contact_patch_invalid',400);
        revisedFields=structuredClone(current.fields);
        for(const name of Object.keys(input.patch.set??{}) as (keyof ContactFields)[]){changedFields.add(name);if(set[name])revisedFields[name]=set[name];else delete revisedFields[name];}
        for(const name of remove){changedFields.add(name);delete revisedFields[name];}
      }else{revisedFields=fields(input.fields);for(const name of contactFieldNames)changedFields.add(name);}
      const suppliedEvidence=observations(input.observations,current.sources.map(source=>source.artifactId));
      if(input.patch&&suppliedEvidence.some(item=>!changedFields.has(item.field)))throw new ContactsError('contact_patch_observation_target_invalid',400);
      const evidence=input.patch?[...current.observations.filter(item=>!changedFields.has(item.field)),...suppliedEvidence]:suppliedEvidence;
      const issues=input.uncertainties===undefined&&input.patch?current.uncertainties:uncertainties(input.uncertainties);
      if(input.reason==='ocr_redo'&&Object.entries(revisedFields).some(([name,values])=>changedFields.has(name as keyof ContactFields)&&(values??[]).some(value=>!suppliedEvidence.some(item=>item.field===name&&item.value===value))))throw new ContactsError('contact_redo_evidence_required',400);
      const revision=expectedRevision+1,at=new Date().toISOString();
      this.revision(current.id,revision,{fields:revisedFields,observations:evidence,uncertainties:issues},input.reason,current.audience,principal,at);
      const changed=this.db.prepare('UPDATE contacts SET current_revision=?,updated_at=? WHERE id=? AND current_revision=?').run(revision,at,current.id,expectedRevision).changes;
      if(Number(changed)!==1)throw new ContactsError('contact_revision_conflict',409);
      const result=this.recordOperation(principal,input.operationId,fingerprint,this.get(principal,current.id),issues);
      if(extraction){result.receipt.extraction=extraction;result.receipt.scanState='fields_saved';
        this.db.prepare('UPDATE contact_operations SET response_json=? WHERE actor_profile_id=? AND operation_id=?').run(JSON.stringify(result),principal.profileId,input.operationId);}
      return result;
    });
  }

  async changeAudience(principal:ContactPrincipal,input:{operationId:string;contactId:string;expectedRevision:number;audience:ContactAudience}):Promise<ContactMutationResult>{
    assertKeys(input,['operationId','contactId','expectedRevision','audience']);assertOperation(input.operationId);assertRevision(input.expectedRevision);
    if(!['private','household'].includes(input.audience))throw new ContactsError('contact_audience_invalid',400);
    assertPrincipal(principal,true,input.audience);assertPrompt(principal,input.contactId,input.expectedRevision,'change_audience');
    const fingerprint=this.fingerprint(principal,'audience',input),existing=this.replay(principal,input.operationId,fingerprint);if(existing)return existing;
    const row=this.contactRow(principal,input.contactId,true),current=this.current(row);
    if(current.ownerProfileId!==principal.profileId)throw new ContactsError('contact_scope_owner_required',403);
    if(current.currentRevision!==input.expectedRevision)throw new ContactsError('contact_revision_conflict',409);
    const card=this.db.prepare('SELECT origin_prompt_id FROM contact_cards WHERE id=?').get(current.cardId) as Row;
    if(card.origin_prompt_id===principal.userPromptBinding!.promptId)throw new ContactsError('contact_followup_prompt_required',403);
    const published=[];
    for(const item of current.sources){
      const source=await this.sources.inspect({...principal,allowedArtifactIds:[...(principal.allowedArtifactIds??[]),item.artifactId]},item.artifactId);
      published.push(await this.sources.publishCardSource({...principal,allowedArtifactIds:[...(principal.allowedArtifactIds??[]),item.artifactId]},source,input.audience,input.operationId+':'+published.length));
    }
    return this.transaction(()=>{
      const replay=this.replay(principal,input.operationId,fingerprint);if(replay)return replay;
      const latest=this.contactRow(principal,input.contactId,true);if(Number(latest.current_revision)!==input.expectedRevision)throw new ContactsError('contact_revision_conflict',409);
      const mapping=new Map(current.sources.map((source,index)=>[source.artifactId,published[index].artifactId]));
      const revision=input.expectedRevision+1,at=new Date().toISOString();
      this.revision(current.id,revision,{fields:current.fields,observations:current.observations.map(item=>({...item,sourceArtifactId:mapping.get(item.sourceArtifactId)??item.sourceArtifactId})),uncertainties:current.uncertainties},'scope_change',input.audience,principal,at);
      this.db.prepare('UPDATE contacts SET audience=?,current_revision=?,updated_at=? WHERE id=? AND current_revision=?').run(input.audience,revision,at,current.id,input.expectedRevision);
      this.db.prepare('UPDATE contact_cards SET audience=? WHERE id=?').run(input.audience,current.cardId);
      published.forEach((source,index)=>this.db.prepare('UPDATE contact_card_sources SET artifact_id=? WHERE card_id=? AND ordinal=?').run(source.artifactId,current.cardId,index));
      return this.recordOperation(principal,input.operationId,fingerprint,this.get(principal,current.id),['Scope changed for current contact view. Previously published immutable source artifacts are retained; prior authorized recipients may still have copies.']);
    });
  }

  readiness(){
    try{this.db.prepare('SELECT id FROM contacts LIMIT 0').all();this.db.prepare('SELECT contact_id FROM contact_revisions LIMIT 0').all();return {status:'ready',authority:'local_contacts',functionalAcceptance:'deferred_until_full_build'};}
    catch{return {status:'unavailable',authority:'local_contacts',functionalAcceptance:'deferred_until_full_build'};}
  }
}
