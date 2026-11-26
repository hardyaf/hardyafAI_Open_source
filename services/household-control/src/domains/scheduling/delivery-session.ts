import {createHash} from "node:crypto";
/** Delivery-only native lane. owner.sessionKey retains the actual originating conversation. */
export function scheduleDeliverySessionKey(agentId:string,declarationKey:string):string{
  return "agent:"+agentId+":household-cron-delivery:"+createHash("sha256").update(declarationKey).digest("hex");
}
export function scheduleDeliveryIdentity(sessionKey:unknown):{agentId:string;sessionKey:string}|null{
  if(typeof sessionKey!=="string")return null;
  const match=/^agent:([A-Za-z0-9._-]{1,128}):household-cron-delivery:([a-f0-9]{64})$/.exec(sessionKey);
  return match?{agentId:match[1],sessionKey}:null;
}
export type QueuedNoticePolicy="finish_accepted"|"recheck_each_attempt";
