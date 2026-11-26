import {createHash} from "node:crypto";
import {DomainError,fingerprint} from "./common.ts";
import type {ProfileDomainGrant} from "./native-scope.ts";
import type {ClientReadQuery,ClientReadonlyQueries} from "../client-views/contracts.ts";
import type {ContactsService,ContactPrincipal} from "../domains/contacts/index.ts";
import type {ListDomain,MemoryDomain,NativeDomainContext} from "../domains/native-domains.ts";
import {isManagedKnowledgePath} from "../domains/memory/recipes.ts";

type ClientView="contacts"|"lists"|"wiki"|"receipts";
type ReadAuthority={profile:{id:string;agentId:string;role:"admin"|"adult"|"child";capabilities:readonly string[]};grant:ProfileDomainGrant};
export type ClientReceiptReadPrincipal={profileId:string;projectCodes:readonly string[];canReviewReceipts:boolean;assertCurrent():void;signal?:AbortSignal};
export type HouseholdClientQueryPorts={
  authority:{read(profileId:string):ReadAuthority|null};
  contacts:Pick<ContactsService,"search"|"get"|"revisions"|"authorizeSource">;
  lists:Pick<ListDomain,"execute">;
  memory:Pick<MemoryDomain,"execute">;
  receipts:{reviewList(principal:ClientReceiptReadPrincipal,limit:number):Promise<unknown>};
};
const profileIdPattern=/^[a-z][a-z0-9-]{0,63}$/;
function boundedText(value:unknown,max:number,empty=false):string{
  if(typeof value!=="string"||value.length>max||value.includes("\0")||!empty&&!value.trim())throw new DomainError("client_query_invalid");return value;
}
function limit(value:unknown,max:number):number{if(!Number.isSafeInteger(value)||Number(value)<1||Number(value)>max)throw new DomainError("client_query_limit_invalid");return value as number;}
function closed(value:unknown,keys:readonly string[]):Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key))||keys.some(key=>!(key in value)))throw new DomainError("client_query_invalid");return value as Record<string,unknown>;
}

/** Fixed read-only client application queries. A signed handset/device fence is
 * provided by transport, while this application rechecks the current profile,
 * domain grants and private/shared scope. It never fabricates an active run or
 * forwards a caller-selected tool name/payload to native execution.
 */
