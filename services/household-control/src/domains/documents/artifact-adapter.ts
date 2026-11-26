import {createHash} from "node:crypto";
import type {ArtifactMetadata,ArtifactStore} from "../../platform/artifacts.ts";
import {DocumentsError} from "./types.ts";
import type {DocumentArtifacts,DocumentPrincipal,DocumentSource,SavedExtraction} from "./types.ts";
import {assertDocumentPrincipal} from "./service.ts";

/** Concrete artifact storage stays at this adapter boundary. */
export class ArtifactDocumentAccess implements DocumentArtifacts{
  private readonly artifacts:ArtifactStore;
  constructor(artifacts:ArtifactStore){this.artifacts=artifacts;}
  private principal(context:DocumentPrincipal){return {profileId:context.profileId,canReadHousehold:context.canReadHousehold};}
  private scope(context:DocumentPrincipal,metadata:ArtifactMetadata){
    if(context.audience==='household'&&metadata.audience!=='household')throw new DocumentsError('document_private_context_required',403);
    const bound=metadata.ownerProfileId===context.profileId&&metadata.conversationId===context.conversationId&&[context.taskId,'conversation:'+context.conversationId].includes(metadata.taskId);
    if(!bound&&!context.allowedArtifactIds?.includes(metadata.id))throw new DocumentsError('document_artifact_scope_mismatch',403);
  }
  async source(context:DocumentPrincipal,artifactId:string):Promise<DocumentSource>{
    assertDocumentPrincipal(context);
    const source=await this.artifacts.read(artifactId,this.principal(context));this.scope(context,source.metadata);
    if(!['application/pdf','image/png','image/jpeg','image/webp'].includes(source.metadata.mimeType))throw new DocumentsError('document_source_media_unsupported',415);
    return {artifactId:source.metadata.id,sha256:source.metadata.sha256,mimeType:source.metadata.mimeType,byteLength:source.metadata.byteLength,bytes:source.bytes};
  }
  private validate(value:unknown):SavedExtraction{
    const result=value as SavedExtraction;
    if(!result||result.schemaVersion!==1||result.trust!=='untrusted_document_data'||typeof result.requestFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(result.requestFingerprint)||
      typeof result.sourceArtifactId!=='string'||!/^artifact-[a-f0-9]{64}$/.test(result.sourceArtifactId)||typeof result.sourceSha256!=='string'||!/^[a-f0-9]{64}$/.test(result.sourceSha256)||
      typeof result.text!=='string'||Buffer.byteLength(result.text)>5*1024*1024||!Number.isSafeInteger(result.pageCount)||result.pageCount<1||result.pageCount>100||
      !Array.isArray(result.warnings)||result.warnings.length>100||result.warnings.some(item=>typeof item!=='string'||item.length>2000)||
      typeof result.engine!=='string'||result.engine.length>100||!['auto','fast','structured','ocr'].includes(result.mode)||!Number.isFinite(Date.parse(result.createdAt)))throw new DocumentsError('document_extraction_artifact_invalid',503);
    return result;
  }
  async find(context:DocumentPrincipal,operationId:string){
    const key='documents-extraction:'+operationId;
    const artifactId='artifact-'+createHash('sha256').update(JSON.stringify([context.profileId,context.conversationId,context.taskId,key])).digest('hex');
    try{return {artifactId,result:await this.result(context,artifactId)};}
    catch(error){if((error as {code?:string})?.code==='artifact_not_found')return undefined;throw error;}
  }
  async result(context:DocumentPrincipal,artifactId:string):Promise<SavedExtraction>{
    assertDocumentPrincipal(context);const source=await this.artifacts.read(artifactId,this.principal(context));this.scope(context,source.metadata);
    if(source.metadata.mimeType!=='application/json'||source.metadata.kind!=='evidence'||source.metadata.filename!=='document-extraction.json')throw new DocumentsError('document_extraction_artifact_invalid',400);
    let result:unknown;try{result=JSON.parse(source.bytes.toString('utf8'));}catch{throw new DocumentsError('document_extraction_artifact_invalid',503);}
    return this.validate(result);
  }
  async publish(context:DocumentPrincipal,operationId:string,result:SavedExtraction){
    assertDocumentPrincipal(context);this.validate(result);
    const source=await this.artifacts.get(result.sourceArtifactId,this.principal(context));this.scope(context,source);
    if(source.sha256!==result.sourceSha256)throw new DocumentsError('document_source_changed',409);
    assertDocumentPrincipal(context);
    const metadata=await this.artifacts.put({ownerProfileId:context.profileId,conversationId:context.conversationId,taskId:context.taskId,audience:context.audience},this.principal(context),{
      bytes:Buffer.from(JSON.stringify(result)),filename:'document-extraction.json',mimeType:'application/json',kind:'evidence',idempotencyKey:'documents-extraction:'+operationId,
    });
    return {artifactId:metadata.id,result};
  }
}
