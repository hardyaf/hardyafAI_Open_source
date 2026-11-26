import path from "node:path";
import { descriptor, integerProperty, NativeDomainError, objectSchema, scopeProperty, textProperty } from "../native-contracts.ts";
import type { NativeDomainContext, NativeJsonRunner, NativeScope } from "../native-contracts.ts";
import { closed, dateOnly, integer, operation, record, scope, text, choice } from "../native-validation.ts";

const item = objectSchema({ kind: { type: "string", enum: ["shopping","task","waiting","note"] }, scope: scopeProperty, text: { ...textProperty(10_000), description:"Requested item wording only; preserve quoted text. Keep due dates, IDs, checkboxes and confidence in their own fields, without rendered metadata suffixes." }, title: textProperty(180), due: { type:"string",format:"date", description:"ISO due date, separate from item text; the owning store renders the due annotation." }, confidence: { type:"string",enum:["user-stated","confirmed","inferred","unknown"] } }, ["kind","scope","text"]);
export const listTools = [
  descriptor("household_lists_read", "Read canonical scoped shopping/task/waiting/completed/removed items with stable IDs. This does not read another person's private store.", "lists.read", { scope:scopeProperty },["scope"]),
  descriptor("household_lists_capture", "Save one or more list items or reference notes in the existing canonical Markdown store. Calendar events and durable memory facts use their own capabilities.", "lists.write", { items:{type:"array",minItems:1,maxItems:50,items:item} },["items"],"write"),
  descriptor("household_lists_complete", "Move the exact stable item ID into Completed. Repeating the same operation returns its durable receipt.", "lists.write", {scope:scopeProperty,id:textProperty(40)},["scope","id"],"write"),
  descriptor("household_lists_restore", "Restore the exact completed/removed stable item ID in its canonical store.", "lists.write", {scope:scopeProperty,id:textProperty(40)},["scope","id"],"write"),
  descriptor("household_lists_remove", "Recoverably remove the exact stable item ID from the authorized active list. It remains in Removed and can be restored; no second confirmation is needed.", "lists.write", {scope:scopeProperty,id:textProperty(40)},["scope","id"],"write"),
  descriptor("household_lists_search_notes", "Search the scoped canonical captured reference notes before broad semantic recall.", "lists.read", {scope:scopeProperty,query:textProperty(500),limit:integerProperty(1,100)},["scope","query"]),
  descriptor("household_lists_recent_notes", "Read recent scoped reference notes with their stored IDs and content.", "lists.read", {scope:scopeProperty,limit:integerProperty(1,100)},["scope"]),
  descriptor("household_lists_display", "Build a read-only display projection from the existing canonical list/note store. Only household scope is eligible for shared kitchen publication.", "lists.read", {scope:scopeProperty},["scope"]),
];

export type ListDomainConfig = { python:string; script:string; workspaces:Readonly<Record<string,string>> };
function presentation(value:unknown):unknown {
  if(Array.isArray(value))return value.map(presentation);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).filter(([key])=>!["workspace","household_lists","personal_lists","household_notes","personal_notes","path","file","lock_path"].includes(key)).map(([key,item])=>[key,key==="error"?"capture_error":presentation(item)]));
  return value;
}
export class ListDomain {
  private readonly config:ListDomainConfig;
  private readonly runner:NativeJsonRunner;
  constructor(config:ListDomainConfig,runner:NativeJsonRunner) {this.config=config;this.runner=runner;}
  private workspace(context: NativeDomainContext): string {
    const workspace=this.config.workspaces[context.agentId];
    if (!workspace || !path.isAbsolute(workspace) || !path.isAbsolute(this.config.script) || !path.isAbsolute(this.config.python)) throw new NativeDomainError("lists_not_configured",503);
    return workspace;
  }
  async readReferenceNote(selected: NativeScope, id: string, context: NativeDomainContext): Promise<string> {
    const workspace = this.workspace(context);
    scope(selected,context);
    const result = record(await this.runner.runJson(this.config.python,[this.config.script,"--workspace",workspace,"read-note","--scope",selected,"--id",id],
      {cwd:workspace,timeoutMs:15_000,maxBytes:60_000,signal:context.signal,assertCurrent:context.assertCurrent}));
    if (!result.note) throw new NativeDomainError("reference_note_not_found",404);
    const note = record(result.note);
    if (note.id !== id || note.visibility !== selected) throw new NativeDomainError("reference_note_scope_mismatch",503);
    return text(note.text,10_000);
  }
  async execute(name:string,args:unknown,context:NativeDomainContext):Promise<unknown> {
    const workspace = this.workspace(context);
    const suffix=name.replace("household_lists_","");
    let command:string[];
    if(suffix==="capture") {
      const input=closed(args,["operationId","items"],["operationId","items"]);operation(input.operationId);
      if(!Array.isArray(input.items)||input.items.length<1||input.items.length>50)throw new NativeDomainError("invalid_items");
      const items=input.items.map(raw=>{
        const value=closed(raw,["kind","scope","text","title","due","confidence"],["kind","scope","text"]);
        const kind=choice(value.kind,["shopping","task","waiting","note"]);
        const output:Record<string,unknown>={kind,scope:scope(value.scope,context),text:text(value.text,kind==="note"?10_000:1000)};
        if(value.title!==undefined)output.title=text(value.title,180);
        if(value.due!==undefined)output.due=dateOnly(value.due);
        // List confidence is presentation metadata, never a durable memory trust grant.
        if(value.confidence!==undefined)output.confidence=choice(value.confidence,["user-stated","confirmed","inferred","unknown"]);
        return output;
      });
      command=["capture","--payload-json",JSON.stringify({items})];
    } else {
      const mutation=["complete","restore","remove"].includes(suffix);
      const input=closed(args,["scope",...(mutation?["id","operationId"]:suffix==="search_notes"?["query","limit"]:suffix==="recent_notes"?["limit"]:[])],["scope",...(mutation?["id","operationId"]:suffix==="search_notes"?["query"]:[])]);
      const selected=scope(input.scope,context);
      if(suffix==="read"||suffix==="display")command=[suffix==="read"?"show":"dashboard","--scope",selected];
      else if(suffix==="search_notes"||suffix==="recent_notes")command=[suffix.replaceAll("_","-"),"--scope",selected,...(suffix==="search_notes"?["--query",text(input.query,500)]:[]),"--limit",String(integer(input.limit,10))];
      else if(mutation) {
        operation(input.operationId);const id=text(input.id,40);
        if(!/^[A-Z]+-\d{8}-\d{4}$/.test(id))throw new NativeDomainError("invalid_item_id");
        command=[suffix,"--scope",selected,"--id",id,...(suffix==="remove"?["--confirm",id]:[])];
      } else throw new NativeDomainError("unknown_tool",404);
    }
    context.assertCurrent();
    const mutating=["capture","complete","restore","remove"].includes(suffix);
    try{
      const result=record(await this.runner.runJson(this.config.python,[this.config.script,"--workspace",workspace,...command],{cwd:workspace,timeoutMs:15_000,maxBytes:1_500_000,signal:context.signal,assertCurrent:context.assertCurrent,effect:mutating}));
      if(result.ok===false)throw new NativeDomainError("list_operation_failed",409,mutating?"unknown":"not_sent");
      return {source:"canonical_household_capture",untrusted:true,result:presentation(result)};
    }catch(error){if(mutating)throw new NativeDomainError("list_write_outcome_unknown",502,"unknown");throw error;}
  }
}
