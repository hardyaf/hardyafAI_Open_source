import { ContactsError, contactFieldNames } from "./types.ts";
import type { CaptureCardInput, ContactAudience, ContactPrincipal, ReviseContactInput, ContactMutationResult, ContactReceipt, ContactFields } from "./types.ts";
import { ContactsService } from "./service.ts";
import { assertKeys } from "./validation.ts";

const operation={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'};
const artifact={type:'string',pattern:'^artifact-[a-f0-9]{64}$'};
const contact={type:'string',pattern:'^contact-[a-f0-9]{32}$'};
const revision={type:'integer',minimum:1};
const fieldSchema={type:'object',description:'Explicit field selection, including {}. When no fields/patch is supplied on capture/OCR redo, observations provide the proposals instead.',additionalProperties:false,properties:Object.fromEntries(contactFieldNames.map(name=>[name,{type:'array',maxItems:12,items:{type:'string',maxLength:1200}}]))};
const observationsSchema={type:'array',description:'Grounded field/value proposals; capture/OCR redo need not repeat them in fields. OCR-redo observations alone patch only the observed fields.',maxItems:100,items:{type:'object',additionalProperties:false,required:['field','value'],properties:{
  field:{type:'string',enum:[...contactFieldNames]},value:{type:'string',minLength:1,maxLength:1200},sourceArtifactId:{...artifact,description:'Capture/OCR redo may omit this when the exact quote uniquely identifies one authorized extraction source.'},page:{type:'integer',minimum:1,maximum:100},
  blockId:{type:'string',maxLength:128},quote:{type:'string',maxLength:2400},confidence:{type:'number',minimum:0,maximum:1},inferred:{type:'boolean'},extractionArtifactId:artifact,
}}};
const uncertaintySchema={type:'array',maxItems:100,items:{type:'string',maxLength:1000}};
function schema(properties:Record<string,unknown>,required:string[]){return {type:'object',additionalProperties:false,properties,required};}
export const contactsToolDescriptors=[
  {name:'contacts.capture_card',operationIdentity:{fields:['sourceArtifactIds','audience'],defaults:{audience:'household'}},description:'Save each supplied card as a distinct source/contact record, even with no readable fields. Shared household is the default. Initial fields use owning local extraction evidence; supplied handles avoid duplicate extraction. Unsupported values are omitted and reported. Returns a committed save receipt. Never merges a similar card.',effect:'write',operationField:'operationId',inputSchema:schema({operationId:operation,sourceArtifactIds:{type:'array',minItems:1,maxItems:8,uniqueItems:true,items:artifact},audience:{type:'string',enum:['private','household']},fields:fieldSchema,observations:observationsSchema,uncertainties:uncertaintySchema,extractionArtifactIds:{type:'array',maxItems:16,uniqueItems:true,items:artifact}},['operationId','sourceArtifactIds'])},
  {name:'contacts.search',description:'Search authorized current local Rolodex fields by literal text; similarity is a suggestion, never merge authority.',effect:'read',inputSchema:schema({query:{type:'string',maxLength:300},limit:{type:'integer',minimum:1,maximum:50},offset:{type:'integer',minimum:0,maximum:10000}},['query'])},
  {name:'contacts.get',description:'Read authorized current contact fields, source references, uncertainty and revision. Private conversation/task history is omitted.',effect:'read',inputSchema:schema({contactId:contact},['contactId'])},
  {name:'contacts.operation_status',description:'Read your own committed contact operation receipt after an uncertain response, without repeating the write. Returns the operation revision and current revision, subject to current contact access.',effect:'read',inputSchema:schema({operationId:operation},['operationId'])},
  {name:'contacts.revisions',description:'Read authorized contact revision history. Sharing a current record does not publish prior private revisions.',effect:'read',inputSchema:schema({contactId:contact,limit:{type:'integer',minimum:1,maximum:100}},['contactId'])},
  {name:'contacts.revise',operationIdentity:{fields:['contactId','reason']},description:'Correct current fields after an authorized later user response. Prefer patch.set/patch.remove to preserve unrelated fields, observations and uncertainty. Legacy full fields replacement remains explicit. Trusted focus may supply the revision; a redo preserves history and requires fresh evidence. Cannot run from capture prompt/background curation.',effect:'write',operationField:'operationId',inputSchema:schema({operationId:operation,contactId:contact,expectedRevision:revision,fields:fieldSchema,extractionArtifactIds:{type:'array',maxItems:16,uniqueItems:true,items:artifact},patch:schema({set:fieldSchema,remove:{type:'array',maxItems:8,uniqueItems:true,items:{type:'string',enum:[...contactFieldNames]}}},[]),observations:observationsSchema,uncertainties:uncertaintySchema,reason:{type:'string',enum:['correction','ocr_redo','enrichment']}},['operationId','contactId','reason'])},
  {name:'contacts.change_audience',description:'Owner-only current contact scope change after an authorized later user response. Historical private revisions stay private. Previously published immutable source artifacts/copies are retained and this tool reports that limitation.',effect:'write',operationField:'operationId',inputSchema:schema({operationId:operation,contactId:contact,expectedRevision:revision,audience:{type:'string',enum:['private','household']}},['operationId','contactId','expectedRevision','audience'])},
] as const;
function receiptPreview(receipt:ContactReceipt){
  return {...receipt,warnings:receipt.warnings.slice(0,20).map(item=>item.slice(0,300)),warningCount:receipt.warnings.length,
    warningsTruncated:receipt.warnings.length>20||receipt.warnings.some(item=>item.length>300)};
}
function mutationPreview(result:ContactMutationResult){
  const preview:ContactFields={};let fieldsTruncated=false;
  for(const name of contactFieldNames){const values=result.contact.fields[name];if(!values)continue;
    preview[name]=values.slice(0,3).map(value=>value.slice(0,300));if(values.length>3||values.some(value=>value.length>300))fieldsTruncated=true;
  }
  return {receipt:receiptPreview(result.receipt),replayed:result.replayed,contact:{id:result.contact.id,cardId:result.contact.cardId,currentRevision:result.contact.currentRevision,
    audience:result.contact.audience,fields:preview,fieldsTruncated,observationCount:result.contact.observations.length,uncertaintyCount:result.contact.uncertainties.length,
    sourceCount:result.contact.sources.length},fullRecordTool:'contacts.get'};
}
export function createContactsTools(service:ContactsService){
  return {descriptors:contactsToolDescriptors,async execute(name:string,args:unknown,principal:ContactPrincipal):Promise<unknown>{
    const descriptor=contactsToolDescriptors.find(item=>item.name===name);if(!descriptor)throw new ContactsError('contacts_tool_unavailable',404);
    assertKeys(args,Object.keys(descriptor.inputSchema.properties));
    switch(name){
      case 'contacts.capture_card':return mutationPreview(await service.captureCard(principal,args as unknown as CaptureCardInput));
      case 'contacts.search':return service.search(principal,args as {query:string;limit?:number;offset?:number});
      case 'contacts.get':return service.get(principal,String(args.contactId));
      case 'contacts.operation_status':{const result=service.operationStatus(principal,String(args.operationId));return result?{...result,receipt:receiptPreview(result.receipt)}:null;}
      case 'contacts.revisions':return service.revisions(principal,String(args.contactId),args.limit as number|undefined);
      case 'contacts.revise':return mutationPreview(args.reason==='ocr_redo'?await service.redo(principal,args as unknown as ReviseContactInput):service.revise(principal,args as unknown as ReviseContactInput));
      case 'contacts.change_audience':return mutationPreview(await service.changeAudience(principal,args as unknown as {operationId:string;contactId:string;expectedRevision:number;audience:ContactAudience}));
      default:throw new ContactsError('contacts_tool_unavailable',404);
    }
  }};
}
