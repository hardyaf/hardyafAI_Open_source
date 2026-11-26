import { sendJson } from "../http-codec.ts";
import { artifactResponseHeaders } from "../platform/artifacts.ts";
import { ClientViewError } from "./contracts.ts";
import type { ClientReadQuery, ClientReadScope, ClientViewDependencies, ClientViewName, ClientViewRoute } from "./contracts.ts";
import { contactProjection, contactsProjection, listsProjection, managedLookup, object, receiptReviewProjection, revisionsProjection, rows, wikiPageProjection, wikiSearchProjection } from "./projections.ts";
import { projectWorkspace } from "./workspace.ts";

function decode(value: string): string { try { return decodeURIComponent(value); } catch { throw new ClientViewError("invalid_client_view_request"); } }
function queryKeys(url: URL, allowed: string[]) {
  for(const key of url.searchParams.keys()) if(!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) throw new ClientViewError("invalid_client_view_request");
}
function scope(url: URL): ClientReadScope { const value=url.searchParams.get("scope")??"household"; if(value!=="household"&&value!=="personal")throw new ClientViewError("invalid_scope");return value; }
function limit(url: URL, fallback: number, maximum: number): number {
  const value=url.searchParams.get("limit");if(value===null)return fallback;
  if(!/^[1-9][0-9]{0,2}$/.test(value)||Number(value)>maximum)throw new ClientViewError("invalid_limit");return Number(value);
}
function search(url: URL, maximum: number): string { const value=url.searchParams.get("query")??"";if(value.length>maximum||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))throw new ClientViewError("invalid_query");return value; }
function knownError(error: unknown): {code:string;status:number} {
  const value=error as {code?:unknown;statusCode?:unknown;httpStatus?:unknown};
  const code=typeof value?.code==="string"&&/^[a-z][a-z0-9_]{0,100}$/.test(value.code)?value.code:"client_view_unavailable";
  const status=Number(value?.statusCode??value?.httpStatus);
  return {code,status:Number.isSafeInteger(status)&&status>=400&&status<=599?status:503};
}

