import {createHash} from "node:crypto";
import {descriptor, NativeDomainError, scopeProperty, textProperty} from "../native-contracts.ts";
import type {NativeDomainContext, NativeRpcPort, NativeScope} from "../native-contracts.ts";
import {closed, operation, record, strings, text} from "../native-validation.ts";

const recipePath = /^syntheses\/household-recipe-[\p{L}\p{N}\p{M}-]+\.md$/u;
const topicPath = /^syntheses\/household-topic-[\p{L}\p{N}\p{M}-]+\.md$/u;
export const isRecipePath = (value: string) => recipePath.test(value);
export const isManagedKnowledgePath = (value: string) => topicPath.test(value) || isRecipePath(value);

const lines = (maxItems: number, maxLength: number) => ({type:"array", maxItems, items:textProperty(maxLength)});
export const saveRecipeTool = descriptor("household_memory_save_recipe",
  "Save an explicitly requested recipe as a searchable Knowledge page in the current conversation's audience. Supply a title, alternate names if useful, and ingredients with quantities and optional steps. To import an already saved note in the same scope, pass its exact referenceNoteId instead of ingredients or steps. The tool preserves the saved note verbatim and records its origin.",
  "memory.write", {scope:scopeProperty, title:textProperty(140), aliases:lines(12,120), ingredients:lines(40,240),
    steps:lines(40,500), referenceNoteId:{type:"string", pattern:"^[A-Z]+N-\\d{8}-\\d{4}$", maxLength:40}}, ["scope","title"], "write");

export type ReadRecipeReference = (scope: NativeScope, id: string, context: NativeDomainContext) => Promise<string>;

function singleLine(value: string): string {
  if (/[\r\n]/.test(value)) throw new NativeDomainError("recipe_single_line_required");
  return value.trim();
}

export async function saveRecipe(args: unknown, context: NativeDomainContext, ports: {
  agentId: string; scope: NativeScope; rpc: NativeRpcPort; readReference?: ReadRecipeReference;
}) {
  const input = closed(args, ["operationId","scope","title","aliases","ingredients","steps","referenceNoteId"], ["operationId","scope","title"]);
  operation(input.operationId);
  const title = singleLine(text(input.title,140));
  const wikiTitle = "Household recipe " + title;
  const slug = title.toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu,"-").replace(/^-+|-+$/g,"");
  if (!slug || Buffer.byteLength(wikiTitle) > 180) throw new NativeDomainError("invalid_recipe_title");
  const lookup = `syntheses/household-recipe-${slug}.md`;
  const aliases = strings(input.aliases ?? [],12,120).map(singleLine);
  const ingredients = strings(input.ingredients ?? [],40,240).map(singleLine);
  const steps = strings(input.steps ?? [],40,500).map(singleLine);
  const referenceId = input.referenceNoteId === undefined ? undefined : text(input.referenceNoteId,40);
  const requestId = context.confirmedSourceIds?.[0];
  if (!requestId) throw new NativeDomainError("fresh_human_response_required",403);

  let sourceId: string;
  let origin: string;
  let content: string;
  let searchable: string[];
  if (referenceId !== undefined) {
    if (!/^[A-Z]+N-\d{8}-\d{4}$/.test(referenceId) || ingredients.length || steps.length)
      throw new NativeDomainError("recipe_reference_or_content_required");
    if (!ports.readReference) throw new NativeDomainError("recipe_reference_read_unavailable",503);
    content = text(await ports.readReference(ports.scope,referenceId,context),10_000);
    sourceId = `capture-note.${referenceId}`;
    const digest = createHash("sha256").update(content).digest("hex");
    origin = `Imported from ${ports.scope} reference note ${referenceId} (SHA-256 ${digest}).`;
    searchable = content.split("\n").map(line => line.trim()).filter(line => line && !line.startsWith("#")).slice(0,40);
  } else {
    if (!ingredients.length) throw new NativeDomainError("recipe_ingredients_required");
    sourceId = requestId;
    origin = "Saved as a recipe reference at the user's request.";
    content = `### Ingredients\n\n${ingredients.map(line => `- ${line}`).join("\n")}`;
    if (steps.length) content += `\n\n### Method\n\n${steps.map((line,index) => `${index + 1}. ${line}`).join("\n")}`;
    searchable = ingredients;
  }
  const body = ["**Saved recipe**", aliases.length && `Also called ${aliases.join(", ")}.`, origin, content].filter(Boolean).join("\n\n");
  if (body.length > 20_000 || body.split("\n").length > 350 || /<!--\s*(?:openclaw:|household-)/i.test(body))
    throw new NativeDomainError("recipe_content_invalid");
  const claims = [...new Set([...aliases,...searchable])].map(value => ({
    id:"claim.recipe." + createHash("sha256").update(lookup+"\n"+value).digest("hex").slice(0,24),
    text:value.slice(0,500), status:"candidate",
    evidence:[{kind:referenceId ? "household-reference-note" : "saved-recipe",sourceId,
      privacyTier:ports.scope === "household" ? "household" : "local-private"}],
  }));
  const getPage = () => ports.rpc.request("wiki.get",{agentId:ports.agentId,lookup,fromLine:1,lineCount:400,backend:"local",corpus:"wiki"},context);
  const matches = (page: unknown) => {
    const result = record(page);
    return result.path === lookup && result.truncated !== true && typeof result.content === "string" &&
      result.content.includes(`<!-- openclaw:wiki:generated:start -->\n${body}\n<!-- openclaw:wiki:generated:end -->`);
  };
  const existing = await getPage();
  if (existing && !matches(existing)) throw new NativeDomainError("recipe_title_already_saved",409);
  context.assertCurrent();
  try {
    if (existing) {
      // An earlier write may have completed before its native compile returned.
      await ports.rpc.request("wiki.compile",{agentId:ports.agentId},context);
    } else {
      await ports.rpc.request("wiki.apply",{agentId:ports.agentId,op:"create_synthesis",title:wikiTitle,body,sourceIds:[sourceId],claims},context);
      if (!matches(await getPage())) throw new Error("recipe_readback_mismatch");
    }
  } catch { throw new NativeDomainError("recipe_write_outcome_unknown",502,"unknown"); }
  return {state:"committed",kind:"recipe",scope:ports.scope,title,lookup,referenceNoteId:referenceId,existing:Boolean(existing)};
}
