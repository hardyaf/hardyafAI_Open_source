import type {DatabaseSync} from "node:sqlite";
import type {ConversationFolder} from "./domain.ts";

export const conversationOrganizationMigration=[
 "CREATE TABLE IF NOT EXISTS conversation_folders(id TEXT PRIMARY KEY,owner_profile_id TEXT NOT NULL REFERENCES profiles(id),name TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT);",
 "CREATE INDEX IF NOT EXISTS conversation_folders_owner ON conversation_folders(owner_profile_id,deleted_at,name);",
 "CREATE TABLE IF NOT EXISTS conversation_folder_placements(profile_id TEXT NOT NULL REFERENCES profiles(id),conversation_id TEXT NOT NULL REFERENCES conversations(id),folder_id TEXT NOT NULL REFERENCES conversation_folders(id),PRIMARY KEY(profile_id,conversation_id));",
].join("\n");
export class ConversationOrganizationError extends Error{
 readonly code:string;readonly statusCode:number;
 constructor(code:string,statusCode=400){super(code);this.name="ConversationOrganizationError";this.code=code;this.statusCode=statusCode;}
}
export function folderName(value:unknown):string{
 if(typeof value!=="string"||!value.trim()||value.trim().length>80||/\p{Cc}/u.test(value))throw new ConversationOrganizationError("invalid_folder_name");
 return value.trim();
}
export function folderIdentity(value:unknown):string{
 if(typeof value!=="string"||!/^folder-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new ConversationOrganizationError("invalid_folder_id");
 return value;
}
function fromRow(row:Record<string,unknown>):ConversationFolder{
 return{id:String(row.id),name:String(row.name),createdAt:String(row.created_at),updatedAt:String(row.updated_at)};
}
/** Sidebar metadata only, in the canonical household DB. Placement grants no access. */
export class ConversationOrganizationRepository{
 private readonly database:DatabaseSync;
 constructor(database:DatabaseSync){this.database=database;}
 list(profileId:string):ConversationFolder[]{
  return this.database.prepare("SELECT * FROM conversation_folders WHERE owner_profile_id=? AND deleted_at IS NULL ORDER BY name COLLATE NOCASE,id").all(profileId).map(fromRow);
 }
 create(profileId:string,id:string,name:string):{folder:ConversationFolder;created:boolean}{
  folderIdentity(id);name=folderName(name);
  const now=new Date().toISOString();
  const result=this.database.prepare("INSERT OR IGNORE INTO conversation_folders(id,owner_profile_id,name,created_at,updated_at) VALUES(?,?,?,?,?)").run(id,profileId,name,now,now);
  const row=this.database.prepare("SELECT * FROM conversation_folders WHERE id=? AND owner_profile_id=?").get(id,profileId);
  if(!row||row.deleted_at!=null||row.name!==name)throw new ConversationOrganizationError("folder_operation_conflict",409);
  return{folder:fromRow(row),created:Number(result.changes)===1};
 }
 rename(profileId:string,id:string,name:string):ConversationFolder|undefined{
  name=folderName(name);
  this.database.prepare("UPDATE conversation_folders SET name=?,updated_at=? WHERE id=? AND owner_profile_id=? AND deleted_at IS NULL").run(name,new Date().toISOString(),id,profileId);
  const row=this.database.prepare("SELECT * FROM conversation_folders WHERE id=? AND owner_profile_id=? AND deleted_at IS NULL").get(id,profileId);
  return row?fromRow(row):undefined;
 }
 remove(profileId:string,id:string):boolean{
  this.database.exec("BEGIN IMMEDIATE");
  try{
   const row=this.database.prepare("SELECT id FROM conversation_folders WHERE id=? AND owner_profile_id=?").get(id,profileId);
   if(!row){this.database.exec("COMMIT");return false;}
   const now=new Date().toISOString();
   this.database.prepare("UPDATE conversation_folders SET deleted_at=COALESCE(deleted_at,?),updated_at=CASE WHEN deleted_at IS NULL THEN ? ELSE updated_at END WHERE id=? AND owner_profile_id=?").run(now,now,id,profileId);
   this.database.prepare("DELETE FROM conversation_folder_placements WHERE profile_id=? AND folder_id=?").run(profileId,id);
   this.database.exec("COMMIT");return true;
  }catch(error){this.database.exec("ROLLBACK");throw error;}
 }
 placement(profileId:string,conversationId:string):string|null{
  const row=this.database.prepare("SELECT p.folder_id FROM conversation_folder_placements p JOIN conversation_folders f ON f.id=p.folder_id AND f.owner_profile_id=p.profile_id AND f.deleted_at IS NULL WHERE p.profile_id=? AND p.conversation_id=?").get(profileId,conversationId);
  return row?String(row.folder_id):null;
 }
 place(profileId:string,conversationId:string,folderId:string|null):void{
  if(folderId!==null){
   folderIdentity(folderId);
   const folder=this.database.prepare("SELECT id FROM conversation_folders WHERE id=? AND owner_profile_id=? AND deleted_at IS NULL").get(folderId,profileId);
   if(!folder)throw new ConversationOrganizationError("folder_not_found",404);
   const result=this.database.prepare("INSERT INTO conversation_folder_placements(profile_id,conversation_id,folder_id) SELECT ?,?,id FROM conversation_folders WHERE id=? AND owner_profile_id=? AND deleted_at IS NULL ON CONFLICT(profile_id,conversation_id) DO UPDATE SET folder_id=excluded.folder_id").run(profileId,conversationId,folderId,profileId);
   if(Number(result.changes)!==1)throw new ConversationOrganizationError("folder_not_found",404);
  }else this.database.prepare("DELETE FROM conversation_folder_placements WHERE profile_id=? AND conversation_id=?").run(profileId,conversationId);
 }
 hasUnsettled(conversationId:string):boolean{
  return Boolean(this.database.prepare("SELECT 1 FROM submissions WHERE conversation_id=? AND (status IN('queued','dispatching','running','waiting_for_user') OR recovery_required=1) LIMIT 1").get(conversationId));
 }
 tombstone(conversationId:string,profileId:string,agentId:string):boolean{
  const result=this.database.prepare("UPDATE conversations SET deleted_at=? WHERE id=? AND owner_profile_id=? AND agent_id=? AND deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM submissions WHERE conversation_id=? AND (status IN('queued','dispatching','running','waiting_for_user') OR recovery_required=1))")
   .run(new Date().toISOString(),conversationId,profileId,agentId,conversationId);
  return Number(result.changes)===1;
 }
}
