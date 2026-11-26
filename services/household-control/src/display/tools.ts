import type {DisplayPublisher,DisplayPublishAuthorization,DisplayPublishInput} from "./contracts.ts";
import {DisplayError,DisplayService} from "./service.ts";
export const displayToolDescriptors=[{
  name:"display.publish",capability:"display",effect:"write",description:"Publish one owned household output to the shared kitchen display when the current adult human asks. Completed-task outputs are eligible. No second confirmation is needed for an authorized request; never publish automatically or promote private output. Only safe raster/text output is eligible; diagnostics, private financial reports, children and arbitrary artifacts cannot publish.",
  inputSchema:{type:"object",additionalProperties:false,required:["operationId","artifactId","title"],properties:{
    operationId:{type:"string",pattern:"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$"},artifactId:{type:"string",pattern:"^artifact-[a-f0-9]{64}$"},
    title:{type:"string",minLength:1,maxLength:180},expiresAt:{type:"string",format:"date-time",maxLength:40},
  }},
}] as const;
export function createDisplayTools(service:DisplayService){return {descriptors:displayToolDescriptors,
  async execute(name:string,args:unknown,principal:DisplayPublisher,authorization:DisplayPublishAuthorization){
    if(name!=="display.publish")throw new DisplayError("display_tool_unavailable",404);
    if(!args||typeof args!=="object"||Array.isArray(args)||Object.keys(args).some(key=>!["operationId","artifactId","title","expiresAt"].includes(key)))throw new DisplayError("display_arguments_invalid");
    return service.publish(principal,args as DisplayPublishInput,authorization);
  }};}
