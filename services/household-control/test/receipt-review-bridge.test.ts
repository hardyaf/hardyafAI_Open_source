// Receipt review evidence boundary regressions; uses no provider or financial DB.
import test from "node:test";
import assert from "node:assert/strict";
import {ReceiptsBridge} from "../src/domain-runtime/receipts-bridge.ts";
import {BoundedProcessRunner} from "../src/domain-runtime/bounded-process.ts";
import type {ProcessOptions} from "../src/domain-runtime/bounded-process.ts";
import type {AuthorizedScope} from "../src/domain-runtime/native-scope.ts";
import type {ArtifactStore} from "../src/platform/artifacts.ts";
import type {ArtifactDocumentAccess,DocumentPrincipal} from "../src/domains/documents/index.ts";

class Runner extends BoundedProcessRunner {
  packets:Record<string,unknown>[]=[];
  override async runJson(_binary:string,_args:readonly string[],options:ProcessOptions={}):Promise<unknown>{
    const packet=JSON.parse(String(options.input));this.packets.push(packet);
    const result=packet.operation==="receipt.get"?{receipt:{receiptId:"receipt-one",latestRevision:3,acceptedRevision:null,disputed:false}}:
      packet.operation==="review.get"?{receipt:{receiptId:"receipt-one"},revision:3,status:"open"}:{committed:true};
    return {version:1,ok:true,result};
  }
}
function scope(){return {principal:{profileId:"adult",sourcePromptId:"reply-two",assertCurrent(){}},grant:{projectCodes:["P1"],canManageProjects:false,canReviewReceipts:true}} as unknown as AuthorizedScope;}
function fixture(){const runner=new Runner();return {runner,bridge:new ReceiptsBridge({python:"/trusted/python",moduleRoot:"/trusted/uplift",database:"/private/uplift.sqlite",vaultRoot:"/private/vault"},runner,{} as ArtifactStore,{} as ArtifactDocumentAccess)};}
const document={} as DocumentPrincipal;
const user=async()=>({id:"user:reply-two",text:"Accept the missing detail as an exception for this receipt.",sha256:"a".repeat(64)});

test("current user quote is preserved without an invented exception grant",async()=>{
  const {bridge,runner}=fixture();
  await bridge.execute("receipts.record_user_statement",{operationId:"review-evidence-01",receiptId:"receipt-one",quote:"missing detail"},scope(),document,user);
  const origin=(runner.packets[0].context as {evidenceOrigin:{sourceRef:string;facts?:unknown}}).evidenceOrigin;
  assert.equal(origin.sourceRef,"user:reply-two");assert.equal(origin.facts,undefined);
  await assert.rejects(()=>bridge.execute("receipts.record_user_statement",{operationId:"review-evidence-02",receiptId:"receipt-one",quote:"The OCR amount is definitely zero."},scope(),document,user),{code:"receipt_user_quote_not_grounded"});
  assert.equal(runner.packets.length,1);
});

test("only a trusted current target/revision binding carries explicit exception facts",async()=>{
  const {bridge,runner}=fixture(),quote="Accept the missing detail as an exception for this receipt.";
  const binding={receiptId:"receipt-one",revision:3,sourcePromptId:"reply-two",quote,approvedException:{waivedReasons:["missing_itemized_detail"],reason:"Owner explicitly accepts summary detail exception."}};
  await bridge.execute("receipts.record_user_statement",{operationId:"review-exception-01",receiptId:"receipt-one",quote},scope(),document,user,binding);
  assert.equal(runner.packets[0].operation,"receipt.get");
  const origin=(runner.packets[1].context as {evidenceOrigin:{facts:{approvedException:unknown}}}).evidenceOrigin;
  assert.deepEqual(origin.facts.approvedException,{receiptId:"receipt-one",revision:3,waivedReasons:["missing_itemized_detail"],reason:binding.approvedException.reason});
  await assert.rejects(()=>bridge.execute("receipts.record_user_statement",{operationId:"review-exception-02",receiptId:"receipt-one",quote},scope(),document,user,{...binding,revision:2}),{code:"receipt_review_revision_conflict"});
  await assert.rejects(()=>bridge.execute("receipts.record_user_statement",{operationId:"review-exception-03",receiptId:"receipt-one",quote},scope(),document,user,{...binding,sourcePromptId:"original-one"}),{code:"receipt_review_binding_mismatch"});
});

test("review responses are ordinary grounded prompts and recheck actual review target",async()=>{
  const {bridge,runner}=fixture(),quote="missing detail";
  await bridge.execute("receipts.review_respond",{operationId:"review-response-01",reviewId:"review-one",revision:3,text:quote},scope(),document,user,
    {receiptId:"receipt-one",revision:3,sourcePromptId:"reply-two",quote});
  assert.deepEqual(runner.packets.map(value=>value.operation),["review.get","review.respond"]);
  await assert.rejects(()=>bridge.execute("receipts.review_respond",{operationId:"review-response-02",reviewId:"review-one",revision:3,text:"Invented owner approval"},scope(),document,user),{code:"receipt_user_quote_not_grounded"});
});

