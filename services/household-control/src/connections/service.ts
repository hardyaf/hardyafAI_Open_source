import {googleWriteInput} from "../domains/google/write-input.ts";
import { googleMessageReadInput } from "../domains/google/message-read.ts";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { ConnectionsError, fields, object, operation, origin, presets, redirect, string, googleService, googleAccess, readScopes, writeScopes } from "./contracts.ts";
import type { ConnectionRecord, ConnectionsStore, ConnectionVault, GoogleAuthorization, GoogleGrant, GooglePreset, GoogleProvider, GoogleReadOperation, GoogleWriteOperation } from "./contracts.ts";

type Flow = {
  operationId:string; targetFingerprint?:string; id: string; owner: string; connectionId: string; label: string; preset: GooglePreset; createdAt: string;
  authorization: GoogleAuthorization; authorizationUrl: string; expiresAt: number; clientSecretId: string; assertCurrent: () => void;
  state: "ready" | "exchanging" | "saving" | "failed" | "complete"; grant?: GoogleGrant;
};
const publicRecord = ({ secretId, ownerProfileId, ...value }: ConnectionRecord) => { void secretId; void ownerProfileId; return {...value,...(value.kind==="google"?{service:googleService(value.preset),access:googleAccess(value)}:{})}; };
const equal = (left: string, right: string) => { const a = Buffer.from(left), b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); };
const connectionId = (owner: string, id: string) => "connection-" + createHash("sha256").update(owner + "\0" + id).digest("hex").slice(0, 32);
const authorityFingerprint=(record:ConnectionRecord)=>createHash('sha256').update(JSON.stringify([record.ownerProfileId,record.account,record.accountId,record.preset,record.scopes,record.secretId,record.status])).digest('hex');

