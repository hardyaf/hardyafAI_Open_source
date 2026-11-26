import { fingerprint } from "./common.ts";
/** Internal source scope, distinct from the native goal retained for question continuity. */
export function independentTopicTaskId(sourceId:string):string{return "topic:"+fingerprint([sourceId.replace(/^user:/,"")]).slice(0,64);}
