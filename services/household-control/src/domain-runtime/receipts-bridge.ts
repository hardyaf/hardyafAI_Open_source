import operationManifest from "../../../../integrations/uplift/operations.json" with {type:"json"};
import { fingerprint, DomainError, safeOperationId } from "./common.ts";
import type { DomainTool } from "./common.ts";
import type { AuthorizedScope } from "./native-scope.ts";
import type { DomainConfiguration } from "./configuration.ts";
import type { BoundedProcessRunner } from "./bounded-process.ts";
import type { ArtifactStore } from "../platform/artifacts.ts";
import type { ArtifactDocumentAccess, DocumentPrincipal } from "../domains/documents/index.ts";

type Operation={name:string;operation:string;description:string;inputSchema:Record<string,unknown>;effect:"read"|"write";internal:boolean};
const operations=(operationManifest as {operations:Operation[]}).operations;
export const receiptTools:DomainTool[]=operations.filter(item=>!item.internal).map(item=>({
  name:"receipts."+item.operation.replaceAll(".","_"),description:item.description,effect:item.effect,capability:"receipts",
  inputSchema:item.effect==="read" ? item.inputSchema : {...item.inputSchema,
    properties:{...item.inputSchema.properties as Record<string,unknown>,operationId:{type:"string",pattern:"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$"}},
    required:[...item.inputSchema.required as string[],"operationId"]},
}));
const artifact={type:"string",pattern:"^artifact-[a-f0-9]{64}$"};
const operationId={type:"string",pattern:"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$"};
const interpretation={type:"object",additionalProperties:false,properties:{field:{type:"string",enum:["vendor","date","currency","transactionRef","projectCode"]},value:{type:"string",minLength:1,maxLength:250},rationale:{type:"string",minLength:1,maxLength:2000},ambiguity:{type:"string",enum:["clear","uncertain"]}},required:["field","value","rationale","ambiguity"]};
const clarification={type:"object",additionalProperties:false,properties:{fields:{type:"array",minItems:1,maxItems:5,items:interpretation},distinctReceiptIds:{type:"array",minItems:2,maxItems:20,uniqueItems:true,items:{type:"string",pattern:"^receipt-[a-f0-9]{48}$"}},rationale:{type:"string",minLength:1,maxLength:2000},ambiguity:{type:"string",enum:["clear","uncertain"]}},required:["rationale","ambiguity"],anyOf:[{properties:{fields:{}},required:["fields"]},{properties:{distinctReceiptIds:{}},required:["distinctReceiptIds"]}]};
function schema(properties:Record<string,unknown>,required:string[]){return {type:"object",additionalProperties:false,properties,required};}
receiptTools.push(
  {name:"receipts.record_extraction",capability:"receipts",effect:"write",description:"Attach committed local document-extraction evidence to a receipt. Validates original source SHA and extraction provenance; never labels model-provided text as OCR.",
    inputSchema:schema({operationId,receiptId:{type:"string",minLength:1,maxLength:128},extractionArtifactId:artifact},["operationId","receiptId","extractionArtifactId"])},
  {name:"receipts.record_user_statement",capability:"receipts",effect:"write",description:"Attach an exact current human quote. Optional semantic clarification requires the trusted current receipt/revision reply binding; its interpretation remains attributed and cannot waive money, source, grants or revisions.",
    inputSchema:schema({operationId,receiptId:{type:"string",minLength:1,maxLength:128},quote:{type:"string",minLength:1,maxLength:20000},clarification},["operationId","receiptId","quote"])},
  {name:"receipts.record_project_context",capability:"receipts",effect:"write",description:"Attach the current maintained context of one granted project. Fetches its actual text/revision; the model cannot fabricate project context or grant itself access.",
    inputSchema:schema({operationId,receiptId:{type:"string",minLength:1,maxLength:128},projectCode:{type:"string",minLength:1,maxLength:64}},["operationId","receiptId","projectCode"])}
);
/** Supplied only by trusted task admission after a later human review response.
 * Never deserialize this authority from model tool arguments. Exception waivers
 * additionally require root-verified signed approval for this target/revision.
 */
export type TrustedReceiptReviewBinding={receiptId:string;revision:number;sourcePromptId:string;quote:string;
  approvedException?:{waivedReasons:string[];reason:string}};
