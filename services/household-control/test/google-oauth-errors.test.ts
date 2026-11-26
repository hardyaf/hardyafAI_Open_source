import assert from "node:assert/strict";
import test from "node:test";
import {OAuth2Client} from "google-auth-library";
import {createGoogleProvider} from "../src/connections/google.ts";
import {ConnectionsError} from "../src/connections/contracts.ts";
import type {GoogleAuthorization} from "../src/connections/contracts.ts";

const authorization: GoogleAuthorization={clientId:"fixture.apps.googleusercontent.com",clientSecret:"fixture-private-client-secret",redirectUri:"http://localhost:8787/oauth2/callback",
 state:"fixture-state",verifier:"fixture-private-pkce",nonce:"fixture-nonce",scopes:["https://www.googleapis.com/auth/gmail.readonly"],expectedEmail:"owner@example.invalid"};
const tokens={id_token:"fixture-private-id-token",refresh_token:"fixture-private-refresh-token",scope:"openid email https://www.googleapis.com/auth/gmail.readonly"};
const payload={sub:"fixture-subject",email:authorization.expectedEmail,email_verified:true,nonce:authorization.nonce};
const privateText="fixture-private-description fixture-private-client-secret fixture-private-code fixture-private-id-token";
function sdkError(providerError: unknown,status=400) {
 return Object.assign(new Error(privateText),{response:{status,data:{error:providerError,error_description:privateText}},config:{data:new URLSearchParams({client_secret:authorization.clientSecret,code:"fixture-private-code",code_verifier:authorization.verifier})}});
}
function verifyFailure(error: unknown,code: string,stage: string,reason: string) {
 assert.ok(error instanceof ConnectionsError);assert.equal(error.code,code);
 assert.equal((error as ConnectionsError & {stage:string}).stage,stage);assert.equal((error as ConnectionsError & {reason:string}).reason,reason);
 assert.doesNotMatch(String(error)+JSON.stringify(error),/fixture-private|error_description|client_secret|code_verifier/);
 assert.equal((error as Error & {cause?:unknown}).cause,undefined);return true;
}
for(const [providerError,code] of Object.entries({invalid_client:"google_client_credentials_rejected",unauthorized_client:"google_client_credentials_rejected",invalid_grant:"google_authorization_code_rejected",redirect_uri_mismatch:"google_redirect_uri_mismatch",access_denied:"google_consent_denied"})) {
 test("OAuth exchange safely classifies "+providerError,async t=>{
  const provider=await createGoogleProvider();
  t.mock.method(OAuth2Client.prototype,"getToken",async options=>{assert.equal(options.codeVerifier,authorization.verifier);assert.equal(options.redirect_uri,authorization.redirectUri);throw sdkError(providerError);});
  await assert.rejects(provider.exchange(authorization,"fixture-private-code"),error=>verifyFailure(error,code,"code_exchange",providerError));
 });
}
test("OAuth exchange temporary transport and provider failures expose no SDK request data",async t=>{
 const provider=await createGoogleProvider();let failure:unknown=Object.assign(new Error(privateText),{code:"ENOTFOUND"});
 t.mock.method(OAuth2Client.prototype,"getToken",async()=>{throw failure;});
 for(const injected of [failure,sdkError("temporarily_unavailable",503),sdkError("rate_limit",429),Object.assign(new Error(privateText),{code:"TimeoutError"}),Object.assign(new Error(privateText),{cause:{code:"ECONNRESET"}})]) {
  failure=injected;await assert.rejects(provider.exchange(authorization,"fixture-private-code"),error=>verifyFailure(error,"google_token_exchange_unavailable","code_exchange","transport_unavailable"));
 }
});
test("OAuth exchange never derives a classification from free text or unknown provider fields",async t=>{
 const provider=await createGoogleProvider();let failure:unknown=sdkError({error:"invalid_client"});
 t.mock.method(OAuth2Client.prototype,"getToken",async()=>{throw failure;});
 for(const injected of [failure,new Error("invalid_client "+privateText),sdkError("unknown_provider_reason")]) {
  failure=injected;await assert.rejects(provider.exchange(authorization,"fixture-private-code"),error=>verifyFailure(error,"google_token_exchange_failed","code_exchange","exchange_failed"));
 }
});
test("OAuth identity verification has a separate fixed failure stage and suppresses tokens in JWT errors",async t=>{
 const provider=await createGoogleProvider();let failure:unknown=new Error("Invalid token signature: "+privateText);
 t.mock.method(OAuth2Client.prototype,"getToken",async()=>({tokens}));
 t.mock.method(OAuth2Client.prototype,"verifyIdToken",async options=>{assert.equal(options.idToken,tokens.id_token);assert.equal(options.audience,authorization.clientId);throw failure;});
 await assert.rejects(provider.exchange(authorization,"fixture-private-code"),error=>verifyFailure(error,"google_identity_verification_failed","identity_verification","identity_validation_failed"));
 failure=Object.assign(new Error("Failed to retrieve verification certificates: "+privateText),{code:"ETIMEDOUT"});
 await assert.rejects(provider.exchange(authorization,"fixture-private-code"),error=>verifyFailure(error,"google_identity_verification_unavailable","identity_verification","transport_unavailable"));
});
test("OAuth diagnostics preserve grant completeness nonce verified email and exact scope checks",async t=>{
 const provider=await createGoogleProvider();let supplied:any={...tokens},identity:any={...payload};let verified=0;
 t.mock.method(OAuth2Client.prototype,"getToken",async()=>({tokens:supplied}));
 t.mock.method(OAuth2Client.prototype,"verifyIdToken",async()=>{verified++;return {getPayload:()=>identity};});
 supplied={...tokens,refresh_token:undefined};await assert.rejects(provider.exchange(authorization,"fixture-private-code"),/google_grant_incomplete/);assert.equal(verified,0);
 supplied={...tokens};identity={...payload,nonce:"wrong-nonce"};await assert.rejects(provider.exchange(authorization,"fixture-private-code"),/google_identity_not_verified/);
 identity={...payload,email_verified:false};await assert.rejects(provider.exchange(authorization,"fixture-private-code"),/google_identity_not_verified/);
 identity={...payload};supplied={...tokens,scope:tokens.scope+" https://www.googleapis.com/auth/calendar.events"};await assert.rejects(provider.exchange(authorization,"fixture-private-code"),/google_scope_exceeds_request/);
 supplied={...tokens};const result=await provider.exchange(authorization,"fixture-private-code");assert.equal(result.email,authorization.expectedEmail);assert.equal(result.accountId,payload.sub);
});