test("semantic clarification requires a current focused human reply and review grant",async()=>{
  const {bridge,runner}=fixture(),quote="missing detail";
  const clarification={fields:[{field:"date",value:"2026-11-03",rationale:"Human identifies the date.",ambiguity:"clear"}],rationale:"Current date clarification.",ambiguity:"clear"};
  await assert.rejects(()=>bridge.execute("receipts.record_user_statement",{operationId:"clarification-01",receiptId:"receipt-one",quote,clarification},scope(),document,user),{code:"receipt_clarification_binding_required"});
  assert.equal(runner.packets.length,0);
  const current=scope();current.grant.canReviewReceipts=false;
  await assert.rejects(()=>bridge.execute("receipts.record_user_statement",{operationId:"clarification-02",receiptId:"receipt-one",quote,clarification},current,document,user,{receiptId:"receipt-one",revision:3,sourcePromptId:"reply-two",quote}),{code:"receipt_review_not_authorized"});
  assert.equal(runner.packets.length,0);
});

test("normalized human clarification retains attribution without creating an exception",async()=>{
  const {bridge,runner}=fixture(),quote="It was November third this year.";
  const clarification={fields:[{field:"date",value:"2026-11-03",rationale:"The current human names the day.",ambiguity:"clear"}],rationale:"Resolve the focused date question.",ambiguity:"clear"};
  await bridge.execute("receipts.record_user_statement",{operationId:"clarification-03",receiptId:"receipt-one",quote,clarification},scope(),document,async()=>({id:"user:reply-two",text:quote,sha256:"b".repeat(64)}),{receiptId:"receipt-one",revision:3,sourcePromptId:"reply-two",quote});
  const context=runner.packets[1].context as {evidenceOrigin:{kind:string;sourceRef:string;facts:{interpretedFields:unknown[];approvedException?:unknown;clarification:{revision:number}}}};
  assert.equal(context.evidenceOrigin.kind,"user_statement");assert.equal(context.evidenceOrigin.sourceRef,"user:reply-two");
  assert.equal(context.evidenceOrigin.facts.clarification.revision,3);
  assert.deepEqual(context.evidenceOrigin.facts.interpretedFields,clarification.fields);
  assert.equal(context.evidenceOrigin.facts.approvedException,undefined);
  await assert.rejects(()=>bridge.execute("receipts.record_user_statement",{operationId:"clarification-04",receiptId:"receipt-one",quote,clarification:{...clarification,fields:[{...clarification.fields[0],field:"projectCode",value:"P2"}]}},scope(),document,async()=>({id:"user:reply-two",text:quote,sha256:"b".repeat(64)}),{receiptId:"receipt-one",revision:3,sourcePromptId:"reply-two",quote}),{code:"receipt_project_not_authorized"});
});

test("distinct clarification reads every receipt and uncertainty cannot become a distinct fact",async()=>{
  const {bridge,runner}=fixture(),receiptId="receipt-"+"a".repeat(48),other="receipt-"+"b".repeat(48),quote="These are separate purchases.";
  const userSource=async()=>({id:"user:reply-two",text:quote,sha256:"b".repeat(64)});
  const binding={receiptId,revision:3,sourcePromptId:"reply-two",quote};
  const clarification={distinctReceiptIds:[receiptId,other],rationale:"Human distinguishes purchases.",ambiguity:"clear"};
  await bridge.execute("receipts.record_user_statement",{operationId:"clarification-05",receiptId,quote,clarification},scope(),document,userSource,binding);
  assert.deepEqual(runner.packets.filter(value=>value.operation==="receipt.get").map(value=>(value.params as {receiptId:string}).receiptId),[receiptId,receiptId,other]);
  const origin=(runner.packets.at(-1)!.context as {evidenceOrigin:{facts:{distinctReceiptIds?:string[]}}}).evidenceOrigin;
  assert.deepEqual(origin.facts.distinctReceiptIds,[receiptId,other].sort());
  await bridge.execute("receipts.record_user_statement",{operationId:"clarification-06",receiptId,quote,clarification:{...clarification,ambiguity:"uncertain"}},scope(),document,userSource,binding);
  const uncertain=(runner.packets.at(-1)!.context as {evidenceOrigin:{facts:{distinctReceiptIds?:string[]}}}).evidenceOrigin;
  assert.equal(uncertain.facts.distinctReceiptIds,undefined);
});

test("a restricted duplicate reference cannot acquire human distinct-receipt evidence",async()=>{
  const {bridge,runner}=fixture(),receiptId="receipt-"+"a".repeat(48),other="receipt-"+"b".repeat(48),quote="These are separate purchases.";
  const original=runner.runJson.bind(runner);
  runner.runJson=async(binary,args,options={})=>{
    const packet=JSON.parse(String(options.input));
    if(packet.operation==="receipt.get"&&packet.params.receiptId===other)return {version:1,ok:false,error:{code:"receipt_not_found",status:404}};
    return original(binary,args,options);
  };
  await assert.rejects(()=>bridge.execute("receipts.record_user_statement",{operationId:"clarification-07",receiptId,quote,clarification:{distinctReceiptIds:[receiptId,other],rationale:"Human distinguishes purchases.",ambiguity:"clear"}},scope(),document,async()=>({id:"user:reply-two",text:quote,sha256:"b".repeat(64)}),{receiptId,revision:3,sourcePromptId:"reply-two",quote}),{code:"receipt_not_found"});
  assert.equal(runner.packets.some(value=>value.operation==="evidence.record"),false);
});
