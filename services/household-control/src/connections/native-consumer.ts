import { googleMessageReadInput } from "../domains/google/message-read.ts";
import { createServer } from "node:http";
import { chmod } from "node:fs/promises";
import type { HouseholdDatabase } from "../database.ts";
import { NativeDomainAuthorization } from "../domain-runtime/native-scope.ts";
import type { NativeToolContext } from "../domain-runtime/native-scope.ts";
import type { DomainConfiguration } from "../domain-runtime/configuration.ts";
import type { ConnectionsService } from "./service.ts";
import { ConnectionsError, fields, object, string, googleService } from "./contracts.ts";
import { sendJson } from "../http-codec.ts";

const reads={household_email_search:'gmail.search',household_email_read:'gmail.get',household_email_drafts:'gmail.drafts.list',household_email_draft_get:'gmail.drafts.get',household_email_labels:'gmail.labels.list',household_calendar_list:'calendar.list',household_calendar_get:'calendar.get',household_calendar_calendars:'calendar.calendars',household_calendar_find_operation:'calendar.find_operation'} as const;
const writes={household_email_send:'gmail.send',household_email_draft_save:'gmail.draft.save',household_email_draft_send:'gmail.draft.send',household_email_draft_delete:'gmail.draft.delete',household_email_label_save:'gmail.label.save',household_email_label_delete:'gmail.label.delete',household_email_modify:'gmail.modify',household_email_trash:'gmail.trash',household_calendar_create:'calendar.create',household_calendar_update:'calendar.update',household_calendar_delete:'calendar.delete'} as const;
const operations={...reads,...writes};

export function createNativeCredentialConsumer(options: {
  database: HouseholdDatabase; service: ConnectionsService; configuration: DomainConfiguration;
}) {
  const authorization = new NativeDomainAuthorization(options.database, options.configuration.profiles, (packet, profileId) => {
    const origin = packet.origin;
    return origin?.kind === "discord" && options.configuration.execution.nativeEntries.some(rule =>
      rule.profileId === profileId && rule.externalUserId === origin.externalUserId && rule.channelId === origin.channelId &&
      rule.audience === (origin.shared ? "household" : "private"));
  });
  return createServer({ requestTimeout: 0, headersTimeout: 5000 }, async (request, response) => {
    const cancellation = new AbortController();
    response.on("close", () => { if (!response.writableFinished) cancellation.abort(); });
    let writing=false;
    try {
      if (request.method !== "POST" || request.url !== "/google") throw new ConnectionsError("connection_operation_not_allowed", 403);
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(chunk);
      }
      const input = object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      fields(input, ["action", "connectionId", "tool", "args", "context"]);
      const wire = object(input.context);
      fields(wire, ["agentId","sessionKey","sessionId","runId","nativeRunId","nativeGoalId","nativeGoalStatus","nativeSessionId"]);
      for (const value of Object.values(wire)) if (value != null && typeof value !== "string") throw new ConnectionsError("invalid_connection_request", 400);
      const context: NativeToolContext = { ...wire, assertInvocationCurrent() {
        if (cancellation.signal.aborted) throw new ConnectionsError("connection_request_cancelled", 409);
      } };
      const scope = authorization.resolve(context, cancellation.signal);
      const current = () => {
        scope.principal.assertCurrent();
        options.service.assertSecure();
        if (scope.mode !== "normal" || scope.principal.audience !== "private" ||
            !scope.grant.scopes.includes("personal")) throw new ConnectionsError("private_connection_context_required", 403);
      };
      current();
      if (input.action === "list") {
        const snapshot = await options.service.snapshot(scope.principal.profileId);
        current();
        const connections = snapshot.connections.filter(item => item.kind === "google" && item.status === "connected" &&
          scope.grant.domains.includes(googleService(item.preset) === "gmail" ? "email" : "calendar"));
        sendJson(response, 200, { connections: connections.map(item => ({ ...item, connectionId: item.id })) }); return;
      }
      if(typeof input.tool!=='string'||!Object.hasOwn(operations,input.tool))throw new ConnectionsError('connection_operation_not_allowed',403);
      const tool=input.tool as keyof typeof operations;writing=Object.hasOwn(writes,tool);
      const domain=tool.startsWith('household_email_')?'email':'calendar';
      if(!scope.grant.domains.includes(domain))throw new ConnectionsError('connection_operation_not_allowed',403);
      const action=writing?'write':'read',body=tool==='household_email_read'?googleMessageReadInput(input.args):input.args;
      let result:unknown;
      if(input.action===action+'_default_email'){
        fields(input,['action','tool','args','context']);if(domain!=='email')throw new ConnectionsError('connection_operation_not_allowed',403);
        result=writing?await options.service.writeDefaultGoogleEmail(scope.principal.profileId,options.configuration.google.account,operations[tool] as any,body,current,cancellation.signal):await options.service.readDefaultGoogleEmail(scope.principal.profileId,options.configuration.google.account,operations[tool] as any,body,current,cancellation.signal);
      }else{
        if(input.action!==action)throw new ConnectionsError('connection_operation_not_allowed',403);
        const id=string(input.connectionId,128);
        result=writing?await options.service.writeGoogle(scope.principal.profileId,id,operations[tool] as any,body,current,cancellation.signal):await options.service.readGoogle(scope.principal.profileId,id,operations[tool] as any,body,current,cancellation.signal);
      }
      current();sendJson(response,200,{source:'connected_google',untrusted:true,result});
    } catch (error) {
      const raw = error as {code?: string; statusCode?: number; httpStatus?: number;outcome?:string;deliveryOutcome?:string};
      const code = typeof raw.code === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(raw.code) ? raw.code : "connected_google_unavailable";
      const status = raw.statusCode ?? raw.httpStatus ?? 503;
      sendJson(response, [400,403,404,409,503].includes(status) ? status : 503, { error: code,...(writing?{outcome:raw.outcome??raw.deliveryOutcome??"unknown"}:{}) });
    }
  });
}

export async function listenNativeCredentialConsumer(server: ReturnType<typeof createNativeCredentialConsumer>, socketPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve());
  });
  await chmod(socketPath, 0o660);
}
