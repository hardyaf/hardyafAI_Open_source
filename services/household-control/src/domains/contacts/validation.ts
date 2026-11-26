import { contactFieldNames, ContactsError } from "./types.ts";
import type { ContactAudience, ContactFields, ContactObservation, ContactObservationInput, ContactPrincipal, ContactAction } from "./types.ts";

export const artifactIdPattern = /^artifact-[a-f0-9]{64}$/;
export const contactIdPattern = /^contact-[a-f0-9]{32}$/;
const scopePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export function assertPrincipal(principal: ContactPrincipal, write = false, audience?: ContactAudience): void {
  principal?.assertCurrent?.();
  if (!principal || ![principal.profileId,principal.agentId,principal.conversationId,principal.taskId].every(value => typeof value === "string" && scopePattern.test(value)) ||
    !["private","household"].includes(principal.audience) ||
    [principal.canReadHousehold,principal.canWriteHousehold,principal.canEditContacts].some(value => typeof value !== "boolean")) throw new ContactsError("contacts_authority_invalid",403);
  if (write && !principal.canEditContacts || write && audience === "household" && !principal.canWriteHousehold) throw new ContactsError("contacts_write_not_authorized",403);
  if (write && principal.audience === "household" && audience === "private") throw new ContactsError("contact_private_conversation_required",403);
}
export function assertOperation(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value)) throw new ContactsError("contacts_operation_invalid",400);
}
export function assertRevision(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value)<1) throw new ContactsError("contacts_revision_invalid",400);
}
export function assertPrompt(principal: ContactPrincipal, contactId: string, revision: number, action: ContactAction): void {
  const binding=principal.userPromptBinding;
  if (!binding || typeof binding.promptId!=="string" || !scopePattern.test(binding.promptId) || binding.promptId!==principal.sourcePromptId || binding.conversationId!==principal.conversationId ||
    binding.taskId!==principal.taskId || binding.targetContactId!==contactId || binding.expectedRevision!==revision ||
    !Array.isArray(binding.allowedActions) || !binding.allowedActions.includes(action)) throw new ContactsError("contact_user_prompt_binding_required",403);
}
export function fields(value: unknown): ContactFields {
  if (!value || typeof value!=="object" || Array.isArray(value) || Object.keys(value).some(key => !(contactFieldNames as readonly string[]).includes(key))) throw new ContactsError("contact_fields_invalid",400);
  const result: ContactFields={};
  for (const name of contactFieldNames) {
    const values=(value as ContactFields)[name]; if (values===undefined) continue;
    if (!Array.isArray(values) || values.length>12 || values.some(item=>typeof item!=="string" || item.length>1200 || item.includes("\u0000"))) throw new ContactsError("contact_fields_invalid",400);
    const cleaned=[...new Set(values.map(item=>item.trim()).filter(Boolean))]; if(cleaned.length)result[name]=cleaned;
  }
  return result;
}
function readObservations(value: unknown, sources: readonly string[],allowImplicitSource:boolean): ContactObservationInput[] {
  if (value===undefined) return [];
  if (!Array.isArray(value) || value.length>100) throw new ContactsError("contact_observations_invalid",400);
  return value.map(item=>{
    if (!item || typeof item!=="object" || Array.isArray(item) || Object.keys(item).some(key=>!["field","value","sourceArtifactId","page","blockId","quote","confidence","inferred","extractionArtifactId"].includes(key)) ||
      !(contactFieldNames as readonly string[]).includes(item.field) || typeof item.value!=="string" || !item.value.trim() || item.value.length>1200 ||
      (item.sourceArtifactId===undefined?!allowImplicitSource:typeof item.sourceArtifactId!=="string"||!artifactIdPattern.test(item.sourceArtifactId)||!sources.includes(item.sourceArtifactId)) || item.page!==undefined && (!Number.isSafeInteger(item.page)||item.page<1||item.page>100) ||
      item.blockId!==undefined && (typeof item.blockId!=="string"||item.blockId.length>128) ||
      item.quote!==undefined && (typeof item.quote!=="string"||item.quote.length>2400) ||
      item.confidence!==undefined && (typeof item.confidence!=="number"||!Number.isFinite(item.confidence)||item.confidence<0||item.confidence>1) ||
      item.inferred!==undefined && typeof item.inferred!=="boolean" ||
      item.extractionArtifactId!==undefined && (typeof item.extractionArtifactId!=="string"||!artifactIdPattern.test(item.extractionArtifactId))) throw new ContactsError("contact_observations_invalid",400);
    return {...item,value:item.value.trim()} as ContactObservationInput;
  });
}
export function observationInputs(value: unknown,sources:readonly string[]):ContactObservationInput[]{return readObservations(value,sources,true);}
export function observations(value: unknown,sources:readonly string[]):ContactObservation[]{return readObservations(value,sources,false) as ContactObservation[];}
/** One semantic proposal need not be repeated in both fields and observations. */
export function observationFields(value:readonly ContactObservationInput[]):ContactFields{
  const proposed:ContactFields={};
  for(const item of value){const values=proposed[item.field]??=[];if(!values.includes(item.value))values.push(item.value);}
  return fields(proposed);
}
export function uncertainties(value: unknown): string[] {
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>100||value.some(item=>typeof item!=="string"||item.length>1000))throw new ContactsError("contact_uncertainties_invalid",400);
  return [...new Set(value.map(item=>item.trim()).filter(Boolean))];
}
export function assertKeys(value: unknown, allowed: readonly string[]): asserts value is Record<string,unknown> {
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))throw new ContactsError("contacts_arguments_invalid",400);
}
