import {createHash} from "node:crypto";
import {PlatformError} from "../platform/errors.ts";
import type {DisplayListItem,DisplayMediaType,DisplayPorts,DisplayPublication,DisplayPublicationSummary,DisplayPublisher,
  DisplayPublishAuthorization,DisplayPublishInput,DisplayReader,DisplaySnapshot,HouseholdEventProjection} from "./contracts.ts";

const publicationId=/^display-[a-f0-9]{64}$/;
const artifactId=/^artifact-[a-f0-9]{64}$/;
const identity=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const operationId=/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const media=new Set<DisplayMediaType>(["image/png","image/jpeg","image/webp","text/plain"]);
const MAX_PUBLICATION_BYTES=5*1024*1024;
const MAX_TEXT_BYTES=64*1024;
export class DisplayError extends PlatformError {
  readonly deliveryOutcome:"not_sent"|"unknown";
  readonly outcome:"not_sent"|"unknown";
  constructor(code:string,statusCode=400,outcome:"not_sent"|"unknown"="not_sent"){super(code,statusCode);this.name="DisplayError";this.deliveryOutcome=outcome;this.outcome=outcome;}
}
function digest(value:string|Buffer):string{return createHash("sha256").update(value).digest("hex");}
function text(value:unknown,max:number):string {
  if(typeof value!=="string"||!value.trim()||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))throw new DisplayError("display_projection_invalid",503);
  return value;
}
function instant(value:unknown):number{
  if(typeof value!=="string"||value.length>40||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw new DisplayError("display_timestamp_invalid");
  return Date.parse(value);
}
function id(value:unknown,pattern:RegExp=identity):string{if(typeof value!=="string"||!pattern.test(value))throw new DisplayError("display_reference_invalid");return value;}
function assertMedia(bytes:Buffer,mimeType:string):asserts mimeType is DisplayMediaType {
  if(!media.has(mimeType as DisplayMediaType))throw new DisplayError("display_media_unsupported",415);
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_PUBLICATION_BYTES)throw new DisplayError("display_content_size_invalid",413);
  if(mimeType==="image/png"&&!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||
    mimeType==="image/jpeg"&&!bytes.subarray(0,3).equals(Buffer.from([255,216,255]))||
    mimeType==="image/webp"&&!(bytes.subarray(0,4).toString("ascii")==="RIFF"&&bytes.subarray(8,12).toString("ascii")==="WEBP"))
    throw new DisplayError("display_media_mismatch",415);
  if(mimeType==="text/plain"){
    if(bytes.length>MAX_TEXT_BYTES)throw new DisplayError("display_content_size_invalid",413);
    try{new TextDecoder("utf-8",{fatal:true}).decode(bytes);}catch{throw new DisplayError("display_text_encoding_invalid",415);}
  }
}
function listItems(values:DisplayListItem[]):DisplayListItem[]{
  if(!Array.isArray(values))throw new DisplayError("display_projection_invalid",503);
  return values.slice(0,100).map(value=>{
    const result:DisplayListItem={id:id(value.id),text:text(value.text,2000)};
    if(value.due!==undefined&&value.due!==null){if(!/^\d{4}-\d{2}-\d{2}$/.test(value.due)||!Number.isFinite(Date.parse(value.due+"T00:00:00Z")))throw new DisplayError("display_projection_invalid",503);result.due=value.due;}
    return result;
  });
}
function events(values:HouseholdEventProjection[],from:number,to:number):HouseholdEventProjection[]{
  if(!Array.isArray(values))throw new DisplayError("display_projection_invalid",503);
  return values.slice(0,50).map(value=>{
    const start=text(value.start,40),end=text(value.end,40);
    const startMs=Date.parse(start),endMs=Date.parse(end);
    if(!Number.isFinite(startMs)||!Number.isFinite(endMs)||endMs<startMs||endMs<=from||startMs>=to||typeof value.allDay!=="boolean")throw new DisplayError("display_projection_invalid",503);
    return {id:id(value.id),title:text(value.title,1000),start,end,allDay:value.allDay,
      ...(value.timeZone?{timeZone:text(value.timeZone,100)}:{}),...(value.location?{location:text(value.location,1000)}:{})};
  });
}

