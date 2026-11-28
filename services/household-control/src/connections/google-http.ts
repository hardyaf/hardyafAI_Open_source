import {ConnectionsError} from './contracts.ts';
/** Fixed Google origins only; request bodies and credentials never become error messages. */
export async function googleHttp(accessToken:string,url:URL,method='GET',body?:unknown,signal?:AbortSignal,etag?:string):Promise<any>{
 const write=method!=='GET';
 if(!['https://gmail.googleapis.com','https://www.googleapis.com'].includes(url.origin)||url.username||url.password)throw new ConnectionsError('connection_operation_not_allowed',403);
 if(signal?.aborted)throw new ConnectionsError('connection_request_cancelled',409,'not_sent');
 let response:Response;
 if(etag!==undefined&&(typeof etag!=='string'||/[\r\n\x00]/.test(etag)))throw new ConnectionsError('invalid_google_write',400);
 try{response=await fetch(url,{method,headers:{authorization:'Bearer '+accessToken,...(body!==undefined?{'content-type':'application/json'}:{}),...(etag?{'if-match':etag}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal,redirect:'error'});}
 catch{throw new ConnectionsError(write?'google_write_outcome_unknown':'google_read_unavailable',503,write?'unknown':'not_sent');}
 if(!response.ok){
  await response.body?.cancel();
  if(!write)throw new ConnectionsError('google_read_unavailable');
  const status=response.status,unknown=status>=500;
  throw new ConnectionsError(status===412?'google_revision_conflict':status===409?'google_write_conflict':status===401||status===403?'google_write_not_authorized':status===404?'google_resource_not_found':unknown?'google_write_outcome_unknown':'google_write_rejected',status===409||status===412?409:status===404?404:status===401||status===403?403:unknown||status===429?503:400,unknown?'unknown':'not_sent');
 }
 if(response.status===204)return {};
 try{const raw=await response.text();return raw?JSON.parse(raw):{};}
 catch{throw new ConnectionsError(write?'google_write_outcome_unknown':'google_read_invalid',503,write?'unknown':'not_sent');}
}