export type ReceiptReviewReadPrincipal={profileId:string;projectCodes:readonly string[];canReviewReceipts:boolean;assertCurrent():void;signal?:AbortSignal};
type ReceiptInvocationAuthority={principal:{profileId:string;assertCurrent():void;signal?:AbortSignal};grant:{projectCodes:readonly string[];canManageProjects:boolean;canReviewReceipts:boolean}};
type EvidenceOrigin={kind:"local_ocr"|"user_statement"|"project_context";sourceRef:string;sourceSha256?:string;facts?:Record<string,unknown>};
export class ReceiptsBridge {
  private readonly config:DomainConfiguration["uplift"];
  private readonly runner:BoundedProcessRunner;
  private readonly artifacts:ArtifactStore;
  private readonly documents:ArtifactDocumentAccess;
  constructor(config:DomainConfiguration["uplift"],runner:BoundedProcessRunner,artifacts:ArtifactStore,documents:ArtifactDocumentAccess){
    this.config=config;this.runner=runner;this.artifacts=artifacts;this.documents=documents;
  }
  private environment(){return {UPLIFT_DATABASE:this.config.database,UPLIFT_VAULT_ROOT:this.config.vaultRoot};}
  private async invoke(operation:string,params:Record<string,unknown>,scope:ReceiptInvocationAuthority,opId?:string,origin?:EvidenceOrigin):Promise<Record<string,unknown>>{
    const context={actorId:scope.principal.profileId,projectCodes:scope.grant.projectCodes,canManageProjects:scope.grant.canManageProjects,
      canReview:scope.grant.canReviewReceipts,...(origin ? {evidenceOrigin:origin} : {})};
    const packet={version:1,operation,params,context,...(opId?{operationId:opId}:{})};
    scope.principal.assertCurrent();
    const value=await this.runner.runJson(this.config.python,["-m","uplift_finance_bridge"],{cwd:this.config.moduleRoot,env:this.environment(),
      input:JSON.stringify(packet),timeoutMs:30_000,maxBytes:5*1024*1024,assertCurrent:scope.principal.assertCurrent,signal:scope.principal.signal,effect:Boolean(opId),errorEnvelopeExitCode:1});
    if(!value || typeof value!=="object" || Array.isArray(value))throw new DomainError("uplift_invalid_response",{outcome:opId?"unknown":"not_sent",httpStatus:503});
    const response=value as {version?:number;ok?:boolean;result?:unknown;error?:{code?:unknown;status?:unknown}};
    if(response.version!==1)throw new DomainError("uplift_protocol_mismatch",{outcome:opId?"unknown":"not_sent",httpStatus:503});
    if(response.ok!==true){
      const code=typeof response.error?.code==="string" && /^[a-z][a-z0-9_]{0,100}$/.test(response.error.code)?response.error.code:"uplift_operation_failed";
      const status=typeof response.error?.status==="number" && [400,403,404,409,413,500,503].includes(response.error.status)?response.error.status:503;
      throw new DomainError(code,{outcome:opId && status>=500 ? "unknown":"not_sent",httpStatus:status});
    }
    if(!response.result || typeof response.result!=="object" || Array.isArray(response.result))throw new DomainError("uplift_invalid_response",{outcome:opId?"unknown":"not_sent",httpStatus:503});
    return response.result as Record<string,unknown>;
  }
  /** Trusted camera intake only. Project assignment and acceptance keep their existing grants. */
  async captureOriginal(principal: DocumentPrincipal, artifactId: string, operationId: string): Promise<string> {
    const source = await this.documents.source(principal, artifactId);
    const metadata = await this.artifacts.get(artifactId, { profileId: principal.profileId, canReadHousehold: false });
    const result = await this.invoke("source.intake", { source: {
      artifactId, contentBase64: source.bytes.toString("base64"), sha256: source.sha256,
      filename: metadata.filename, mimeType: source.mimeType,
    } }, {
      principal: { profileId: principal.profileId, assertCurrent: () => principal.assertCurrent?.(), signal: principal.signal },
      grant: { projectCodes: [], canManageProjects: false, canReviewReceipts: false },
    }, operationId);
    const receipt = result.receipt as { receiptId?: string } | undefined;
    if (!receipt?.receiptId || !/^receipt-[a-f0-9]{48}$/.test(receipt.receiptId))
      throw new DomainError("uplift_invalid_response", { httpStatus: 503 });
    return receipt.receiptId;
  }

