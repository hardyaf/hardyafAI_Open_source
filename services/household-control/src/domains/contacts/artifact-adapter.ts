import type { ArtifactStore } from "../../platform/artifacts.ts";
import { ContactsError } from "./types.ts";
import type { ContactAudience, ContactPrincipal, ContactSource, ContactsSourceAccess } from "./types.ts";
import { assertPrincipal } from "./validation.ts";

const media = new Set(["image/png","image/jpeg","image/webp","application/pdf"]);
/** Composition adapter: no provider/filesystem objects leak through ContactsSourceAccess. */
export class ArtifactContactsSourceAccess implements ContactsSourceAccess {
  private readonly artifacts:ArtifactStore;
  constructor(artifacts:ArtifactStore){this.artifacts=artifacts;}
  private principal(context:ContactPrincipal){return {profileId:context.profileId,canReadHousehold:context.canReadHousehold};}
  async inspect(context:ContactPrincipal,artifactId:string):Promise<ContactSource>{
    assertPrincipal(context);
    const source=await this.artifacts.get(artifactId,this.principal(context));
    const explicit=context.allowedArtifactIds?.includes(artifactId)===true;
    const bound=source.ownerProfileId===context.profileId&&source.conversationId===context.conversationId&&[context.taskId,'conversation:'+context.conversationId].includes(source.taskId);
    if(!bound&&!explicit)throw new ContactsError('contact_source_not_authorized',403);
    if(!media.has(source.mimeType))throw new ContactsError('contact_source_media_unsupported',415);
    return {artifactId:source.id,sha256:source.sha256,mimeType:source.mimeType,byteLength:source.byteLength,filename:source.filename,
      audience:source.audience,ownerProfileId:source.ownerProfileId,conversationId:source.conversationId,taskId:source.taskId};
  }
  async publishCardSource(context:ContactPrincipal,source:ContactSource,audience:ContactAudience,operationId:string):Promise<ContactSource>{
    assertPrincipal(context,true,audience);
    // inspect again at the effect boundary; an artifact ID never supplies authority.
    const current=await this.inspect(context,source.artifactId);
    if(current.sha256!==source.sha256)throw new ContactsError('contact_source_changed',409);
    const bytes=await this.artifacts.read(source.artifactId,this.principal(context));
    assertPrincipal(context,true,audience);
    const extension:Record<string,string>={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','application/pdf':'.pdf'};
    const published=await this.artifacts.put({ownerProfileId:context.profileId,conversationId:context.conversationId,taskId:context.taskId,audience},this.principal(context),{
      bytes:bytes.bytes,filename:'card-source'+extension[source.mimeType],mimeType:source.mimeType,kind:'input',idempotencyKey:'contacts-source:'+operationId,
    });
    return {artifactId:published.id,sha256:published.sha256,mimeType:published.mimeType,byteLength:published.byteLength,filename:published.filename,
      audience:published.audience,ownerProfileId:published.ownerProfileId,conversationId:published.conversationId,taskId:published.taskId};
  }
}
