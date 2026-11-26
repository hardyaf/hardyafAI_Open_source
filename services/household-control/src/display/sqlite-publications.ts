import type {DatabaseSync} from "node:sqlite";
import type {ArtifactStore} from "../platform/artifacts.ts";
import {DisplayError} from "./service.ts";
import type {DisplayPorts,DisplayPublication,DisplayPublicationDraft} from "./contracts.ts";
type Row=Record<string,unknown>;
type Connection=Pick<DatabaseSync,"prepare"|"exec">;
type ArtifactPort=Pick<ArtifactStore,"put"|"read">;
type PublicationPort=DisplayPorts["publications"];
const idPattern=/^display-[a-f0-9]{64}$/;

/** Adapter over the application-owned publication projection and ArtifactStore.
 * The application schema owns display_publications, including manifest_json.
 * This module never initializes/migrates a table or stores a second content copy.
 */
export class SqliteDisplayPublications implements PublicationPort {
  private readonly db:Connection;
  private readonly artifacts:ArtifactPort;
  private readonly clock:()=>Date;
  constructor(db:Connection,artifacts:ArtifactPort,clock:()=>Date=()=>new Date()){this.db=db;this.artifacts=artifacts;this.clock=clock;}
  private row(id:string):Row|undefined{return this.db.prepare("SELECT * FROM display_publications WHERE id=?").get(id) as Row|undefined;}
  private decode(row:Row):DisplayPublication{
    let value:DisplayPublication;
    try{value=JSON.parse(String(row.manifest_json)) as DisplayPublication;}catch{throw new DisplayError("display_publication_record_invalid",503);}
    if(!value||value.id!==row.id||!idPattern.test(value.id)||value.audience!=="household"||value.ownerProfileId!==row.owner_profile_id||
      value.sourcePromptId!==row.source_prompt_id||value.title!==row.title||value.expiresAt!==row.expires_at||value.publishedAt!==row.created_at||
      !/^[a-f0-9]{64}$/.test(value.fingerprint)||!/^artifact-[a-f0-9]{64}$/.test(String(row.artifact_id)))throw new DisplayError("display_publication_record_invalid",503);
    return value;
  }
  private replay(row:Row,draft:DisplayPublicationDraft):DisplayPublication{
    const value=this.decode(row);
    if(value.fingerprint!==draft.fingerprint||Object.keys(draft).some(key=>(value as unknown as Row)[key]!==draft[key as keyof DisplayPublicationDraft]))
      throw new DisplayError("display_publication_conflict",409);
    if(row.revoked_at!==null)throw new DisplayError("display_publication_revoked",409);
    return value;
  }
  private transaction<T>(operation:()=>T):T{
    this.db.exec("BEGIN IMMEDIATE");try{const value=operation();this.db.exec("COMMIT");return value;}catch(error){try{this.db.exec("ROLLBACK");}catch{}throw error;}
  }
  async commit(draft:DisplayPublicationDraft,bytes:Buffer,current:()=>void):Promise<DisplayPublication>{
    current();if(!idPattern.test(draft.id)||draft.audience!=="household")throw new DisplayError("display_publication_record_invalid");
    const prior=this.row(draft.id);if(prior){const replay=this.replay(prior,draft);current();return replay;}
    const suffix={"image/png":"png","image/jpeg":"jpg","image/webp":"webp","text/plain":"txt"}[draft.mimeType];
    if(!suffix)throw new DisplayError("display_media_unsupported",415);
    // Reuse immutable artifact ownership and content integrity. An interrupted
    // copy can leave an unreferenced artifact, never an active publication.
    const principal={profileId:draft.ownerProfileId,canReadHousehold:true};
    const artifact=await this.artifacts.put({ownerProfileId:draft.ownerProfileId,conversationId:draft.conversationId,taskId:draft.taskId,audience:"household"},principal,
      {bytes,filename:"household-display."+suffix,mimeType:draft.mimeType,kind:"output",idempotencyKey:"display-publication:"+draft.id});current();
    const readback=await this.artifacts.read(artifact.id,principal);current();
    if(readback.metadata.audience!=="household"||readback.metadata.kind!=="output"||readback.metadata.sha256!==draft.sha256||readback.metadata.mimeType!==draft.mimeType||
      readback.metadata.byteLength!==draft.byteLength||!readback.bytes.equals(bytes))throw new DisplayError("display_content_integrity_failed",503);
    const committed=this.transaction(()=>{
      current();const raced=this.row(draft.id);if(raced)return this.replay(raced,draft);
      const value:DisplayPublication={...draft,publishedAt:this.clock().toISOString()};
      const manifest=JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left],[right])=>left.localeCompare(right))));
      this.db.prepare("INSERT INTO display_publications(id,artifact_id,owner_profile_id,source_prompt_id,title,expires_at,revoked_at,created_at,manifest_json) VALUES (?,?,?,?,?,?,NULL,?,?)")
        .run(value.id,artifact.id,value.ownerProfileId,value.sourcePromptId,value.title,value.expiresAt,value.publishedAt,manifest);
      const stored=this.row(value.id);if(!stored)throw new DisplayError("display_publication_readback_failed",503,"unknown");return this.replay(stored,draft);
    });
    current();return committed;
  }
  async listActive(now:string,limit:number,current:()=>void):Promise<DisplayPublication[]>{
    current();if(!Number.isFinite(Date.parse(now))||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new DisplayError("display_query_invalid");
    const rows=this.db.prepare("SELECT * FROM display_publications WHERE revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC,id LIMIT ?").all(now,limit) as Row[];
    const result=rows.map(row=>this.decode(row));current();return result;
  }
  async getActive(id:string,now:string,current:()=>void):Promise<DisplayPublication|null>{
    current();if(!idPattern.test(id)||!Number.isFinite(Date.parse(now)))throw new DisplayError("display_query_invalid");
    const row=this.row(id);if(!row||row.revoked_at!==null||Date.parse(String(row.expires_at))<=Date.parse(now))return null;
    const value=this.decode(row);current();return value;
  }
  async readContent(publication:DisplayPublication,current:()=>void):Promise<Buffer>{
    current();const row=this.row(publication.id);
    if(!row||row.revoked_at!==null||Date.parse(String(row.expires_at))<=this.clock().getTime())throw new DisplayError("display_publication_not_found",404);
    const stored=this.decode(row);if(stored.fingerprint!==publication.fingerprint)throw new DisplayError("display_publication_not_found",404);
    const result=await this.artifacts.read(String(row.artifact_id),{profileId:stored.ownerProfileId,canReadHousehold:true});current();
    const metadata=result.metadata;
    if(metadata.audience!=="household"||metadata.ownerProfileId!==stored.ownerProfileId||metadata.conversationId!==stored.conversationId||metadata.taskId!==stored.taskId||
      metadata.kind!=="output"||metadata.mimeType!==stored.mimeType||metadata.sha256!==stored.sha256||metadata.byteLength!==stored.byteLength)
      throw new DisplayError("display_content_integrity_failed",503);
    const latest=this.row(publication.id);if(!latest||latest.revoked_at!==null||Date.parse(String(latest.expires_at))<=this.clock().getTime()||this.decode(latest).fingerprint!==stored.fingerprint)
      throw new DisplayError("display_publication_not_found",404);
    current();return result.bytes;
  }
}