  async readReceipt(principal:ReceiptReviewReadPrincipal,receiptId:string):Promise<Record<string,unknown>>{
    principal.assertCurrent();
    if(typeof receiptId!=="string"||!/^receipt-[a-f0-9]{48}$/.test(receiptId))throw new DomainError("receipt_reference_invalid");
    const result=await this.invoke("receipt.get",{receiptId},{principal:{profileId:principal.profileId,assertCurrent:principal.assertCurrent,signal:principal.signal},
      grant:{projectCodes:[...principal.projectCodes],canManageProjects:false,canReviewReceipts:principal.canReviewReceipts}});
    principal.assertCurrent();return result;
  }
  async reviewList(principal:ReceiptReviewReadPrincipal,limit:number):Promise<unknown>{
    principal.assertCurrent();
    if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new DomainError("receipt_review_limit_invalid");
    const result=await this.invoke("review.list",{limit},{principal:{profileId:principal.profileId,assertCurrent:principal.assertCurrent,signal:principal.signal},
      grant:{projectCodes:[...principal.projectCodes],canManageProjects:false,canReviewReceipts:principal.canReviewReceipts}});
    principal.assertCurrent();return result;
  }
  async readiness():Promise<unknown>{
    try{
      const response=await this.runner.runJson(this.config.python,["-m","uplift_finance_bridge","--readiness"],{cwd:this.config.moduleRoot,env:this.environment(),timeoutMs:10_000,maxBytes:16384,errorEnvelopeExitCode:1}) as {ok?:boolean;result?:Record<string,unknown>};
      return response.ok ? {status:"initialized",schemaVersion:response.result?.schemaVersion??1,projectCatalogConfigured:response.result?.projectCatalogConfigured===true,detail:"Storage/schema readiness only; no receipt processing or acceptance scenario has run."} :
        {status:"unavailable",detail:"Uplift storage is not initialized or unavailable."};
    }catch{return {status:"unavailable",detail:"Uplift storage is not initialized or unavailable."};}
  }
  async execute(name:string,args:Record<string,unknown>,scope:AuthorizedScope,documentPrincipal:DocumentPrincipal,
    userInput:()=>Promise<{id:string;text:string;sha256:string}>,reviewBinding?:TrustedReceiptReviewBinding):Promise<unknown>{
    scope.principal.assertCurrent();
    const descriptor=operations.find(item=>!item.internal && name==="receipts."+item.operation.replaceAll(".","_"));
    let params={...args},opId:string|undefined;
    if(descriptor?.effect==="write" || name.startsWith("receipts.record_")){
      if(!safeOperationId(params.operationId))throw new DomainError("operation_id_required");opId=params.operationId;delete params.operationId;
    }
    if(name==="receipts.record_extraction"){
      const extractionId=String(params.extractionArtifactId);
      const extracted=await this.documents.result(documentPrincipal,extractionId);
      await this.documents.source(documentPrincipal,extracted.sourceArtifactId);
      // Only the document adapter publishes this evidence kind/filename; uploaded client JSON is input, not evidence.
      const metadata=await this.artifacts.get(extractionId,{profileId:scope.principal.profileId,canReadHousehold:scope.principal.canReadHousehold});
      if(metadata.kind!=="evidence" || metadata.filename!=="document-extraction.json")throw new DomainError("receipt_extraction_origin_invalid",{httpStatus:403});
      if(extracted.text.length>200_000)throw new DomainError("receipt_evidence_requires_bounded_extraction");
      return this.invoke("evidence.record",{receiptId:params.receiptId,text:extracted.text},scope,opId,
        {kind:"local_ocr",sourceRef:extractionId,sourceSha256:extracted.sourceSha256});
    }
    if(name==="receipts.record_user_statement"){
      const source=await userInput(),quote=String(params.quote);
      if(!quote.trim()||!source.text.includes(quote))throw new DomainError("receipt_user_quote_not_grounded",{httpStatus:403});
      let facts:Record<string,unknown>|undefined;
      const clarification=params.clarification as {fields?:{field:string;value:string;rationale:string;ambiguity:"clear"|"uncertain"}[];distinctReceiptIds?:string[];rationale:string;ambiguity:"clear"|"uncertain"}|undefined;
      if(clarification&&!reviewBinding)throw new DomainError("receipt_clarification_binding_required",{httpStatus:403});
      if(clarification&&!scope.grant.canReviewReceipts)throw new DomainError("receipt_review_not_authorized",{httpStatus:403});
      if(reviewBinding){
        if(reviewBinding.receiptId!==params.receiptId||reviewBinding.sourcePromptId!==scope.principal.sourcePromptId||reviewBinding.quote!==quote)
          throw new DomainError("receipt_review_binding_mismatch",{httpStatus:403});
        const current=await this.invoke("receipt.get",{receiptId:params.receiptId},scope);
        const receipt=(current.receipt??current) as {latestRevision?:number;acceptedRevision?:number;disputed?:boolean};
        if(reviewBinding.revision!==receipt.latestRevision&&!(receipt.disputed&&reviewBinding.revision===receipt.acceptedRevision))
          throw new DomainError("receipt_review_revision_conflict",{httpStatus:409});
        if(clarification){
          if(!["clear","uncertain"].includes(clarification.ambiguity)||typeof clarification.rationale!=="string"||!clarification.rationale.trim()||clarification.rationale.length>2000||
            !clarification.fields&&!clarification.distinctReceiptIds)throw new DomainError("receipt_clarification_invalid");
          facts={clarification:{receiptId:reviewBinding.receiptId,revision:reviewBinding.revision,rationale:clarification.rationale,ambiguity:clarification.ambiguity}};
          if(clarification.fields){
            if(!Array.isArray(clarification.fields)||!clarification.fields.length||clarification.fields.length>5||clarification.fields.some(value=>!value||typeof value!=="object")||new Set(clarification.fields.map(value=>value.field)).size!==clarification.fields.length)throw new DomainError("receipt_clarification_invalid");
            facts.interpretedFields=clarification.fields.map(value=>{
              if(!value||!["vendor","date","currency","transactionRef","projectCode"].includes(value.field)||typeof value.value!=="string"||!value.value.trim()||value.value.length>250||typeof value.rationale!=="string"||!value.rationale.trim()||value.rationale.length>2000||!["clear","uncertain"].includes(value.ambiguity))throw new DomainError("receipt_clarification_invalid");
              if(value.field==="projectCode"&&!scope.grant.projectCodes.includes(value.value))throw new DomainError("receipt_project_not_authorized",{httpStatus:403});
              return {...value,ambiguity:clarification.ambiguity==="uncertain"?"uncertain":value.ambiguity};
            });
          }
          if(clarification.distinctReceiptIds){
            const ids=clarification.distinctReceiptIds;
            if(!Array.isArray(ids)||ids.length<2||ids.length>20||new Set(ids).size!==ids.length||!ids.includes(reviewBinding.receiptId)||ids.some(value=>typeof value!=="string"||!/^receipt-[a-f0-9]{48}$/.test(value)))throw new DomainError("receipt_clarification_invalid");
            for(const receiptId of ids){scope.principal.assertCurrent();await this.invoke("receipt.get",{receiptId},scope);}
            if(clarification.ambiguity==="clear")facts.distinctReceiptIds=[...ids].sort();
          }
        }
        if(reviewBinding.approvedException)facts={...facts,approvedException:{receiptId:reviewBinding.receiptId,revision:reviewBinding.revision,
          waivedReasons:reviewBinding.approvedException.waivedReasons,reason:reviewBinding.approvedException.reason}};
      }
      return this.invoke("evidence.record",{receiptId:params.receiptId,text:quote},scope,opId,{kind:"user_statement",sourceRef:source.id,sourceSha256:source.sha256,...(facts?{facts}:{})});
    }
    if(name==="receipts.record_project_context"){
      const project=await this.invoke("project.context",{projectCode:params.projectCode},scope);
      return this.invoke("evidence.record",{receiptId:params.receiptId,text:project.text},scope,opId,
        {kind:"project_context",sourceRef:"project:"+String(project.projectCode)+":"+String(project.revision),facts:{projectCode:project.projectCode,projectRevision:project.revision}});
    }
    if(!descriptor)throw new DomainError("receipt_tool_unavailable",{httpStatus:404});
    if(descriptor.operation==="source.intake"){
      const source=await this.documents.source(documentPrincipal,String(params.artifactId));
      const metadata=await this.artifacts.get(source.artifactId,{profileId:scope.principal.profileId,canReadHousehold:scope.principal.canReadHousehold});
      params={source:{artifactId:source.artifactId,contentBase64:source.bytes.toString("base64"),sha256:source.sha256,filename:metadata.filename,mimeType:source.mimeType}};
    }
    if(descriptor.operation==="review.respond"){
      const source=await userInput();
      if(typeof params.text!=="string"||!params.text.trim()||!source.text.includes(params.text))
        throw new DomainError("receipt_user_quote_not_grounded",{httpStatus:403});
      if(reviewBinding){
        const review=await this.invoke("review.get",{reviewId:params.reviewId},scope);
        const receipt=review.receipt as {receiptId?:string};
        if(reviewBinding.sourcePromptId!==scope.principal.sourcePromptId||reviewBinding.quote!==params.text||reviewBinding.receiptId!==receipt.receiptId||
          reviewBinding.revision!==params.revision||review.revision!==params.revision)
          throw new DomainError("receipt_review_binding_mismatch",{httpStatus:403});
      }
    }
    const result=await this.invoke(descriptor.operation,params,scope,opId);
    if(descriptor.operation!=="report.generate")return result;
    // Full financial rows remain an explicitly private artifact rather than filling model context or a kitchen display.
    const document=result.document as {mimeType?:string;filename?:string;content?:string;encoding?:string;sizeBytes?:number}|undefined;
    const expectedMimes:Record<string,string>={csv:"text/csv",pdf:"application/pdf",xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"};
    const expectedMime=expectedMimes[String(params.format??"json")];
    if(expectedMime&&(!document||document.mimeType!==expectedMime||typeof document.content!=="string"))
      throw new DomainError("receipt_report_document_invalid",{httpStatus:503});
    let bytes:Buffer,mimeType:string,filename:string;
    if(document&&typeof document.content==="string"&&document.mimeType==="text/csv"){
      bytes=Buffer.from(document.content);mimeType="text/csv";filename="uplift-report.csv";
    }else if(document&&typeof document.content==="string"&&document.encoding==="base64"){
      const formats:Record<string,{extension:string;signature:Buffer}>={"application/pdf":{extension:"pdf",signature:Buffer.from("%PDF-")},
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":{extension:"xlsx",signature:Buffer.from([0x50,0x4b,0x03,0x04])}};
      const format=formats[document.mimeType??""];
      if(!format||document.content.length>2_800_000||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(document.content))
        throw new DomainError("receipt_report_document_invalid",{httpStatus:503});
      bytes=Buffer.from(document.content,"base64");
      if(!bytes.length||bytes.length>2*1024*1024||bytes.length!==document.sizeBytes||!bytes.subarray(0,format.signature.length).equals(format.signature))
        throw new DomainError("receipt_report_document_invalid",{httpStatus:503});
      mimeType=document.mimeType!;filename="uplift-report."+format.extension;
    }else{bytes=Buffer.from(JSON.stringify(result));mimeType="application/json";filename="uplift-report.json";}
    scope.principal.assertCurrent();
    const artifact=await this.artifacts.put({ownerProfileId:scope.principal.profileId,conversationId:scope.principal.conversationId,taskId:scope.principal.taskId,audience:"private"},
      {profileId:scope.principal.profileId,canReadHousehold:scope.principal.canReadHousehold},{bytes,filename,mimeType,kind:"output",idempotencyKey:"uplift-report:"+fingerprint({args,result})});
    return {mode:result.mode,status:result.status,profile:result.profile,counts:result.counts,acceptedTotalsMinor:result.acceptedTotalsMinor,
      provisionalTotalsMinor:result.provisionalTotalsMinor,reportArtifactId:artifact.id,audience:"private",rowCount:Array.isArray(result.rows)?result.rows.length:0,
      currenciesCombined:false,missingAmountsSubstituted:false};
  }
}