/** Signed principal arrives from the existing server auth boundary. No tool dispatcher is exposed. */
export function createClientViewRoutes(deps: ClientViewDependencies): ClientViewRoute {
  return async(request,response,url,bytes,context) => {
    const contact=url.pathname.match(/^\/v1\/contacts\/([^/]+)$/);
    const source=url.pathname.match(/^\/v1\/contacts\/([^/]+)\/sources\/([^/]+)\/content$/);
    const wiki=url.pathname.match(/^\/v1\/wiki\/([^/]+)$/);
    const workspace=url.pathname.match(/^\/v1\/conversations\/([^/]+)\/workspace$/);
    const recognized=["/v1/contacts","/v1/lists","/v1/wiki","/v1/receipts/review"].includes(url.pathname)||!!contact||!!source||!!wiki||!!workspace;
    if(!recognized)return false;
    const controller=new AbortController();
    const abort=()=>{if(!response.writableEnded)controller.abort();};response.once("close",abort);
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(25_000)]);
    try {
      if(request.method!=="GET"){response.setHeader("Allow","GET");sendJson(response,405,{error:"method_not_allowed"});return true;}
      if(bytes.length)throw new ClientViewError("invalid_client_view_request");
      const assertCurrent=()=>{if(signal.aborted)throw new ClientViewError("client_view_cancelled",409);deps.assertCurrent(context);};
      assertCurrent();
      if(context.device.kind!=="signed"||!context.profile.capabilities.includes("chat"))throw new ClientViewError("forbidden",403);
      if(workspace){queryKeys(url,[]);sendJson(response,200,await projectWorkspace(deps,context,decode(workspace[1]),assertCurrent));return true;}
      if(context.profile.role==="child")throw new ClientViewError("domain_profile_not_authorized",403);
      const view:ClientViewName=contact||source||url.pathname==="/v1/contacts"?"contacts":wiki||url.pathname==="/v1/wiki"?"wiki":url.pathname==="/v1/lists"?"lists":"receipts";
      const views=await deps.reads.availableViews(context.profile.id,assertCurrent);
      if(!views.includes(view))throw new ClientViewError("domain_not_authorized",403);
      const read=async(query:ClientReadQuery)=>{assertCurrent();const result=await deps.reads.query(context.profile.id,query,assertCurrent,signal);assertCurrent();return result;};
      let result:unknown;
      if(url.pathname==="/v1/contacts"){
        queryKeys(url,["query","limit"]);result=contactsProjection(await read({kind:"contacts.search",query:search(url,300),limit:limit(url,50,50)}));
      } else if(contact || source) {
        queryKeys(url,[]);const contactId=decode((contact??source)![1]);
        if(!/^contact-[a-f0-9]{32}$/.test(contactId))throw new ClientViewError("contact_not_found",404);
        const raw=await read({kind:"contacts.get",contactId}),record=object(object(raw).contact??raw),projection=contactProjection(record);
        if(source){
          const artifactId=decode(source[2]);if(!/^artifact-[a-f0-9]{64}$/.test(artifactId))throw new ClientViewError("artifact_not_found",404);
          const stored=rows(record.sources).find(item=>item.artifactId===artifactId);if(!stored)throw new ClientViewError("artifact_not_found",404);
          const artifact=await deps.artifacts.read(artifactId,{profileId:context.profile.id,canReadHousehold:context.profile.capabilities.includes("viewHouseholdStatus")});
          assertCurrent();
          const latestRaw=await read({kind:"contacts.get",contactId}),latest=object(object(latestRaw).contact??latestRaw);
          if(latest.audience!==record.audience||latest.currentRevision!==record.currentRevision||!rows(latest.sources).some(item=>item.artifactId===artifactId&&item.sha256===artifact.metadata.sha256)||
            stored.sha256!==artifact.metadata.sha256||projection.audience==="household"&&artifact.metadata.audience!=="household")throw new ClientViewError("contact_revision_conflict",409);
          if(!["image/png","image/jpeg","image/webp","application/pdf"].includes(artifact.metadata.mimeType))throw new ClientViewError("contact_source_media_invalid",415);
          assertCurrent();response.writeHead(200,artifactResponseHeaders(artifact.metadata));response.end(artifact.bytes);return true;
        }
        const revisions=await read({kind:"contacts.revisions",contactId,limit:30});
        const latestRaw=await read({kind:"contacts.get",contactId}),latest=object(object(latestRaw).contact??latestRaw);
        if(latest.currentRevision!==record.currentRevision||latest.audience!==record.audience)throw new ClientViewError("contact_revision_conflict",409);
        result={contact:projection,revisions:revisionsProjection(revisions)};
      } else if(url.pathname==="/v1/lists"){
        queryKeys(url,["scope"]);const selected=scope(url);result=listsProjection(await read({kind:"lists.read",scope:selected}),selected);
      } else if(url.pathname==="/v1/wiki"){
        queryKeys(url,["scope","query","limit"]);const selected=scope(url),query=search(url,2000).trim()||"Household";
        result=wikiSearchProjection(await read({kind:"wiki.search",scope:selected,query,limit:limit(url,50,50)}),selected);
      } else if(wiki){
        queryKeys(url,["scope"]);const selected=scope(url),lookup=managedLookup(decode(wiki[1]));
        result=wikiPageProjection(await read({kind:"wiki.get",scope:selected,lookup}),selected,lookup);
      } else {
        queryKeys(url,["limit"]);result=receiptReviewProjection(await read({kind:"receipts.review",limit:limit(url,100,100)}));
      }
      assertCurrent();sendJson(response,200,result);return true;
    } catch(error) {
      if(!response.headersSent&&!response.destroyed){const failure=knownError(error);sendJson(response,failure.status,{error:failure.code});}
      else if(!response.writableEnded)response.destroy();
      return true;
    } finally {response.removeListener("close",abort);}
  };
}
