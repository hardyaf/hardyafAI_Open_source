import {ContactsError} from "./types.ts";
import type {ContactExtractionEvidence,ContactExtractionSummary,ContactFields,ContactObservation,ContactObservationInput,ContactPrincipal,ContactSource,ContactsExtractionAccess} from "./types.ts";
import {assertPrincipal,artifactIdPattern,observations as validateObservations} from "./validation.ts";

function contains(text:string,quote:string):boolean{
  const normalized=(value:string)=>value.normalize("NFC").replace(/\s+/gu," ").trim();
  const source=normalized(text),value=normalized(quote);
  if(!value)return false;
  for(let start=source.indexOf(value);start!==-1;start=source.indexOf(value,start+1)){
    const word=/[\p{L}\p{N}\p{M}_]/u;
    if(!(word.test(value[0])&&start>0&&word.test(source[start-1]))&&
      !(word.test(value[value.length-1])&&word.test(source[start+value.length]??"")))return true;
  }
  return false;
}

type VerifiedExtraction=Extract<ContactExtractionEvidence,{state:"extracted"}>;
function bindObservations(input:readonly ContactObservationInput[],valid:readonly VerifiedExtraction[]):ContactObservation[]{
  const bound:ContactObservation[]=[];
  for(const observation of input){
    const implicit=observation.sourceArtifactId===undefined;
    if(implicit&&(typeof observation.quote!=="string"||!observation.quote.trim()))throw new ContactsError("contact_observation_quote_required",400);
    const authorized=valid.filter(evidence=>(implicit||evidence.sourceArtifactId===observation.sourceArtifactId)&&
      (!observation.extractionArtifactId||evidence.extractionArtifactId===observation.extractionArtifactId));
    if(!authorized.length){
      if(implicit)throw new ContactsError("contact_observation_evidence_missing",400);
      if(observation.extractionArtifactId)throw new ContactsError("contact_observation_evidence_mismatch",400);
      // Genuine unavailable/failed extraction still permits a source-only save.
      // This explicit observation cannot be rebound to another readable source.
      continue;
    }
    const matches=authorized.filter(evidence=>(observation.page===undefined||observation.page<=evidence.pageCount)&&contains(evidence.text,observation.quote??observation.value));
    const unique=new Map(matches.map(evidence=>[evidence.sourceArtifactId+":"+evidence.extractionArtifactId,evidence]));
    if(unique.size===0)throw new ContactsError(implicit?"contact_observation_evidence_missing":"contact_observation_evidence_mismatch",400);
    if(unique.size!==1)throw new ContactsError("contact_observation_evidence_ambiguous",400);
    const evidence=unique.values().next().value!;
    bound.push({...observation,sourceArtifactId:evidence.sourceArtifactId,extractionArtifactId:evidence.extractionArtifactId});
  }
  return bound;
}

/** Accept owning extraction handles, not model repetitions of supposed OCR.
 * The interpretation of a supported quote is Main's responsibility; identity,
 * source hash and quote existence are checked here. Originals always survive. */
export async function groundCardFields(principal:ContactPrincipal,operationId:string,sources:readonly ContactSource[],proposed:ContactFields,
  proposedObservations:readonly ContactObservationInput[],requested:readonly string[],port?:ContactsExtractionAccess,options?:{fresh:boolean}):Promise<{
    fields:ContactFields;observations:ContactObservation[];warnings:string[];extraction:ContactExtractionSummary[];
  }>{
  let resolved:ContactExtractionEvidence[];
  const warnings:string[]=[];
  try{
    resolved=port?await port.resolve(principal,sources.map(source=>source.artifactId),requested,operationId,options):sources.map(source=>({state:"unavailable",sourceArtifactId:source.artifactId,sourceSha256:source.sha256,warnings:["Local extraction is not configured; original card retained."]}));
  }catch{
    // Reader failure cannot discard an authorized supplied card. Revocation is
    // still checked after this await and before any contact/source mutation.
    resolved=sources.map(source=>({state:"failed",sourceArtifactId:source.artifactId,sourceSha256:source.sha256,warnings:["Local extraction failed; original card retained."]}));
  }
  assertPrincipal(principal,true);
  const sourceMap=new Map(sources.map(source=>[source.artifactId,source]));
  const valid:VerifiedExtraction[]=[];
  const summary:ContactExtractionSummary[]=[];
  if(!Array.isArray(resolved)||resolved.length>64)resolved=[];
  for(const evidence of resolved){
    const source=sourceMap.get(evidence?.sourceArtifactId);
    if(!source||evidence.sourceSha256!==undefined&&evidence.sourceSha256!==source.sha256){warnings.push("Extraction evidence did not match the supplied card source.");continue;}
    if(evidence.state==="extracted"){
      if(options?.fresh&&evidence.executionOperationId!==operationId){warnings.push("OCR redo did not return extraction evidence for this operation.");continue;}
      if(evidence.sourceSha256!==source.sha256||!artifactIdPattern.test(evidence.extractionArtifactId)||typeof evidence.text!=="string"||evidence.text.length>2_000_000||
        !Number.isSafeInteger(evidence.pageCount)||evidence.pageCount<1||!Array.isArray(evidence.warnings)){
        warnings.push("Extraction evidence was invalid; unsupported fields were not saved.");continue;
      }
      valid.push(evidence);summary.push({sourceArtifactId:source.artifactId,state:"extracted",extractionArtifactId:evidence.extractionArtifactId});
    }else if(evidence.state==="failed"||evidence.state==="unavailable")summary.push({sourceArtifactId:source.artifactId,state:evidence.state});
    else continue;
    if(Array.isArray(evidence.warnings))warnings.push(...evidence.warnings.filter(value=>typeof value==="string").slice(0,20).map(value=>value.slice(0,1000)));
  }
  for(const source of sources)if(!summary.some(item=>item.sourceArtifactId===source.artifactId)){
    summary.push({sourceArtifactId:source.artifactId,state:"unavailable"});warnings.push("No verified local extraction result for a supplied card source.");
  }
  const observations=validateObservations(bindObservations(proposedObservations,valid),sources.map(source=>source.artifactId));
  const fields:ContactFields={},grounded:ContactObservation[]=[];
  for(const [name,values] of Object.entries(proposed))for(const value of values??[]){
    const observation=observations.find(item=>item.field===name&&item.value===value&&valid.some(evidence=>
      evidence.sourceArtifactId===item.sourceArtifactId&&(!item.extractionArtifactId||item.extractionArtifactId===evidence.extractionArtifactId)&&
      (item.page===undefined||item.page<=evidence.pageCount)&&contains(evidence.text,item.quote??value)));
    const evidence=observation?valid.find(item=>item.sourceArtifactId===observation.sourceArtifactId&&(!observation.extractionArtifactId||item.extractionArtifactId===observation.extractionArtifactId)&&contains(item.text,observation.quote??value)):
      proposedObservations.some(item=>item.field===name&&item.value===value)?undefined:valid.find(item=>contains(item.text,value));
    if(!evidence){warnings.push("Omitted unsupported initial field: "+name);continue;}
    const field=name as keyof ContactFields;(fields[field]??=[]).push(value);
    grounded.push(observation?{...observation,extractionArtifactId:evidence.extractionArtifactId}:{field,value,sourceArtifactId:evidence.sourceArtifactId,quote:value,extractionArtifactId:evidence.extractionArtifactId});
  }
  return {fields,observations:grounded,warnings:[...new Set(warnings)],extraction:summary};
}