export class HouseholdClientQueries implements ClientReadonlyQueries {
  private readonly ports:HouseholdClientQueryPorts;
  constructor(ports:HouseholdClientQueryPorts){this.ports=ports;}
  private authority(profileId:string,assertCurrent:()=>void):ReadAuthority{
    assertCurrent();if(!profileIdPattern.test(profileId))throw new DomainError("client_profile_not_authorized",{httpStatus:403});
    const authority=this.ports.authority.read(profileId);
    if(!authority||authority.profile.id!==profileId||authority.profile.role==="child"||!authority.profile.capabilities.includes("chat")||!authority.grant.enabled)
      throw new DomainError("client_profile_not_authorized",{httpStatus:403});
    return authority;
  }
  private shared(authority:ReadAuthority,domain:string):boolean{return authority.grant.scopes.includes("household")&&authority.grant.sharedDomains.includes(domain);}
  private personal(authority:ReadAuthority):boolean{return authority.grant.scopes.includes("personal");}
  availableViews(profileId:string,assertCurrent:()=>void):readonly ClientView[]{
    const authority=this.authority(profileId,assertCurrent),views:ClientView[]=[];
    for(const [view,domain] of [["contacts","contacts"],["lists","lists"],["wiki","memory"]] as const){
      if(authority.grant.domains.includes(domain)&&(this.personal(authority)||this.shared(authority,domain)))views.push(view);
    }
    if(authority.grant.domains.includes("receipts")&&this.personal(authority))views.push("receipts");
    assertCurrent();return views;
  }
  private binding(profileId:string,assertCurrent:()=>void,signal?:AbortSignal){
    const authority=this.authority(profileId,assertCurrent),snapshot=fingerprint(authority);
    const current=()=>{if(signal?.aborted)throw new DomainError("operation_cancelled");assertCurrent();
      if(fingerprint(this.authority(profileId,assertCurrent))!==snapshot)throw new DomainError("client_query_authority_changed",{httpStatus:403});};
    const anchor="client-read-"+createHash("sha256").update(profileId).digest("hex");
    const native=(domain:string,scope:"personal"|"household"):NativeDomainContext=>{
      if(!authority.grant.domains.includes(domain)||scope==="personal"&&!this.personal(authority)||scope==="household"&&!this.shared(authority,domain))
        throw new DomainError("client_query_scope_not_authorized",{httpStatus:403});
      return {profileId,agentId:authority.profile.agentId,sessionKey:anchor,conversationId:anchor,audience:scope==="personal"?"private":"household",
        allowedScopes:[scope],authorizedAttendees:[],assertCurrent:current,signal};
    };
    const contact=():ContactPrincipal=>{
      if(!authority.grant.domains.includes("contacts")||!this.personal(authority)&&!this.shared(authority,"contacts"))throw new DomainError("client_query_scope_not_authorized",{httpStatus:403});
      return {profileId,agentId:authority.profile.agentId,conversationId:anchor,taskId:anchor,audience:this.personal(authority)?"private":"household",
        canReadHousehold:this.shared(authority,"contacts"),canWriteHousehold:false,canEditContacts:false,assertCurrent:current};
    };
    return {authority,current,native,contact};
  }
  async query(profileId:string,request:ClientReadQuery,assertCurrent:()=>void,signal?:AbortSignal):Promise<unknown>{
    const bound=this.binding(profileId,assertCurrent,signal);bound.current();
    let result:unknown;
    switch(request?.kind){
      case "contacts.search":{
        const input=closed(request,["kind","query","limit"]);
        result=this.ports.contacts.search(bound.contact(),{query:boundedText(input.query,300,true),limit:limit(input.limit,50)});break;
      }
      case "contacts.get":{
        const input=closed(request,["kind","contactId"]),id=boundedText(input.contactId,80);
        if(!/^contact-[a-f0-9]{32}$/.test(id))throw new DomainError("client_query_invalid");
        result=this.ports.contacts.get(bound.contact(),id);break;
      }
      case "contacts.revisions":{
        const input=closed(request,["kind","contactId","limit"]),id=boundedText(input.contactId,80);
        if(!/^contact-[a-f0-9]{32}$/.test(id))throw new DomainError("client_query_invalid");
        result=this.ports.contacts.revisions(bound.contact(),id,limit(input.limit,100));break;
      }
      case "lists.read":{
        const input=closed(request,["kind","scope"]);if(input.scope!=="personal"&&input.scope!=="household")throw new DomainError("client_query_invalid");
        result=await this.ports.lists.execute("household_lists_read",{scope:input.scope},bound.native("lists",input.scope));break;
      }
      case "wiki.search":{
        const input=closed(request,["kind","scope","query","limit"]);if(input.scope!=="personal"&&input.scope!=="household")throw new DomainError("client_query_invalid");
        const query=boundedText(input.query,2000,true).trim();
        result=await this.ports.memory.execute("household_memory_search",{scope:input.scope,query:query||"Household",limit:limit(input.limit,50)},bound.native("memory",input.scope));break;
      }
      case "wiki.get":{
        const input=closed(request,["kind","scope","lookup"]);if(input.scope!=="personal"&&input.scope!=="household")throw new DomainError("client_query_invalid");
        const lookup=boundedText(input.lookup,240);
        if(!isManagedKnowledgePath(lookup))throw new DomainError("client_managed_wiki_lookup_required",{httpStatus:403});
        result=await this.ports.memory.execute("household_memory_get",{scope:input.scope,lookup,fromLine:1,lineCount:400},bound.native("memory",input.scope));break;
      }
      case "receipts.review":{
        const input=closed(request,["kind","limit"]);
        if(!bound.authority.grant.domains.includes("receipts")||!this.personal(bound.authority))throw new DomainError("client_query_scope_not_authorized",{httpStatus:403});
        result=await this.ports.receipts.reviewList({profileId,projectCodes:[...bound.authority.grant.projectCodes],canReviewReceipts:bound.authority.grant.canReviewReceipts,assertCurrent:bound.current,signal},limit(input.limit,100));break;
      }
      default:throw new DomainError("client_query_unsupported",{httpStatus:404});
    }
    bound.current();return result;
  }
  authorizeContactSource(profileId:string,sourceArtifactId:string,assertCurrent:()=>void):boolean{
    const bound=this.binding(profileId,assertCurrent);
    if(!/^artifact-[a-f0-9]{64}$/.test(sourceArtifactId))return false;
    const allowed=this.ports.contacts.authorizeSource(bound.contact(),sourceArtifactId);bound.current();return allowed;
  }
}
