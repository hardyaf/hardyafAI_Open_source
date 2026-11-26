import { createHash } from "node:crypto";
import { DocumentsError } from "./types.ts";
import type {DocumentArtifacts,DocumentExtractor,DocumentMode,DocumentPrincipal,SavedExtraction} from "./types.ts";

export function assertDocumentPrincipal(principal:DocumentPrincipal):void{
  principal?.assertCurrent?.();
  if(!principal||![principal.profileId,principal.agentId,principal.conversationId,principal.taskId].every(value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))||
    !['private','household'].includes(principal.audience)||typeof principal.canReadHousehold!=='boolean'||principal.canProcessDocuments!==true)throw new DocumentsError('document_access_not_authorized',403);
}
export class DocumentsService{
  private readonly artifacts:DocumentArtifacts;private readonly extractor:DocumentExtractor;
  constructor(artifacts:DocumentArtifacts,extractor:DocumentExtractor){this.artifacts=artifacts;this.extractor=extractor;}
  async readiness(){return this.extractor.readiness();}
  private projection(artifactId:string,result:SavedExtraction,replayed:boolean){return {extractionArtifactId:artifactId,sourceArtifactId:result.sourceArtifactId,sourceSha256:result.sourceSha256,
    mode:result.mode,engine:result.engine,pageCount:result.pageCount,excerpt:result.text.slice(0,12000),truncated:result.text.length>12000,warnings:result.warnings,trust:result.trust,replayed};}
  async extract(principal:DocumentPrincipal,input:{operationId:string;artifactId:string;mode?:DocumentMode}){
    assertDocumentPrincipal(principal);
    if(!input||Object.keys(input).some(key=>!['operationId','artifactId','mode'].includes(key))||typeof input.operationId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(input.operationId)||
      typeof input.artifactId!=='string'||!/^artifact-[a-f0-9]{64}$/.test(input.artifactId)||!['auto','fast','structured','ocr'].includes(input.mode??'auto'))throw new DocumentsError('document_extract_arguments_invalid',400);
    const mode=input.mode??'auto';
    // Source authorization is repeated on replay; a saved extraction cannot grant access.
    const source=await this.artifacts.source(principal,input.artifactId);
    const fingerprint=createHash('sha256').update(JSON.stringify([input.artifactId,source.sha256,mode,principal.audience])).digest('hex');
    const replay=await this.artifacts.find(principal,input.operationId);
    if(replay){if(replay.result.requestFingerprint!==fingerprint)throw new DocumentsError('document_operation_conflict',409);return this.projection(replay.artifactId,replay.result,true);}
    const observed=await this.extractor.extract(source,mode,{assertCurrent:principal.assertCurrent,signal:principal.signal});
    if(observed.sourceSha256!==source.sha256)throw new DocumentsError('document_source_changed',409);
    assertDocumentPrincipal(principal);
    const result:SavedExtraction={schemaVersion:1,requestFingerprint:fingerprint,sourceArtifactId:source.artifactId,sourceSha256:source.sha256,mode,engine:observed.engine,
      pageCount:observed.pageCount,text:observed.text,structured:observed.structured,warnings:observed.warnings,createdAt:new Date().toISOString(),trust:'untrusted_document_data'};
    const saved=await this.artifacts.publish(principal,input.operationId,result);
    return this.projection(saved.artifactId,saved.result,false);
  }
  async readExtraction(principal:DocumentPrincipal,input:{artifactId:string;offset?:number;limit?:number}){
    assertDocumentPrincipal(principal);
    if(!input||Object.keys(input).some(key=>!['artifactId','offset','limit'].includes(key))||typeof input.artifactId!=='string'||!/^artifact-[a-f0-9]{64}$/.test(input.artifactId)||
      input.offset!==undefined&&(!Number.isSafeInteger(input.offset)||input.offset<0||input.offset>5*1024*1024)||
      input.limit!==undefined&&(!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>30000))throw new DocumentsError('document_read_arguments_invalid',400);
    const result=await this.artifacts.result(principal,input.artifactId);
    await this.artifacts.source(principal,result.sourceArtifactId);
    const offset=input.offset??0,limit=input.limit??12000;
    return {extractionArtifactId:input.artifactId,sourceArtifactId:result.sourceArtifactId,sourceSha256:result.sourceSha256,engine:result.engine,pageCount:result.pageCount,
      text:result.text.slice(offset,offset+limit),offset,nextOffset:offset+limit<result.text.length?offset+limit:null,totalCharacters:result.text.length,warnings:result.warnings,trust:result.trust};
  }
}
