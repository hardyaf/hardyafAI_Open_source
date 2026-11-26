import type {IncomingMessage,ServerResponse} from "node:http";
import type {RequestContext} from "./server.ts";
import type {HouseholdStoreApi} from "./household-store.ts";
import {parseJson,requireCapability,sendJson} from "./http-codec.ts";
import {ConversationOrganizationError,folderIdentity,folderName} from "./conversation-organization.ts";

/** Authenticated transport for private sidebar organization; no native content effects. */
export function createConversationOrganizationRoutes(store:HouseholdStoreApi){
 return async(request:IncomingMessage,response:ServerResponse,url:URL,body:Buffer,context:RequestContext):Promise<boolean>=>{
  const folders=url.pathname==="/v1/conversation-folders",folderMatch=url.pathname.match(/^\/v1\/conversation-folders\/([^/]+)$/),
   placementMatch=url.pathname.match(/^\/v1\/conversations\/([^/]+)\/folder$/),deleteMatch=url.pathname.match(/^\/v1\/conversations\/([^/]+)$/);
  if(!folders&&!folderMatch&&!placementMatch&&!(deleteMatch&&request.method==="DELETE"))return false;
  if(!requireCapability(response,context,"chat"))return true;
  try{
   const profile=context.profile;
   if(folders&&request.method==="GET"){
    if(!store.listConversationFolders)throw new ConversationOrganizationError("conversation_organization_unavailable",503);
    sendJson(response,200,{folders:store.listConversationFolders(profile)});return true;
   }
   if(folders&&request.method==="POST"){
    if(!store.createConversationFolder)throw new ConversationOrganizationError("conversation_organization_unavailable",503);
    const input=parseJson(body);
    if(Object.keys(input).some(key=>!["folderId","name"].includes(key)))throw new ConversationOrganizationError("invalid_folder");
    const result=store.createConversationFolder(profile,folderIdentity(input.folderId),folderName(input.name));
    sendJson(response,result.created?201:200,{folder:result.folder});return true;
   }
   if(folderMatch&&request.method==="PUT"){
    if(!store.renameConversationFolder)throw new ConversationOrganizationError("conversation_organization_unavailable",503);
    const input=parseJson(body);if(Object.keys(input).some(key=>key!=="name"))throw new ConversationOrganizationError("invalid_folder");
    const folder=store.renameConversationFolder(profile,folderIdentity(decodeURIComponent(folderMatch[1])),folderName(input.name));
    sendJson(response,folder?200:404,folder?{folder}:{error:"folder_not_found"});return true;
   }
   if(folderMatch&&request.method==="DELETE"){
    if(!store.deleteConversationFolder)throw new ConversationOrganizationError("conversation_organization_unavailable",503);
    const deleted=store.deleteConversationFolder(profile,folderIdentity(decodeURIComponent(folderMatch[1])));
    sendJson(response,deleted?200:404,deleted?{deleted:true}:{error:"folder_not_found"});return true;
   }
   if(placementMatch&&request.method==="PUT"){
    if(!store.moveConversationToFolder)throw new ConversationOrganizationError("conversation_organization_unavailable",503);
    const input=parseJson(body);
    if(Object.keys(input).length!==1||!Object.hasOwn(input,"folderId"))throw new ConversationOrganizationError("invalid_folder");
    const folderId=input.folderId===null?null:folderIdentity(input.folderId);
    const conversation=store.moveConversationToFolder(profile,decodeURIComponent(placementMatch[1]),folderId);
    sendJson(response,conversation?200:404,conversation?{conversation}:{error:"conversation_not_found"});return true;
   }
   if(deleteMatch&&request.method==="DELETE"){
    if(!store.deleteConversation)throw new ConversationOrganizationError("conversation_organization_unavailable",503);
    const deleted=await store.deleteConversation(profile,decodeURIComponent(deleteMatch[1]),context.device.kind==="signed"?context.device.deviceId:undefined);
    sendJson(response,deleted?200:404,deleted?{deleted:true,retained:true}:{error:"conversation_not_found"});return true;
   }
   sendJson(response,405,{error:"method_not_allowed"});return true;
  }catch(error){
   if(!(error instanceof ConversationOrganizationError))throw error;
   sendJson(response,error.statusCode,{error:error.code});return true;
  }
 };
}