/** Read-only household projection and explicitly authorized output publication.
 * Transport/authentication and authoritative storage stay at composition.
 */
export class DisplayService {
  private readonly ports:DisplayPorts;
  constructor(ports:DisplayPorts){this.ports=ports;}
  private now(){const value=this.ports.clock?.()??new Date();if(!Number.isFinite(value.getTime()))throw new DisplayError("display_clock_unavailable",503);return value;}
  private reader(principal:DisplayReader){if(principal.deviceKind!=="display")throw new DisplayError("display_device_required",403);id(principal.deviceId);principal.assertCurrent();}
  private publication(value:DisplayPublication,now:number):DisplayPublicationSummary {
    if(value.audience!=="household"||!publicationId.test(value.id)||!media.has(value.mimeType)||!Number.isSafeInteger(value.byteLength)||value.byteLength<1||
      value.byteLength>MAX_PUBLICATION_BYTES||!/^([a-f0-9]{64})$/.test(value.sha256)||instant(value.expiresAt)<=now||instant(value.publishedAt)>now)
      throw new DisplayError("display_publication_not_found",404);
    return {id:value.id,title:text(value.title,180),mimeType:value.mimeType,byteLength:value.byteLength,sha256:value.sha256,
      publishedAt:value.publishedAt,expiresAt:value.expiresAt,contentPath:"/v1/display/publications/"+value.id+"/content"};
  }
  async snapshot(principal:DisplayReader):Promise<DisplaySnapshot>{
    this.reader(principal);const now=this.now(),from=now.toISOString(),to=new Date(now.getTime()+7*24*60*60*1000).toISOString();
    const current=()=>{this.reader(principal);};
    const [listResult,eventResult,publicationResult]=await Promise.allSettled([
      this.ports.lists.readHousehold(current).then(value=>{current();return {shopping:listItems(value.shopping),tasks:listItems(value.tasks),waiting:listItems(value.waiting)};}),
      this.ports.calendar.upcomingHousehold({from,to,limit:50},current).then(value=>{current();return events(value,now.getTime(),Date.parse(to));}),
      this.ports.publications.listActive(from,10,current).then(values=>{current();return values.map(value=>this.publication(value,now.getTime())).sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)||a.id.localeCompare(b.id)).slice(0,10);}),
    ]);
    current();
    return {schemaVersion:1,generatedAt:from,
      householdLists:listResult.status==="fulfilled"?{status:"ready",...listResult.value}:{status:"unavailable",shopping:[],tasks:[],waiting:[]},
      upcomingEvents:{status:eventResult.status==="fulfilled"?"ready":"unavailable",from,to,events:eventResult.status==="fulfilled"?eventResult.value:[]},
      publicationStatus:publicationResult.status==="fulfilled"?"ready":"unavailable",publications:publicationResult.status==="fulfilled"?publicationResult.value:[]};
  }
  async content(principal:DisplayReader,publication:string):Promise<{bytes:Buffer;headers:Record<string,string>}>{
    this.reader(principal);id(publication,publicationId);const now=this.now(),current=()=>this.reader(principal);
    const record=await this.ports.publications.getActive(publication,now.toISOString(),current);current();
    if(!record||record.id!==publication)throw new DisplayError("display_publication_not_found",404);
    const summary=this.publication(record,now.getTime()),bytes=await this.ports.publications.readContent(record,current);current();
    const latest=await this.ports.publications.getActive(publication,this.now().toISOString(),current);current();
    if(!latest||latest.fingerprint!==record.fingerprint)throw new DisplayError("display_publication_not_found",404);
    // Expiry and device revocation are rechecked after every asynchronous read.
    this.publication(record,this.now().getTime());assertMedia(bytes,record.mimeType);
    if(bytes.length!==summary.byteLength||digest(bytes)!==summary.sha256)throw new DisplayError("display_content_integrity_failed",503);
    return {bytes,headers:{"Content-Type":summary.mimeType,"Content-Length":String(bytes.length),"Cache-Control":"private, no-store",
      "Content-Security-Policy":"sandbox; default-src 'none'","X-Content-Type-Options":"nosniff","Content-Disposition":"inline"}};
  }
  async publish(principal:DisplayPublisher,input:DisplayPublishInput,authorization:DisplayPublishAuthorization):Promise<{state:"committed";audience:"household";publication:DisplayPublicationSummary}>{
    principal.assertCurrent();
    if(principal.role==="child"||principal.taskMode!=="standard"||!principal.canPublishHousehold)throw new DisplayError("display_publication_not_authorized",403);
    [principal.profileId,principal.conversationId,principal.taskId,principal.sourcePromptId].forEach(value=>id(value));
    id(input.operationId,operationId);id(input.artifactId,artifactId);const title=text(input.title,180),now=this.now().getTime();
    if(!authorization||authorization.purpose!=="display_publish"||authorization.contentClass!=="household_output"||authorization.sourcePromptId!==principal.sourcePromptId||
      authorization.artifactId!==input.artifactId||!/^([a-f0-9]{64})$/.test(authorization.artifactSha256)||
      instant(authorization.issuedAt)<instant(principal.sourcePromptCreatedAt)||instant(authorization.issuedAt)>now||instant(authorization.expiresAt)<=now)
      throw new DisplayError("fresh_display_publication_authorization_required",403);
    const expires=instant(input.expiresAt??authorization.publicationExpiresAt),expiresAt=new Date(expires).toISOString();
    if(expires<=now||expires>instant(authorization.publicationExpiresAt))throw new DisplayError("display_publication_expiry_not_authorized",403);
    const current=()=>{principal.assertCurrent();if(instant(authorization.expiresAt)<=this.now().getTime())throw new DisplayError("display_publication_authorization_expired",403);};
    const source=await this.ports.artifacts.readForPublication(input.artifactId,principal);current();const metadata=source.metadata;
    if(metadata.id!==input.artifactId||metadata.kind!=="output"||metadata.ownerProfileId!==principal.profileId||metadata.audience!=="household"||metadata.conversationId!==(authorization.artifactConversationId??principal.conversationId)||metadata.taskId!==(authorization.artifactTaskId??principal.taskId)||
      metadata.sha256!==authorization.artifactSha256||metadata.byteLength!==source.bytes.length||digest(source.bytes)!==metadata.sha256)
      throw new DisplayError("display_source_scope_not_authorized",403);
    assertMedia(source.bytes,metadata.mimeType);
    const publication="display-"+digest(JSON.stringify([principal.profileId,principal.conversationId,input.operationId]));
    const details={id:publication,audience:"household" as const,ownerProfileId:principal.profileId,conversationId:principal.conversationId,taskId:principal.taskId,
      sourcePromptId:principal.sourcePromptId,operationId:input.operationId,sourceArtifactId:metadata.id,sha256:metadata.sha256,mimeType:metadata.mimeType as DisplayMediaType,
      byteLength:metadata.byteLength,title,expiresAt};
    const draft={...details,fingerprint:digest(JSON.stringify(details))};
    let committed:DisplayPublication;
    try{current();committed=await this.ports.publications.commit(draft,source.bytes,current);current();}
    catch(error){if(error instanceof DisplayError&&error.deliveryOutcome==="not_sent")throw error;throw new DisplayError("display_publication_outcome_unknown",503,"unknown");}
    if(committed.id!==publication||committed.fingerprint!==draft.fingerprint||Object.keys(details).some(key=>(committed as unknown as Record<string,unknown>)[key]!==details[key as keyof typeof details]))
      throw new DisplayError("display_publication_readback_failed",503,"unknown");
    return {state:"committed",audience:"household",publication:this.publication(committed,this.now().getTime())};
  }
}
