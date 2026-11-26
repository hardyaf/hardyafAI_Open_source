/** Narrow application ports. Composition adapts the existing list/calendar,
 * signed device, artifact and publication authorities; no new store lives here.
 */
export type DisplayMediaType="image/png"|"image/jpeg"|"image/webp"|"text/plain";
export type DisplayListItem={id:string;text:string;due?:string|null};
export type HouseholdListProjection={shopping:DisplayListItem[];tasks:DisplayListItem[];waiting:DisplayListItem[]};
export type HouseholdEventProjection={id:string;title:string;start:string;end:string;allDay:boolean;timeZone?:string;location?:string};
export type DisplayReader={deviceId:string;deviceKind:"display";assertCurrent():void};
export type DisplayPublisher={profileId:string;role:"admin"|"adult"|"child";conversationId:string;taskId:string;sourcePromptId:string;
  sourcePromptCreatedAt:string;taskMode:"standard"|"diagnostic";canPublishHousehold:boolean;assertCurrent():void};

/** Root-verified current human source authority, never deserialized from model
 * tool arguments. Root classifies output from trusted provenance; in particular
 * diagnostics, credential material and financial reports cannot gain this grant.
 */
export type DisplayPublishAuthorization={purpose:"display_publish";sourcePromptId:string;artifactId:string;artifactSha256:string;
  contentClass:"household_output";artifactConversationId?:string;artifactTaskId?:string;issuedAt:string;expiresAt:string;publicationExpiresAt:string};
export type DisplaySourceArtifact={id:string;ownerProfileId:string;conversationId:string;taskId:string;audience:"private"|"household";
  kind:"input"|"output"|"evidence";mimeType:string;byteLength:number;sha256:string};
export type DisplayPublishInput={operationId:string;artifactId:string;title:string;expiresAt?:string};

export type DisplayPublicationDraft={id:string;audience:"household";ownerProfileId:string;conversationId:string;taskId:string;
  sourcePromptId:string;operationId:string;sourceArtifactId:string;sha256:string;mimeType:DisplayMediaType;byteLength:number;
  title:string;expiresAt:string;fingerprint:string};
export type DisplayPublication=DisplayPublicationDraft&{publishedAt:string};
export type DisplayPublicationSummary={id:string;title:string;mimeType:DisplayMediaType;byteLength:number;sha256:string;
  publishedAt:string;expiresAt:string;contentPath:string};
export type DisplaySnapshot={schemaVersion:1;generatedAt:string;
  householdLists:{status:"ready"|"unavailable";shopping:DisplayListItem[];tasks:DisplayListItem[];waiting:DisplayListItem[]};
  upcomingEvents:{status:"ready"|"unavailable";from:string;to:string;events:HouseholdEventProjection[]};
  publicationStatus:"ready"|"unavailable";publications:DisplayPublicationSummary[]};

export interface DisplayPorts {
  lists:{readHousehold(current:()=>void):Promise<HouseholdListProjection>};
  calendar:{upcomingHousehold(query:{from:string;to:string;limit:number},current:()=>void):Promise<HouseholdEventProjection[]>};
  artifacts:{readForPublication(artifactId:string,principal:DisplayPublisher):Promise<{metadata:DisplaySourceArtifact;bytes:Buffer}>};
  publications:{
    /** Commit through the existing artifact/DB authorities. Bytes are immutable,
     * household-only. Same id+fingerprint replays; changed input conflicts.
     * Assign publishedAt on first commit and retain it on replay. Recheck current
     * before the durable side effect and return only after readback/commit.
     */
    commit(draft:DisplayPublicationDraft,bytes:Buffer,current:()=>void):Promise<DisplayPublication>;
    listActive(now:string,limit:number,current:()=>void):Promise<DisplayPublication[]>;
    getActive(id:string,now:string,current:()=>void):Promise<DisplayPublication|null>;
    /** Resolve only this recorded publication's household copy. Never resolve
     * arbitrary caller-provided artifact IDs or a private source fallback.
     */
    readContent(publication:DisplayPublication,current:()=>void):Promise<Buffer>;
  };
  clock?:()=>Date;
}