for(const method of ["getToken","refreshAccessToken","revokeToken"] as const) {
 test("official Google SDK "+method+" does not retry a lost provider response",async t=>{
  const provider=await createGoogleProvider(),original=OAuth2Client.prototype[method];let attempts=0;
  t.mock.method(OAuth2Client.prototype,method,function(...args:any[]){
   this.transporter.defaults.adapter=async options=>{
    attempts++;assert.equal(options.retry,false);assert.equal(options.retryConfig?.retry,0);assert.equal(options.retryConfig?.noResponseRetries,0);assert.equal(options.timeout,15000);
    throw Object.assign(new Error(privateText),{code:"ECONNRESET"});
   };
   return original.apply(this,args as any);
  });
  const pending=method==="getToken" ? provider.exchange(authorization,"fixture-private-code") : method==="refreshAccessToken" ?
    provider.refresh(authorization,"fixture-private-refresh-token") : provider.revoke("fixture-private-refresh-token");
  await assert.rejects(pending,error=>{assert.ok(error instanceof ConnectionsError);assert.doesNotMatch(String(error)+JSON.stringify(error),/fixture-private/);return true;});
  assert.equal(attempts,1,"A provider attempt with a lost response must not be automatically replayed");
 });
}
test("official Google signing-certificate fetch also obeys the final no-retry transport policy",async t=>{
 const provider=await createGoogleProvider();let attempts=0;
 t.mock.method(OAuth2Client.prototype,"getToken",async function(){
  this.transporter.defaults.adapter=async options=>{
   attempts++;assert.equal(options.retry,false);throw Object.assign(new Error(privateText),{code:"ECONNRESET"});
  };
  return {tokens};
 });
 await assert.rejects(provider.exchange(authorization,"fixture-private-code"),error=>verifyFailure(error,"google_identity_verification_unavailable","identity_verification","transport_unavailable"));
 assert.equal(attempts,1);
});