/** Runs only inside the isolated credential service. Secret values never enter native tool results. */
export class ConnectionsService {
  #store: ConnectionsStore; #vault: ConnectionVault; #google: GoogleProvider; #securityReady: () => boolean;
  #now: () => number; #flows = new Map<string, Flow>(); #busy = new Set<string>();
  constructor(options: { store: ConnectionsStore; vault: ConnectionVault; google: GoogleProvider; securityReady: () => boolean; now?: () => number }) {
    this.#store = options.store; this.#vault = options.vault; this.#google = options.google;
    this.#securityReady = options.securityReady; this.#now = options.now ?? Date.now;
  }
  assertSecure() {
    if (!this.#securityReady()) throw new ConnectionsError("credential_isolation_unavailable");
  }
  async snapshot(owner: string) {
    const client = this.#store.list(owner).filter(item => item.kind === "google_client" && item.status === "connected").at(-1);
    return {
      security: { ready: this.#securityReady(), ...(!this.#securityReady() ? { reason: "credential_isolation_unavailable" } : {}) },
      vault: { configured: this.#securityReady() && await this.#vault.configured() },
      google: { configured: !!client, ...(client ? { clientId: client.clientId, redirectUri: client.redirectUri } : {}) },
      connections: this.#store.list(owner).filter(item => item.kind !== "google_client").map(publicRecord),
      providerPresets: Object.keys(presets),
    };
  }
  async #owned<T>(owner: string, id: string, current: () => void, action: () => Promise<T>): Promise<T> {
    this.assertSecure(); current(); const key = owner + "\0" + id;
    if (this.#busy.has(key)) throw new ConnectionsError("connection_operation_in_progress", 409);
    this.#busy.add(key);
    try { const result = await action(); current(); return result; } finally { this.#busy.delete(key); }
  }
  async bootstrap(owner: string, input: unknown, current: () => void) {
    const body = object(input); fields(body, ["operationId", "accessToken", "organizationId", "projectId"]);
    return this.#owned(owner, operation(body.operationId), current, async () => {
      current(); await this.#vault.bootstrap({ accessToken: string(body.accessToken, 8192), organizationId: string(body.organizationId), projectId: string(body.projectId) });
      return { configured: true };
    });
  }
  async savePassword(owner: string, input: unknown, current: () => void) {
    const body = object(input); fields(body, ["operationId", "label", "username", "password", "origin"]);
    const id = connectionId(owner, operation(body.operationId));
    const label = string(body.label, 120), username = string(body.username, 512), password = string(body.password, 16384), target = origin(body.origin);
    return this.#owned(owner, id, current, async () => {
      const prior = this.#store.get(owner, id);
      if (prior && (prior.kind !== "password" || prior.label !== label || prior.account !== username || prior.origin !== target))
        throw new ConnectionsError("connection_operation_conflict", 409);
      current(); const now = new Date(this.#now()).toISOString();
      const record: ConnectionRecord = { id, ownerProfileId: owner, kind: "password", label, account: username, origin: target, scopes: [], secretId: prior?.secretId ?? "",
        status: "connected", createdAt: prior?.createdAt ?? now, updatedAt: now };
      return { connection: publicRecord(await this.#commit(record, JSON.stringify({ username, password }), current)) };
    });
  }
  async configureGoogle(owner: string, input: unknown, current: () => void) {
    const body = object(input); fields(body, ["operationId", "clientId", "clientSecret", "redirectUri"]);
    const normalizedSecret = typeof body.clientSecret === "string" ? body.clientSecret.trim() : "";
    if (!normalizedSecret) throw new ConnectionsError("invalid_google_client", 400);
    const id = connectionId(owner, operation(body.operationId)), clientId = string(body.clientId, 512), clientSecret = string(normalizedSecret, 4096), redirectUri = redirect(body.redirectUri);
    if (!/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw new ConnectionsError("invalid_google_client", 400);
    return this.#owned(owner, id, current, async () => {
      current(); const now = new Date(this.#now()).toISOString();
      const prior = this.#store.get(owner, id);
      if (prior && (prior.kind !== "google_client" || prior.clientId !== clientId || prior.redirectUri !== redirectUri)) throw new ConnectionsError("connection_operation_conflict", 409);
      const record: ConnectionRecord = { id, ownerProfileId: owner, label: "Google OAuth application", kind: "google_client", scopes: [], secretId: prior?.secretId ?? "",
        clientId, redirectUri, status: "connected", createdAt: prior?.createdAt ?? now, updatedAt: now };
      await this.#commit(record, JSON.stringify({ clientId, clientSecret, redirectUri }), current);
      for (const old of this.#store.list(owner).filter(item => item.kind === "google_client" && item.id !== id && item.status === "connected")) {
        current(); this.#store.save({ ...old, status: "disconnected", updatedAt: now });
      }
      return { configured: true, clientId, redirectUri };
    });
  }
  async startGoogle(owner: string, input: unknown, current: () => void) {
    const body = object(input); fields(body, ["operationId", "label", "expectedEmail", "preset", "connectionId"]);
    const requestOperation=operation(body.operationId), label = string(body.label, 120), expectedEmail = string(body.expectedEmail, 320).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(expectedEmail) || typeof body.preset !== "string" || !Object.hasOwn(presets, body.preset))
      throw new ConnectionsError("invalid_google_request", 400);
    const preset = body.preset as GooglePreset;
    const matches=this.#store.list(owner).filter(row=>row.kind==='google'&&row.status!=='disconnected'&&row.account?.toLowerCase()===expectedEmail&&googleService(row.preset)===googleService(preset));
    const target=body.connectionId!==undefined?this.#store.get(owner,string(body.connectionId,128)):matches.length===1?matches[0]:undefined;
    if(body.connectionId!==undefined&&(!target||target.kind!=='google'||target.account?.toLowerCase()!==expectedEmail||googleService(target.preset)!==googleService(preset)))throw new ConnectionsError('connection_identity_mismatch',403);
    if(body.connectionId===undefined&&matches.length>1)throw new ConnectionsError('google_connection_ambiguous',409);
    const id=target?.id??connectionId(owner,requestOperation);
    return this.#owned(owner, id, current, async () => {
      for (const [key, flow] of this.#flows) if (flow.expiresAt < this.#now() && flow.state !== "saving") this.#flows.delete(key);
      const existing = [...this.#flows.values()].find(flow => flow.owner === owner && flow.operationId === requestOperation);
      if (existing) {
        if (existing.connectionId!==id || existing.label !== label || existing.preset !== preset || existing.authorization.expectedEmail !== expectedEmail)
          throw new ConnectionsError("connection_operation_conflict", 409);
        if (existing.state === "failed") throw new ConnectionsError("google_authorization_restart_required", 409);
        return { flowId: existing.id, authorizationUrl: existing.authorizationUrl, expiresAt: new Date(existing.expiresAt).toISOString() };
      }
      const client = this.#store.list(owner).filter(item => item.kind === "google_client" && item.status === "connected").at(-1);
      if (!client) throw new ConnectionsError("google_client_not_configured", 409);
      current(); const credentials = object(JSON.parse(await this.#vault.read(client.secretId))); current();
      const authorization: GoogleAuthorization = { clientId: string(credentials.clientId, 512), clientSecret: string(credentials.clientSecret, 4096), redirectUri: redirect(credentials.redirectUri),
        state: randomBytes(32).toString("base64url"), verifier: randomBytes(48).toString("base64url"), nonce: randomBytes(32).toString("base64url"),
        scopes: [...presets[preset]], expectedEmail };
      const authorizationUrl = await this.#google.authorizationUrl(authorization), flowId = randomBytes(24).toString("base64url"), expiresAt = this.#now() + 10 * 60_000;
      this.#flows.set(flowId, { operationId:requestOperation,...(target?{targetFingerprint:authorityFingerprint(target)}:{}),id: flowId, owner, connectionId: id, label, preset, authorization, authorizationUrl, expiresAt, clientSecretId: client.secretId, assertCurrent: current, createdAt: target?.createdAt??new Date(this.#now()).toISOString(), state: "ready" });
      return { flowId, authorizationUrl, expiresAt: new Date(expiresAt).toISOString() };
    });
  }
  async completeGoogle(owner: string, input: unknown, current: () => void) {
    const body = object(input); fields(body, ["flowId", "callbackUrl"]);
    const flowId = string(body.flowId, 96), callback = string(body.callbackUrl, 8192);
    return this.#owned(owner, flowId, current, async () => {
      const flow = this.#flows.get(flowId);
      if (!flow || flow.owner !== owner || flow.expiresAt < this.#now() && flow.state !== "saving" && flow.state !== "complete")
        throw new ConnectionsError("google_authorization_expired", 409);
      return this.#owned(owner,flow.connectionId,current,async()=>{
      if (flow.state === "complete") return { connection: publicRecord(this.#store.get(owner, flow.connectionId)!) };
      if (flow.state === "failed") throw new ConnectionsError("google_authorization_restart_required", 409);
      if (flow.state === "exchanging") throw new ConnectionsError("google_authorization_outcome_unknown", 409, "unknown");
      if (flow.state === "ready") {
        const prior=this.#store.get(owner,flow.connectionId);
        if(flow.targetFingerprint&&(!prior||authorityFingerprint(prior)!==flow.targetFingerprint))throw new ConnectionsError('google_connection_changed',409);
        let url: URL;
        try { url = new URL(callback); } catch { throw new ConnectionsError("invalid_google_callback", 400); }
        const expected = new URL(flow.authorization.redirectUri);
        if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.hash || url.username || url.password ||
          url.searchParams.getAll("state").length !== 1 || !equal(url.searchParams.get("state") ?? "", flow.authorization.state) ||
          url.searchParams.getAll("code").length !== 1 || url.searchParams.has("error")) throw new ConnectionsError("invalid_google_callback", 400);
        const code = string(url.searchParams.get("code"), 4096);
        current(); flow.assertCurrent(); flow.state = "exchanging";
        try {
          flow.grant = await this.#google.exchange(flow.authorization, code); current(); flow.assertCurrent();
          if (!equal(flow.grant.email.toLowerCase(), flow.authorization.expectedEmail)) throw new ConnectionsError("google_account_mismatch", 403);
          if (flow.authorization.scopes.some(scope => !flow.grant!.scopes.includes(scope))) throw new ConnectionsError("google_scope_not_granted", 403);
          flow.state = "saving";
        } catch (error) { flow.state = "failed"; flow.grant = undefined; throw error; }
      }
      const grant = flow.grant!;
      const credential = JSON.stringify({ type: "google_oauth_v1", refreshToken: grant.refreshToken, clientId: flow.authorization.clientId,
        email: grant.email, accountId: grant.accountId, scopes: grant.scopes, clientSecretId: flow.clientSecretId });
      current(); flow.assertCurrent(); const record: ConnectionRecord = { id: flow.connectionId, ownerProfileId: owner, label: flow.label, kind: "google", account: grant.email, accountId: grant.accountId,
        preset: flow.preset, scopes: flow.authorization.scopes, secretId: this.#store.get(owner, flow.connectionId)?.secretId ?? "", status: "connected", createdAt: flow.createdAt, updatedAt: new Date(this.#now()).toISOString() };
      const saved = await this.#commit(record, credential, current);
      flow.grant = undefined; flow.authorization.clientSecret = ""; flow.authorization.verifier = ""; flow.state = "complete";
      return { connection: publicRecord(saved) };
      });
    });
  }
  async #commit(record: ConnectionRecord, value: string, current: () => void): Promise<ConnectionRecord> {
    const prior = this.#store.get(record.ownerProfileId, record.id);
    const sameResource = (item: ConnectionRecord) => item.kind === record.kind &&
      (record.kind === "password" ? item.account === record.account && item.origin === record.origin :
        record.kind === "google" ? item.account === record.account && item.preset === record.preset : item.clientId === record.clientId);
    if (this.#store.list(record.ownerProfileId).some(item => item.id !== record.id && item.status === "unknown" && !item.secretId && sameResource(item)))
      throw new ConnectionsError("connection_reconciliation_required", 409);
    const allowCreate = !prior || !prior.secretId && prior.status === "disconnected";
    const pending = { ...record, status: "unknown" as const };
    current(); this.#store.save(pending);
    try {
      const receipt = await this.#vault.put(record.id, value, allowCreate); current();
      const committed = { ...record, secretId: receipt.secretId };
      this.#store.save(committed); return committed;
    } catch (error) {
      if(prior&&!allowCreate&&(error as {outcome?:string}).outcome==="not_sent"){current();this.#store.save(prior);}
      if (allowCreate && (error as {outcome?: string}).outcome === "not_sent") {
        current(); this.#store.save({ ...pending, status: "disconnected" });
      }
      throw error;
    }
  }
  async disconnect(owner: string, id: string, input: unknown, current: () => void) {
    const body = object(input); fields(body, ["operationId"]); operation(body.operationId);
    return this.#owned(owner, id, current, async () => {
      const record = this.#store.get(owner, id);
      if (!record || record.kind === "google_client") throw new ConnectionsError("connection_not_found", 404);
      if (record.status !== "disconnected" && record.kind === "google") {
        current(); const grant = object(JSON.parse(await this.#vault.read(record.secretId))); current();
        await this.#google.revoke(string(grant.refreshToken, 16384));
      }
      const updated = { ...record, status: "disconnected" as const, updatedAt: new Date(this.#now()).toISOString() };
      current(); this.#store.save(updated); return { connection: publicRecord(updated) };
    });
  }
  async setGoogleReadOnly(owner:string,input:unknown,current:()=>void){
    const body=object(input);fields(body,['connectionId','operationId']);operation(body.operationId);const id=string(body.connectionId,128);
    return this.#owned(owner,id,current,async()=>{
      const prior=this.#store.get(owner,id);if(!prior||prior.kind!=='google'||prior.status!=='connected')throw new ConnectionsError('connection_not_available',409);
      const preset:GooglePreset=googleService(prior.preset)==='gmail'?'gmail_read':'calendar_read';
      const next={...prior,preset,updatedAt:new Date(this.#now()).toISOString()};current();this.#store.save(next);return {connection:publicRecord(next)};
    });
  }
  async readDefaultGoogleEmail(owner:string,account:string,operation:GoogleReadOperation,input:unknown,current:()=>void,signal?:AbortSignal){
    if(!Object.hasOwn(readScopes,operation)||!operation.startsWith('gmail.'))throw new ConnectionsError('connection_operation_not_allowed',403);
    return this.readGoogle(owner,this.#defaultGoogleEmail(owner,account,current),operation,input,current,signal);
  }
  async writeDefaultGoogleEmail(owner:string,account:string,operation:GoogleWriteOperation,input:unknown,current:()=>void,signal?:AbortSignal){
    if(!writeScopes(operation).length||!operation.startsWith('gmail.'))throw new ConnectionsError('connection_operation_not_allowed',403);
    return this.writeGoogle(owner,this.#defaultGoogleEmail(owner,account,current),operation,input,current,signal);
  }
  #defaultGoogleEmail(owner:string,configuredAccount:string,current:()=>void):string{
    this.assertSecure(); current();
    const account = typeof configuredAccount === "string" ? configuredAccount.trim().toLowerCase() : "";
    if (!account || account.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account))
      throw new ConnectionsError("google_default_mailbox_not_configured", 409);
    const matches = this.#store.list(owner).filter(item => item.ownerProfileId === owner && item.kind === "google" &&
      googleService(item.preset) === "gmail" && typeof item.account === "string" && item.account.trim().toLowerCase() === account);
    current();
    // A refresh temporarily marks its binding unknown. It must not silently make
    // a different same-account grant become the default. Disconnected history is retained.
    const bindings = matches.filter(item => item.status !== "disconnected");
    if (bindings.length > 1) throw new ConnectionsError("google_default_mailbox_ambiguous", 409);
    const selected = bindings[0];
    if (!selected) throw new ConnectionsError(matches.length ? "google_default_mailbox_unavailable" : "google_default_mailbox_not_connected", 409);
    if (selected.status === "needs_reauthorization") throw new ConnectionsError("google_default_mailbox_needs_reauthorization", 409);
    if (selected.status !== "connected") throw new ConnectionsError("google_default_mailbox_unavailable", 409);
    if (!readScopes["gmail.get"].some(scope => selected.scopes.includes(scope))) throw new ConnectionsError("connection_operation_not_allowed", 403);
    current();
    return selected.id;
  }
  async readGoogle(owner:string,id:string,operation:GoogleReadOperation,input:unknown,current:()=>void,signal?:AbortSignal){return this.#executeGoogle(owner,id,operation,input,current,signal,false);}
  async writeGoogle(owner:string,id:string,operation:GoogleWriteOperation,input:unknown,current:()=>void,signal?:AbortSignal){return this.#executeGoogle(owner,id,operation,input,current,signal,true);}
  async #executeGoogle(owner:string,id:string,operation:GoogleReadOperation|GoogleWriteOperation,input:unknown,current:()=>void,signal:AbortSignal|undefined,write:boolean){
    return this.#owned(owner, id, current, async () => {
      const record = this.#store.get(owner, id);
      if (!record || record.kind !== "google" || record.status !== "connected") throw new ConnectionsError("connection_not_available", 409);
      const required=write?writeScopes(operation as GoogleWriteOperation):readScopes[operation as GoogleReadOperation];
      if(!required?.length||!required.some(scope=>record.scopes.includes(scope)))throw new ConnectionsError('connection_operation_not_allowed',403);
      if(write&&googleAccess(record)!=='write')throw new ConnectionsError('connection_operation_not_allowed',403);
      if(write&&(!record.account||!record.accountId))throw new ConnectionsError('connection_identity_mismatch',403);
      if(write&&!this.#google.write)throw new ConnectionsError('connection_operation_unavailable',503);
      const readInput=write?googleWriteInput(operation as GoogleWriteOperation,input):operation==='gmail.get'?googleMessageReadInput(input):input;
      if (operation === "gmail.get" && (!record.account || !record.accountId)) throw new ConnectionsError("connection_identity_mismatch", 403);
      current(); const previous = await this.#vault.read(record.secretId); current();
      const grant = object(JSON.parse(previous));
      if (grant.email !== record.account || grant.accountId !== record.accountId || grant.type !== "google_oauth_v1")
        throw new ConnectionsError("connection_identity_mismatch", 403);
      const clientSecretId = string(grant.clientSecretId);
      if (!this.#store.list(owner).some(row => row.kind === "google_client" && row.secretId === clientSecretId))
        throw new ConnectionsError("google_client_not_configured", 409);
      const config = object(JSON.parse(await this.#vault.read(clientSecretId))); current();
      const client = {clientId: string(config.clientId, 512), clientSecret: string(config.clientSecret, 4096), redirectUri: redirect(config.redirectUri)};
      if (client.clientId !== grant.clientId) throw new ConnectionsError("connection_identity_mismatch", 403);
      // Refresh can rotate a token. Persist uncertainty before crossing that provider boundary.
      current(); this.#store.save({...record, status: "unknown", updatedAt: new Date(this.#now()).toISOString()});
      const refreshed = await this.#google.refresh(client, string(grant.refreshToken, 16384)); current();
      if (refreshed.refreshToken && refreshed.refreshToken !== grant.refreshToken) {
        await this.#vault.replace(record.secretId, previous, JSON.stringify({...grant, refreshToken: refreshed.refreshToken})); current();
      }
      this.#store.save({...record, status: "connected", updatedAt: new Date(this.#now()).toISOString()}); current();
      const context = {...(signal?{signal}:{}),messageScope: createHash("sha256").update(JSON.stringify({owner, connectionId: id, account: record.account!.trim().toLowerCase(), accountId: record.accountId})).digest("hex"),...(operation==="calendar.find_operation"?{operationKey:createHash("sha256").update(JSON.stringify([owner,id,object(readInput).operationId])).digest("hex")}: {})};
      const result = write?await this.#google.write!(refreshed.accessToken,operation as GoogleWriteOperation,readInput,{from:record.account!,operationKey:createHash("sha256").update(JSON.stringify([owner,id,object(readInput).operationId])).digest("hex"),...(signal?{signal}:{})}):await this.#google.read(refreshed.accessToken, operation as GoogleReadOperation, readInput, context); current();
      return {connectionId: id, account: record.account, operation, untrusted: true, result};
    });
  }
  async acceptGoogleCallback(callbackUrl: string) {
    this.assertSecure();
    let url: URL;
    try { url = new URL(callbackUrl); } catch { throw new ConnectionsError("invalid_google_callback", 400); }
    const state = url.searchParams.get("state");
    if (!state || url.searchParams.getAll("state").length !== 1) throw new ConnectionsError("invalid_google_callback", 400);
    const flow = [...this.#flows.values()].find(item => equal(item.authorization.state, state));
    if (!flow) throw new ConnectionsError("google_authorization_expired", 409);
    flow.assertCurrent();
    return this.completeGoogle(flow.owner, { flowId: flow.id, callbackUrl }, flow.assertCurrent);
  }
  close() { this.#flows.clear(); }
}
