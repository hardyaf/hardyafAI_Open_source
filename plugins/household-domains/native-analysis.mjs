import { nativeAnalysisAttachmentPolicy } from "../../services/household-control/src/platform/native-execution.ts";

const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const identity = value => typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\s\x00-\x1f\x7f]/.test(value) ? value : null;
const unavailable = rejectionCode => ({ state: "rejected", childSessionKey: null, runId: null, rejectionCode });

/** Actual native hidden-spawn reads runtime configuration, not the tool factory's private clone. */
export function analysisAttachmentReadiness(config, attachments) {
  if (!Array.isArray(attachments)) return "analysis_attachment_limit_exceeded";
  if (!attachments.length) return null;
  const policy = object(object(object(config).tools).sessions_spawn).attachments;
  if (!policy || policy.enabled !== true) return "analysis_attachments_disabled";
  if (!["maxFiles", "maxTotalBytes", "maxFileBytes"].every(key => Number.isSafeInteger(policy[key]) && policy[key] > 0) || policy.retainOnSessionKeep !== true)
    return "analysis_attachment_policy_unavailable";
  const limits = Object.fromEntries(["maxFiles", "maxTotalBytes", "maxFileBytes"].map(key => [key, Math.min(policy[key], nativeAnalysisAttachmentPolicy[key])]));
  if (attachments.length > limits.maxFiles) return "analysis_attachment_limit_exceeded";
  let total = 0;
  for (const item of attachments) {
    if (!item || typeof item.content !== "string" || item.encoding !== "base64") return "analysis_attachment_limit_exceeded";
    const bytes = Buffer.byteLength(Buffer.from(item.content, "base64"));
    if (bytes > limits.maxFileBytes || (total += bytes) > limits.maxTotalBytes) return "analysis_attachment_limit_exceeded";
  }
  return null;
}

/** Never turn an absent/unrecognized response into permission to spawn again. */
export function normalizeNativeAnalysisAdmission(result) {
  const details = object(object(result).details), childSessionKey = identity(details.childSessionKey), runId = identity(details.runId);
  const uncertain = () => ({ state: "unknown", childSessionKey, runId, rejectionCode: "analysis_native_outcome_unknown" });
  if (details.sentBeforeError === true || details.admissionPending === true) return uncertain();
  if (details.status === "accepted" && childSessionKey && runId && result?.isError !== true && details.error === undefined)
    return { state: "accepted", childSessionKey, runId };
  if (childSessionKey || runId || details.childSessionKey != null || details.runId != null) return uncertain();
  if (details.status === "forbidden") return unavailable(details.error === "attachments are disabled for sessions_spawn (enable tools.sessions_spawn.attachments.enabled)"
    ? "analysis_attachments_disabled" : "analysis_native_forbidden");
  return uncertain();
}

/** Public native SDK adapter. Construct inside the current guarded tool invocation, never at startup. */
export async function spawnNativeAnalysis(context, request, options) {
  context.assertCurrent();
  if (typeof options.toolCallId !== "string" || !options.toolCallId || context.mode === "diagnostic" || request.agentId !== "household-analysis" || request.sandbox !== "require" ||
    request.context !== "isolated" || request.runtime !== "subagent" || request.mode !== "run" || request.completionTarget !== "parent" ||
    request.visible !== false || request.thread !== false || request.expectsCompletionMessage !== true ||
    Object.keys(request).some(key => !["task", "taskName", "label", "agentId", "runtime", "mode", "cleanup", "sandbox", "context", "completionTarget", "visible", "thread", "expectsCompletionMessage", "attachments", "requestArtifactId"].includes(key))) {
    throw Error("analysis_native_request_invalid");
  }
  const {requestArtifactId,...nativeRequest}=request;
  if(typeof requestArtifactId!=="string"||!/^artifact-[a-f0-9]{64}$/.test(requestArtifactId))throw Error("analysis_request_invalid");
  let runtimeConfig;
  try {
    const { getRuntimeConfig } = await import("openclaw/plugin-sdk/runtime-config-snapshot");
    runtimeConfig = getRuntimeConfig();
  } catch { return unavailable("analysis_native_configuration_unavailable"); }
  context.assertCurrent();
  const rejectionCode = analysisAttachmentReadiness(runtimeConfig, request.attachments);
  if (rejectionCode) return unavailable(rejectionCode);
  const { createOpenClawCodingTools } = await import("openclaw/plugin-sdk/agent-harness");
  const execution = context.execution;
  // Construct primitives for child inheritance, but execute ONLY native spawn.
  // This clone supplies no runtime attachment, target, identity or sandbox authority.
  const config = structuredClone(runtimeConfig);
  const requester = config?.agents?.entries?.[execution.agentId];
  if (!requester || !Array.isArray(requester.tools?.allow)) throw Error("analysis_safe_family_policy_required");
  const launcherTools = ["read", "write", "edit", "apply_patch", "exec", "process", "sessions_spawn", "household_analysis_publish_output"];
  requester.tools = { ...requester.tools, profile: "full", allow: launcherTools };
  delete requester.tools.alsoAllow;
  if (Array.isArray(requester.tools.deny)) requester.tools.deny = requester.tools.deny.filter(name => !launcherTools.includes(name));
  const tools = createOpenClawCodingTools({
    config, sessionConfigSource: "pinned", agentId: execution.agentId, sessionKey: execution.sessionKey, runSessionKey: execution.sessionKey,
    sessionId: execution.sessionId, runId: execution.runId, workspaceDir: options.workspaceDir,
    modelProvider: options.modelProvider, modelId: options.modelId,
    toolConstructionPlan: { includeBaseCodingTools: true, includeShellTools: true, includeChannelTools: false, includeOpenClawTools: true, includePluginTools: true },
    inheritRuntimeToolAllowlist: false,
    wrapBeforeToolCallHook: false, disableMessageTool: true,
  });
  const required = ["read", "write", "exec", "process", "sessions_spawn", "household_analysis_publish_output"];
  if (required.some(name => !tools.some(tool => tool.name === name))) throw Error("analysis_launcher_capabilities_unavailable");
  const tool = tools.find(value => value.name === "sessions_spawn");
  if (!tool) throw Error("analysis_native_spawn_unavailable");
  context.assertCurrent();
  let result;
  try { result = await tool.execute(options.toolCallId, nativeRequest, options.signal); }
  catch { result = undefined; } // Native may already have admitted work; do not disclose raw errors or retry it.
  context.assertCurrent();
  return normalizeNativeAnalysisAdmission(result);
}
