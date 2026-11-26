import {parse as parseYaml,stringify as stringifyYaml} from "yaml";

const start="<!-- openclaw:wiki:generated:start -->",end="<!-- openclaw:wiki:generated:end -->";
const relatedStart="<!-- openclaw:wiki:related:start -->",relatedEnd="<!-- openclaw:wiki:related:end -->";
/** Installed native compiler-owned Related projection, never arbitrary prose.
 * Recognition affects attribution checks only; pruning preserves this block. */
function withoutMechanicalRelated(value:string,precedingBody:string):string{
  if(value.split(relatedStart).length!==2||value.split(relatedEnd).length!==2)return value;
  const match=value.match(/(?:^|\r?\n)## Related\r?\n<!-- openclaw:wiki:related:start -->\r?\n([\s\S]*?)\r?\n<!-- openclaw:wiki:related:end -->(?=\r?\n|$)/);
  if(!match)return value;
  const before=precedingBody+value.slice(0,match.index!);
  if(before.lastIndexOf("<!-- openclaw:human:start -->")>before.lastIndexOf("<!-- openclaw:human:end -->"))return value;
  const content=match[1].trim();
  if(content!=="- No related pages yet."){
    const headings=["### Sources","### Referenced By","### Related Pages"];
    let section=-1,links=0;
    for(const line of content.split(/\r?\n/)){
      if(!line.trim())continue;
      const next=headings.indexOf(line);
      if(next!==-1){if(next<=section||section!==-1&&links===0)return value;section=next;links=0;continue;}
      if(section===-1||!(/^- \[[^\]\r\n]+\]\((?:\.\.\/)*[\p{L}\p{N}\p{M}_.\/-]+\.md\)$/u.test(line)||
        /^- \[\[[\p{L}\p{N}\p{M}_.\/-]+\|[^\]\r\n]+\]\]$/u.test(line)))return value;
      links++;
    }
    if(section===-1||links===0)return value;
  }
  return value.slice(0,match.index!)+value.slice(match.index!+match[0].length);
}
export type ManagedEntryPrune={action:"prune";content:string}|{action:"remove";rebuildRequired:boolean};
/** Only fully attributed adapter entries can be edited mechanically. Opaque
 * prose, review annotations and human notes retain conservative invalidation. */
export function pruneManagedEntry(raw:string,sourceId:string):ManagedEntryPrune{
  const opaque=():ManagedEntryPrune=>({action:"remove",rebuildRequired:true});
  const front=raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);if(!front)return opaque();
  let metadata:Record<string,unknown>;
  try{metadata=parseYaml(front[1],{maxAliasCount:0,uniqueKeys:true,strict:true});}catch{return opaque();}
  if(!metadata||typeof metadata!=="object"||Array.isArray(metadata))return opaque();
  const body=raw.slice(front[0].length).trimStart(),first=body.indexOf(start),last=body.indexOf(end);
  if(first<0||last<first||body.indexOf(start,first+1)>=0||body.indexOf(end,last+1)>=0)return opaque();
  const outside=(body.slice(0,first)+withoutMechanicalRelated(body.slice(last+end.length),body.slice(0,last+end.length))).replace(/^# [^\r\n]+(?:\r?\n|$)/,"")
    .replace(/^## (?:Summary|Notes)\s*$/gm,"").replace(/<!-- openclaw:human:(?:start|end) -->/g,"").trim();
  if(outside)return opaque();
  if([metadata.questions,metadata.contradictions].some(value=>value!==undefined&&(!Array.isArray(value)||value.length>0)))return opaque();
  const summary=body.slice(first+start.length,last).trim(),pattern=/^<!-- household-memory-entry:(source-[a-f0-9]{64}) -->\r?$/gm;
  const matches=[...summary.matchAll(pattern)];if(!matches.length||summary.slice(0,matches[0].index).trim())return opaque();
  const entries=matches.map((match,index)=>{
    const id=match[1],segment=summary.slice(match.index!+match[0].length,matches[index+1]?.index??summary.length).trim();
    const endMarker="<!-- household-memory-entry-end:"+id+" -->",hasEnd=segment.endsWith(endMarker);
    const content=(hasEnd?segment.slice(0,-endMarker.length):segment).trim();
    return {id,valid:!content.includes("household-memory-entry")&&/^### \d{4}-\d{2}-\d{2} · [^\r\n]+(?:\r?\n|$)/.test(content)&&
      content.endsWith("Source: `"+id+"`")&&content.split("Source: `"+id+"`").length===2,
      raw:match[0]+"\n"+segment};
  });
  if(entries.some(entry=>!entry.valid)||new Set(entries.map(entry=>entry.id)).size!==entries.length||!entries.some(entry=>entry.id===sourceId))return opaque();
  const refs=metadata.sourceIds,claims=metadata.claims;
  if(!Array.isArray(refs)||refs.some(id=>typeof id!=="string")||new Set(refs).size!==refs.length||refs.length!==entries.length||entries.some(entry=>!refs.includes(entry.id))||!Array.isArray(claims))return opaque();
  const markerIds=new Set(entries.map(entry=>entry.id));
  if(claims.some(claim=>!claim||typeof claim!=="object"||Array.isArray(claim)||!Array.isArray(claim.evidence)||!claim.evidence.length||
    claim.evidence.some((evidence:unknown)=>!evidence||typeof evidence!=="object"||Array.isArray(evidence)||!markerIds.has((evidence as Record<string,unknown>).sourceId as string))||
    new Set(claim.evidence.map((evidence:Record<string,unknown>)=>evidence.sourceId)).size!==1))return opaque();
  // Unknown metadata is retained only when it does not itself reference the
  // retired source. Such a reference cannot be safely attributed by this owner.
  const {sourceIds:knownRefs,claims:knownClaims,...other}=metadata;
  if(JSON.stringify(other).includes(sourceId))return opaque();
  const kept=entries.filter(entry=>entry.id!==sourceId);if(!kept.length)return {action:"remove",rebuildRequired:false};
  const remainingClaims=claims.filter(claim=>claim.evidence[0].sourceId!==sourceId),next={...metadata,sourceIds:refs.filter(id=>id!==sourceId),claims:remainingClaims,updatedAt:new Date().toISOString(),
    status:remainingClaims.some(claim=>claim.status!=="supported")?"review":metadata.status==="review"?"supported":metadata.status};
  let nextBody=body.slice(0,first+start.length)+"\n"+kept.map(entry=>entry.raw).join("\n\n")+"\n"+body.slice(last);
  const boundary=nextBody.indexOf(end)+end.length,prefix=nextBody.slice(0,boundary),suffix=nextBody.slice(boundary);
  // A stale compiler link is not a surviving fact. Drop only the proven
  // mechanical projection; the required native compile rebuilds it from refs.
  if(suffix.includes(sourceId))nextBody=prefix+withoutMechanicalRelated(suffix,prefix);
  if(nextBody.includes(sourceId)||JSON.stringify(next).includes(sourceId))return opaque();
  return {action:"prune",content:"---\n"+stringifyYaml(next).trimEnd()+"\n---\n\n"+nextBody.trimEnd()+"\n"};
}
