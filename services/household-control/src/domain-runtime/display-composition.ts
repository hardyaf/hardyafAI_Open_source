import {DisplayService,SqliteDisplayPublications} from "../display/index.ts";
import type {HouseholdDatabase} from "../database.ts";
import type {ArtifactStore} from "../platform/artifacts.ts";
import type {ListDomain,GoogleDomain,NativeDomainContext} from "../domains/native-domains.ts";
import {listsProjection} from "../client-views/projections.ts";
import {DomainError} from "./common.ts";

/** Composition adapter: display is a projection of the existing domain owners. */
export function composeHouseholdDisplay(options:{database:HouseholdDatabase;artifacts:ArtifactStore;lists:ListDomain;google:GoogleDomain}){
  const sponsor=options.database.getProfile("alex");
  if(!sponsor)throw new DomainError("display_sponsor_unavailable");
  const context=(current:()=>void):NativeDomainContext=>({profileId:sponsor.id,agentId:sponsor.agentId,sessionKey:"display-view",conversationId:"display-view",audience:"household",allowedScopes:["household"],authorizedAttendees:[],assertCurrent:current});
  return new DisplayService({publications:new SqliteDisplayPublications(options.database.domainConnection(),options.artifacts),
    artifacts:{readForPublication:(id,principal)=>{principal.assertCurrent();return options.artifacts.read(id,{profileId:principal.profileId,canReadHousehold:true});}},
    lists:{readHousehold:async(current)=>{const value=listsProjection(await options.lists.execute("household_lists_read",{scope:"household"},context(current)),"household");current();
      const rows=value.items.filter(item=>!item.done);return {shopping:rows.filter(i=>i.kind==="shopping"),tasks:rows.filter(i=>i.kind==="task"),waiting:rows.filter(i=>i.kind==="waiting")};}},
    calendar:{upcomingHousehold:async(query,current)=>{const value=await options.google.execute("household_calendar_list",{from:query.from,to:query.to,limit:query.limit},context(current)) as Record<string,unknown>;
      const raw=value.result??value,record=raw as Record<string,unknown>,items=Array.isArray(raw)?raw:Array.isArray(record.events)?record.events:Array.isArray(record.items)?record.items:[];
      current();return items.map(raw=>{const event=raw as Record<string,unknown>,start=event.start as Record<string,unknown>,end=event.end as Record<string,unknown>;
        return {id:String(event.id),title:String(event.summary??"Household event"),start:String(start.dateTime??start.date),end:String(end.dateTime??end.date),allDay:typeof start.date==="string",...(typeof event.location==="string"?{location:event.location}:{})};});}},
  });
}
