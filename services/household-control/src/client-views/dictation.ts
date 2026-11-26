import type { IncomingMessage, ServerResponse } from "node:http";
import { isAbsolute } from "node:path";
import { BoundedProcessRunner } from "../domain-runtime/bounded-process.ts";
import { requireCapability, sendJson } from "../http-codec.ts";
import type { RequestContext } from "../server.ts";

export const dictationPath = "/v1/dictation";
export const maximumDictationBytes = 12 * 1024 * 1024;

export function createDictationRoute(options: {
  python?: string;
  model?: string;
  script: string;
  assertCurrent: (context: RequestContext) => void;
}) {
  const runner = new BoundedProcessRunner();
  const { python, model, script } = options;

  async function route(request: IncomingMessage, response: ServerResponse, url: URL, bytes: Buffer, context: RequestContext) {
    if (request.method !== "POST" || url.pathname !== dictationPath) return false;
    if (context.device.kind !== "signed" || context.device.deviceKind !== "personal") {
      sendJson(response, 403, { error: "dictation_device_required" });
      return true;
    }
    if (!requireCapability(response, context, "chat") || !requireCapability(response, context, "voiceInput")) return true;
    options.assertCurrent(context);
    const mimeType = request.headers["content-type"]?.split(";")[0].trim().toLowerCase();
    if (url.search || mimeType !== "audio/mp4" || bytes.length < 12 || bytes.length > maximumDictationBytes ||
      bytes.toString("ascii", 4, 8) !== "ftyp") {
      sendJson(response, 400, { error: "invalid_dictation_audio" });
      return true;
    }
    if (!python || !model || !isAbsolute(python) || !isAbsolute(model)) {
      sendJson(response, 503, { error: "dictation_unavailable" });
      return true;
    }
    const abort = new AbortController();
    const disconnect = () => abort.abort();
    response.once("close", disconnect);
    try {
      const result = await runner.runJson(python, [script, model], {
        input: bytes, timeoutMs: 300_000, maxBytes: 512 * 1024, signal: abort.signal,
        assertCurrent: () => options.assertCurrent(context),
        env: { HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", OMP_NUM_THREADS: "4" },
      }) as { text?: unknown; error?: unknown };
      options.assertCurrent(context);
      if (result.error === "invalid_dictation_audio" || result.error === "dictation_too_long") {
        sendJson(response, 400, { error: result.error });
      } else if (typeof result.text === "string") {
        sendJson(response, 200, { text: result.text });
      } else {
        sendJson(response, 503, { error: "dictation_unavailable" });
      }
    } finally {
      response.off("close", disconnect);
    }
    return true;
  }

  return { route, close: () => runner.close() };
}
