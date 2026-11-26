import { createHash } from "node:crypto";
import type { ContactPrincipal, ContactsExtractionAccess, ContactExtractionEvidence } from "../domains/contacts/types.ts";
import type { DocumentPrincipal, DocumentArtifacts, SavedExtraction } from "../domains/documents/types.ts";

type ExtractionOwner = { extract(principal:DocumentPrincipal,input:{operationId:string;artifactId:string;mode?:"auto"|"ocr"}):Promise<{extractionArtifactId:string}> };
/** Application composition joins the existing Contacts and Documents contracts. */
export function composeContactExtraction(ports:{documents:ExtractionOwner;access:DocumentArtifacts;allowed(principal:ContactPrincipal):boolean}):ContactsExtractionAccess{
  return {async resolve(principal,sourceArtifactIds,extractionArtifactIds,operationId,options){
    principal.assertCurrent?.();
    if(!ports.allowed(principal))return sourceArtifactIds.map(sourceArtifactId=>({state:"unavailable" as const,sourceArtifactId,warnings:["Local extraction is unavailable under the current document grant."]}));
    const context:DocumentPrincipal={...principal,canProcessDocuments:true,allowedArtifactIds:principal.allowedArtifactIds};
    const known=new Map<string,{id:string;value:SavedExtraction}>();
    for(const id of extractionArtifactIds){
      const value=await ports.access.result(context,id);principal.assertCurrent?.();
      if(!sourceArtifactIds.includes(value.sourceArtifactId))throw Object.assign(Error("contact_extraction_source_mismatch"),{code:"contact_extraction_source_mismatch"});
      known.set(value.sourceArtifactId,{id,value});
    }
    const results:ContactExtractionEvidence[]=[];
    for(const sourceArtifactId of sourceArtifactIds){
      principal.assertCurrent?.();const source=await ports.access.source(context,sourceArtifactId);
      let saved=options?.fresh?undefined:known.get(sourceArtifactId);
      if(!saved){
        try{
          const key="card-ocr:"+createHash("sha256").update(JSON.stringify([operationId,sourceArtifactId,source.sha256,...(options?.fresh?["fresh-ocr"]:[])])).digest("hex");
          const result=await ports.documents.extract(context,{operationId:key,artifactId:sourceArtifactId,mode:options?.fresh?"ocr":"auto"});
          saved={id:result.extractionArtifactId,value:await ports.access.result(context,result.extractionArtifactId)};
        }catch(error){
          principal.assertCurrent?.();const code=(error as {code?:unknown}).code;
          if(typeof code==="string"&&(/authoriz|scope|source_changed|invalid|cancel|revok/.test(code)))throw error;
          results.push({state:"failed",sourceArtifactId,sourceSha256:source.sha256,warnings:["Local extraction attempt failed; original preserved."]});continue;
        }
      }
      if(saved.value.sourceSha256!==source.sha256)throw Object.assign(Error("contact_extraction_source_changed"),{code:"contact_extraction_source_changed"});
      results.push({state:"extracted",sourceArtifactId,sourceSha256:source.sha256,extractionArtifactId:saved.id,text:saved.value.text,pageCount:saved.value.pageCount,warnings:saved.value.warnings,...(options?.fresh?{executionOperationId:operationId}:{})});
    }
    return results;
  }};
}
