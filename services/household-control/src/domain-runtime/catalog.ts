import {displayToolDescriptors} from "../display/tools.ts";
import { contactsToolDescriptors } from "../domains/contacts/index.ts";
import { documentsToolDescriptors } from "../domains/documents/index.ts";
import { listTools,googleTools,memoryTools,scheduleTools } from "../domains/native-domains.ts";
import { receiptTools } from "./receipts-bridge.ts";
import { nativeToolName } from "./common.ts";
import type { DomainTool } from "./common.ts";

const operation={type:"string",pattern:"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$"};
const sharedTools:DomainTool[]=[
  {name:"diagnostics.system_status",capability:"diagnostics",effect:"read",description:"Read current bounded GPU memory, utilization, temperature, CPU/RAM/disk, known service status and loaded-model metadata in an authorized private operator conversation. No shell or configuration changes.",
    inputSchema:{type:"object",additionalProperties:false,properties:{},required:[]}},
  {name:"effects.inspect",capability:"effects",effect:"read",description:"Read this profile/conversation's durable tool-effect receipt before recovering an uncertain operation. Does not replay or undo work.",
    inputSchema:{type:"object",additionalProperties:false,required:["operationId"],properties:{operationId:operation}}},
  {name:"diagnostics.evidence",capability:"diagnostics",effect:"read",description:"Read bounded redacted task/effect/version evidence only in an explicitly authorized diagnostic task. No raw transcripts, credential reads, shell, repair, replay or configuration changes.",
    inputSchema:{type:"object",additionalProperties:false,properties:{targetSubmissionId:{type:"string",minLength:1,maxLength:128},targetRunId:{type:"string",minLength:1,maxLength:128}},required:[]}},
];
export type CatalogTool=DomainTool & {nativeName:string;domain:string};
export const domainCatalog:CatalogTool[]=[...contactsToolDescriptors,...documentsToolDescriptors,...listTools,...googleTools,...memoryTools,...scheduleTools,...receiptTools,...displayToolDescriptors,...sharedTools]
  .map(value=>{
    const tool=value as DomainTool;
    const domain=(tool.capability??tool.name).split(".")[0];
    const inputSchema=tool.effect==="write"?{...tool.inputSchema,
      required:(Array.isArray(tool.inputSchema.required)?tool.inputSchema.required:[]).filter(value=>value!=="operationId"),
      properties:{...(tool.inputSchema.properties as Record<string,unknown>),
        operationId:{type:"string",pattern:"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$",description:"Optional stable operation key; application derives one from the admitted source and business arguments when omitted."},
        outcomeId:{type:"string",pattern:"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",description:"Optional declared task outcome served by this action; omit when exactly one outcome matches."}}}:tool.inputSchema;
    return {...tool,inputSchema,domain,nativeName:tool.name.startsWith("household_")?tool.name:nativeToolName(tool.name)};
  });
if(new Set(domainCatalog.map(tool=>tool.nativeName)).size!==domainCatalog.length)throw Error("duplicate_domain_tool_name");
