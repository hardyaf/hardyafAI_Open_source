export type CredentialContext={profileId:string;taskId?:string;sourcePromptId?:string;assertCurrent:()=>void};
export type CredentialBinding={id:string;secretId:string;profileIds:string[];uses:Array<"provider_refresh"|"browser_login">;origins?:string[]};
export class BitwardenCredentialConnector {
  constructor(options:{bindings:CredentialBinding[];environment?:Record<string,string|undefined>;invoke?:any;sdkInvoke?:any});
  refreshProvider(id:string,context:CredentialContext,refresh:(value:string)=>Promise<{status:"unchanged"|"replaced"|"reauth_required";value?:string}>):Promise<{bindingId:string;status:string;authoritativeWriteback:boolean;revision?:string}>;
  useBrowserLogin(id:string,context:CredentialContext,target:{origin:string},consume:(credentials:{username:string;password:string},delegation:{origin:string;profileId:string;taskId:string;sourcePromptId:string})=>Promise<{status:"authenticated"|"human_required"|"failed"}>):Promise<{bindingId:string;status:string}>;
}
