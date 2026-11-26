import { fingerprint } from "./common.ts";

type OperationIdentity = {fields:readonly string[];defaults?:Readonly<Record<string,unknown>>};
/** Application-owned keys stay stable across continuations; domain hints identify the operation's resource. */
export function nativeOperationId(sourceId:string,tool:{nativeName:string;operationIdentity?:OperationIdentity},args:Record<string,unknown>):string{
  if(typeof args.operationId==="string")return args.operationId;
  const identity=tool.operationIdentity?Object.fromEntries(tool.operationIdentity.fields.map(key=>[key,args[key]??tool.operationIdentity?.defaults?.[key]])):args;
  return "auto:"+fingerprint([sourceId,tool.nativeName,identity]).slice(0,64);
}
