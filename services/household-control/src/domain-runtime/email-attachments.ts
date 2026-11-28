import path from 'node:path';
import type {ArtifactStore,ArtifactPrincipal,ArtifactScope} from '../platform/artifacts.ts';
import type {WorkshopConfiguration} from '../platform/workshop-profile.ts';
import {captureWorkshopFiles} from './workshop-deliveries.ts';
import {DomainError} from './common.ts';
/** Resolve only scoped artifact handles or the current owner's verified native namespace. */
export async function emailAttachments(options:{args:Record<string,unknown>;artifacts:ArtifactStore;principal:ArtifactPrincipal;scope:ArtifactScope;workshop?:WorkshopConfiguration;allowedArtifactIds:string[];assertCurrent():void}){
 const {args}=options;if(args.attachments===undefined)return args;
 if(!Array.isArray(args.attachments))throw new DomainError('invalid_arguments');
 const attachments=[];let total=0;
 for(const item of args.attachments){
  options.assertCurrent();const part=item as Record<string,unknown>;let id=part.artifactId;
  if(part.workspacePath!==undefined){
   if(!options.workshop||typeof part.workspacePath!=='string'||!path.posix.isAbsolute(part.workspacePath))throw new DomainError('workshop_attachment_unavailable');
   const files=await captureWorkshopFiles({configuration:options.workshop,artifacts:options.artifacts,scope:options.scope,principal:options.principal,sourceId:String(args.operationId),files:[path.posix.normalize(part.workspacePath)],assertCurrent:options.assertCurrent});id=files[0]?.id;
  }
  if(typeof id!=='string')throw new DomainError('artifact_not_found');
  const meta=await options.artifacts.get(id,options.principal);
  const bound=meta.ownerProfileId===options.scope.ownerProfileId&&meta.conversationId===options.scope.conversationId&&meta.audience===options.scope.audience&&[options.scope.taskId,'conversation:'+options.scope.conversationId].includes(meta.taskId);
  if(!bound&&!options.allowedArtifactIds.includes(id))throw new DomainError('artifact_scope_mismatch',{httpStatus:403});
  // Gmail's documented raw-message ceiling is 35 MiB; attachments alone cannot exceed it.
  total+=meta.byteLength;if(total>35*1024*1024)throw new DomainError('gmail_message_exceeds_provider_limit');
  const opened=await options.artifacts.openDownload(id,options.principal),chunks:Buffer[]=[];
  for await(const chunk of opened.stream)chunks.push(Buffer.from(chunk));options.assertCurrent();
  let filename=path.posix.basename(String(part.filename??meta.filename).replace(/\\/g,'/')).replace(/[\r\n\x00]/g,'_');if(!filename||filename==='.'||filename==='..')filename='attachment.bin';
  attachments.push({filename,mimeType:meta.mimeType,data:Buffer.concat(chunks).toString('base64url')});
 }
 return {...args,attachments};
}
