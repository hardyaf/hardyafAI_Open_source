import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestContext } from "../server.ts";
import { sendJson, parseJson } from "../http-codec.ts";
import { BoundedProcessRunner } from "../domain-runtime/bounded-process.ts";
import { DeviceEffectStore } from "./device-effects.ts";
import { fitbitError, projectSnapshot } from "./contracts.ts";
import type { FitbitConfiguration, FitbitController } from "./contracts.ts";

const root = "/v1/fitbit";
export function createFitbitRoutes(options: {
  configuration: FitbitConfiguration; effects: DeviceEffectStore;
  assertCurrent(context: RequestContext): void; controller?: FitbitController;
}) {
  const runner = new BoundedProcessRunner();
  const controller: FitbitController = options.controller ?? {
    async execute(action, guestId, assertCurrent) {
      const uid=process.getuid?.();
      if(uid===undefined)throw fitbitError("fitbit_controller_unavailable");
      const runtime="/run/user/"+uid;
      const value = await runner.runJson(options.configuration.controller, [action, guestId], {
        timeoutMs: 8_000, maxBytes: 16_384, assertCurrent,
        env:{XDG_RUNTIME_DIR:runtime,DBUS_SESSION_BUS_ADDRESS:"unix:path="+runtime+"/bus"},
        effect: action !== "status", errorEnvelopeExitCode: 1,
      }) as { ok?: boolean; error?: {code?: string; status?: number; outcome?: string} };
      if (value?.ok === false) {
        const code = value.error?.code;
        if (!code || !/^fitbit_[a-z_]{1,60}$/.test(code)) throw fitbitError("fitbit_controller_unavailable");
        throw Object.assign(fitbitError(code, [409,503].includes(value.error?.status ?? 0) ? value.error!.status : 503),{outcome:value.error?.outcome === "not_sent" ? "not_sent" : "unknown"});
      }
      return value;
    },
  };
  const assertAccess = (context: RequestContext) => {
    options.assertCurrent(context);
    if (context.device.kind !== "signed" || context.device.deviceKind !== "personal") throw fitbitError("fitbit_not_allowed",403);
    const binding = options.configuration.profiles[context.profile.id];
    if (!binding) throw fitbitError("fitbit_not_allowed",403);
    return binding;
  };
  return {
    async route(request: IncomingMessage, response: ServerResponse, url: URL, bytes: Buffer, context: RequestContext) {
      if (url.pathname !== root && url.pathname !== root + "/sync") return false;
      const binding = assertAccess(context);
      const current = () => { assertAccess(context); };
      if (url.search) throw fitbitError("invalid_fitbit_request",400);
      if (request.method === "GET" && url.pathname === root) {
        const snapshot = projectSnapshot(await controller.execute("status",binding.guestId,current),options.configuration.locationLabel);
        current(); sendJson(response,200,{ fitbit: snapshot }); return true;
      }
      if (!["POST","DELETE"].includes(request.method ?? "") || url.pathname !== root + "/sync") {
        response.setHeader("Allow",url.pathname === root ? "GET" : "POST, DELETE");
        sendJson(response,405,{error:"method_not_allowed"}); return true;
      }
      const body = parseJson(bytes);
      if (Object.keys(body).some(key => key !== "operationId") || typeof body.operationId !== "string" ||
          !/^[a-zA-Z0-9][a-zA-Z0-9._-]{7,95}$/.test(body.operationId))
        throw fitbitError("invalid_fitbit_request",400);
      const action = request.method === "POST" ? "start" : "stop";
      current();
      const prior = options.effects.begin(context.profile.id, context.device.deviceId, body.operationId,
        "fitbit." + action, { guestId: binding.guestId });
      if (prior.replayed) {
        const snapshot=projectSnapshot(await controller.execute("status",binding.guestId,current),options.configuration.locationLabel);
        current(); sendJson(response,200,{...prior.result,fitbit:snapshot,replayed:true}); return true;
      }
      let dispatched = false;
      try {
        current(); dispatched = true;
        const snapshot = projectSnapshot(await controller.execute(action,binding.guestId,current),options.configuration.locationLabel);
        const result = { operationId: body.operationId, accepted:true, fitbit:snapshot, replayed:false };
        options.effects.finish(context.profile.id,body.operationId,"committed",result);
        current(); sendJson(response,202,result); return true;
      } catch (error) {
        options.effects.finish(context.profile.id,body.operationId,dispatched && (error as {outcome?:string}).outcome !== "not_sent" ? "unknown" : "failed");
        throw error;
      }
    },
    close: () => runner.close(),
  };
}
