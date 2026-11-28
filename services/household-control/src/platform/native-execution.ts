import { assertWorkshopProfile } from "./workshop-profile.ts";
import type { WorkshopConfiguration } from "./workshop-profile.ts";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { PlatformError, platformErrorCode } from "./errors.ts";
import { ArtifactStore } from "./artifacts.ts";
import type { ArtifactPrincipal, ArtifactScope } from "./artifacts.ts";

/** Supported native input projection; typed admission still owns artifact authority. */
export const nativeAnalysisAttachmentPolicy = Object.freeze({ enabled: true, maxFiles: 32,
  maxTotalBytes: 16 * 1024 * 1024, maxFileBytes: 16 * 1024 * 1024, retainOnSessionKeep: true });

export const nativeAnalysisToolAllowlist = Object.freeze([
  "read", "write", "edit", "apply_patch", "exec", "process", "household_analysis_publish_output",
]);

export const nativeHelperAgents = {
  analysis: "household-analysis",
  diagnostic: "household-diagnostics",
} as const;
export type NativeExecutionKind = keyof typeof nativeHelperAgents;
export type NativeAttachment = { type: "file"; mimeType: string; fileName: string; content: string; sizeBytes: number };
export type NativeAdmission = { sessionKey: string; runId: string | null; status: "running" | "queued" };
export interface RestrictedNativeAdapter {
  createRestrictedSession(args: { sessionKey: string; agentId: string; permissionMode: "workspace" | "read-only" }): Promise<unknown>;
  submitRestricted(args: { sessionKey: string; agentId: string; message: string; submissionId: string; attachments?: NativeAttachment[] }): Promise<NativeAdmission>;
}
type Json = Record<string, unknown>;
function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}
function invalid(): never { throw new PlatformError("restricted_runtime_unavailable", 503); }

export function buildNativeExecutionProfiles(options: {
  analysisWorkspace: string;
  diagnosticWorkspace: string;
  image: string;
  sandboxUser: string;
}) {
  if (![options.analysisWorkspace, options.diagnosticWorkspace].every(path.isAbsolute) ||
    !/^[0-9]+:[0-9]+$/.test(options.sandboxUser) || !options.image) throw new PlatformError("native_profile_options_invalid", 500);
  const sandbox = () => ({
    mode: "all", backend: "docker", scope: "session", workspaceAccess: "none",
    docker: {
      image: options.image, readOnlyRoot: true, network: "none", user: options.sandboxUser,
      capDrop: ["ALL"], binds: [], tmpfs: ["/tmp", "/var/tmp", "/run"],
      memory: "512m", memorySwap: "512m", cpus: 1, pidsLimit: 64,
      env: { PYTHONDONTWRITEBYTECODE: "1", PYTHONUNBUFFERED: "1", MPLCONFIGDIR: "/tmp/matplotlib", HOME: "/tmp" },
    },
  });
  return {
    [nativeHelperAgents.analysis]: {
      name: nativeHelperAgents.analysis, workspace: options.analysisWorkspace, sandbox: sandbox(),
      tools: {
        allow: [...nativeAnalysisToolAllowlist],
        sandbox: { tools: { allow: [...nativeAnalysisToolAllowlist] } },
        deny: ["browser", "web_search", "web_fetch", "sessions_spawn", "sessions_send", "gateway", "cron", "message", "nodes", "computer"],
        fs: { workspaceOnly: true }, exec: { host: "sandbox", timeoutSeconds: 30, pathPrepend: [] },
        elevated: { enabled: false },
      },
    },
    [nativeHelperAgents.diagnostic]: {
      name: nativeHelperAgents.diagnostic, workspace: options.diagnosticWorkspace, sandbox: sandbox(),
      tools: {
        allow: ["read"],
        deny: ["write", "edit", "apply_patch", "exec", "process", "sessions_spawn", "sessions_send", "gateway", "cron", "message", "nodes", "computer", "browser"],
        fs: { workspaceOnly: true }, elevated: { enabled: false },
      },
    },
  };
}

export class NativeExecutionPolicies {
  private readonly configPath: string;
  private readonly expectedImage: string;

  private readonly workshop?: WorkshopConfiguration;

  constructor(options: { configPath: string; image: string; workshop?: WorkshopConfiguration }) {
    if (!path.isAbsolute(options.configPath) || !options.image) throw new PlatformError("native_profile_options_invalid", 500);
    this.configPath = options.configPath;
    this.expectedImage = options.image;
    this.workshop = options.workshop;
  }

  async assertReady(agentId: string): Promise<void> {
    try {
      const info = await lstat(this.configPath);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) invalid();
      this.assertProfile(agentId, JSON.parse(await readFile(this.configPath, "utf8")));
    } catch (error) {
      if (error instanceof PlatformError) throw error;
      invalid();
    }
  }

  /** The live native config and the protected on-disk profile share the same requirements. */
  assertProfile(agentId: string, configuration: unknown): void {
    if (agentId === "main" && this.workshop) { assertWorkshopProfile(this.workshop, agentId, configuration); return; }
    if (!new Set<string>(Object.values(nativeHelperAgents)).has(agentId)) invalid();
    const config = record(configuration);
    const agents = record(config.agents);
    const entries = record(agents.entries);
    const agent = record(entries[agentId]);
    const sandbox = record(agent.sandbox);
    const docker = record(sandbox.docker);
    const tools = record(agent.tools);
    const inheritedDocker = record(record(record(agents.defaults).sandbox).docker);
    const inheritedBinds = inheritedDocker.binds;
    if (Array.isArray(inheritedBinds) && inheritedBinds.length) invalid();
    const inheritedEnv = record(inheritedDocker.env);
    if (Object.keys(inheritedEnv).some((key) => !["LANG", "LC_ALL", "HOME", "PYTHONDONTWRITEBYTECODE", "PYTHONUNBUFFERED", "MPLCONFIGDIR"].includes(key))) invalid();
    const allow = tools.allow;
    const safe = agentId === nativeHelperAgents.analysis
      ? new Set(nativeAnalysisToolAllowlist)
      : new Set(["read"]);
    if (!Object.keys(agent).length || sandbox.mode !== "all" || sandbox.scope !== "session" ||
      sandbox.workspaceAccess !== "none" || (sandbox.backend ?? "docker") !== "docker" ||
      docker.image !== this.expectedImage || docker.readOnlyRoot !== true || docker.network !== "none" ||
      typeof docker.user !== "string" || !/^[1-9][0-9]*:[1-9][0-9]*$/.test(docker.user) ||
      !Array.isArray(docker.capDrop) || !docker.capDrop.includes("ALL") || docker.setupCommand !== undefined ||
      !Array.isArray(docker.binds) || docker.binds.length !== 0 ||
      !Array.isArray(allow) || allow.length === 0 || allow.some((name) => typeof name !== "string" || !safe.has(name)) ||
      tools.alsoAllow !== undefined || record(tools.fs).workspaceOnly !== true ||
      record(tools.elevated).enabled !== false) invalid();
    if (agentId === nativeHelperAgents.analysis) {
      // OpenClaw independently intersects the agent tool set with sandbox policy.
      const sandboxTools = record(record(tools.sandbox).tools);
      const sandboxAllow = sandboxTools.allow;
      if (record(tools.exec).host !== "sandbox" || !allow.includes("household_analysis_publish_output") ||
        !Array.isArray(sandboxAllow) || sandboxAllow.length !== nativeAnalysisToolAllowlist.length ||
        !nativeAnalysisToolAllowlist.every(name => sandboxAllow.includes(name)) || sandboxTools.alsoAllow !== undefined) invalid();
    }
    const env = record(docker.env);
    if (Object.keys(env).some((key) => !["LANG", "LC_ALL", "HOME", "PYTHONDONTWRITEBYTECODE", "PYTHONUNBUFFERED", "MPLCONFIGDIR"].includes(key))) invalid();
    const primary = agent.model ?? record(agents.defaults).model;
    const model = typeof primary === "string" ? primary : record(primary).primary;
    if (typeof model !== "string" || !model.startsWith("ollama/")) invalid();
    if (Array.isArray(record(primary).fallbacks) && (record(primary).fallbacks as unknown[]).length) invalid();
  }

  async readiness() {
    const result: Record<string, { status: string; detail: string }> = {};
    for (const agentId of [...Object.values(nativeHelperAgents), ...(this.workshop ? ["main"] : [])]) {
      try {
        await this.assertReady(agentId);
        result[agentId] = { status: "configured", detail: agentId === "main" ? "Persistent native workshop configured; this configuration check does not execute a task." : "Restricted native profile validated; no agent task has been executed by this check." };
      } catch (error) {
        result[agentId] = { status: "unavailable", detail: platformErrorCode(error) };
      }
    }
    return result;
  }
}

export type NativeAdmissionCheck = (request: {
  ownerProfileId: string; conversationId: string; taskId: string;
  kind: NativeExecutionKind; submissionId: string; requestFingerprint: string;
}) => Promise<void>;

export class NativeExecutionCoordinator {
  private readonly adapter: RestrictedNativeAdapter;
  private readonly policies: NativeExecutionPolicies;
  private readonly artifacts: ArtifactStore;
  private readonly admissionCheck?: NativeAdmissionCheck;

  constructor(adapter: RestrictedNativeAdapter, policies: NativeExecutionPolicies, artifacts: ArtifactStore, admissionCheck?: NativeAdmissionCheck) {
    this.adapter = adapter;
    this.policies = policies;
    this.artifacts = artifacts;
    this.admissionCheck = admissionCheck;
  }

  async submit(args: {
    kind: NativeExecutionKind;
    scope: ArtifactScope;
    principal: ArtifactPrincipal;
    submissionId: string;
    goal: string;
    inputArtifactIds?: string[];
  }) {
    if (!Object.hasOwn(nativeHelperAgents, args.kind) || args.scope.ownerProfileId !== args.principal.profileId ||
      ![args.scope.ownerProfileId, args.scope.conversationId, args.scope.taskId].every((value) => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)) ||
      !["private", "household"].includes(args.scope.audience) ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/.test(args.submissionId) ||
      typeof args.goal !== "string" || !args.goal.trim() || Buffer.byteLength(args.goal) > 32_768 ||
      (args.inputArtifactIds !== undefined && (!Array.isArray(args.inputArtifactIds) || args.inputArtifactIds.length > 8))) throw new PlatformError("native_execution_request_invalid", 400);
    if (!this.admissionCheck) throw new PlatformError("native_admission_required", 503);
    const agentId = nativeHelperAgents[args.kind];
    await this.policies.assertReady(agentId);
    const requestFingerprint = createHash("sha256").update(JSON.stringify([args.kind, args.goal, args.inputArtifactIds ?? []])).digest("hex");
    const admissionRequest = { ownerProfileId: args.scope.ownerProfileId, conversationId: args.scope.conversationId, taskId: args.scope.taskId, kind: args.kind, submissionId: args.submissionId, requestFingerprint };
    const attachments: NativeAttachment[] = [];
    let bytes = 0;
    for (const [index, id] of (args.inputArtifactIds ?? []).entries()) {
      const artifact = await this.artifacts.read(id, args.principal);
      if (artifact.metadata.ownerProfileId !== args.scope.ownerProfileId || artifact.metadata.conversationId !== args.scope.conversationId ||
        artifact.metadata.taskId !== args.scope.taskId || artifact.metadata.audience !== args.scope.audience) {
        throw new PlatformError("execution_attachment_scope_mismatch", 403);
      }
      if (!["text/plain", "application/json", "text/csv", "text/x-python"].includes(artifact.metadata.mimeType)) {
        throw new PlatformError("execution_attachment_unsupported", 415);
      }
      bytes += artifact.bytes.length;
      if (bytes > 512 * 1024) throw new PlatformError("execution_attachments_too_large", 413);
      const extension = artifact.metadata.mimeType === "application/json" ? ".json" : artifact.metadata.mimeType === "text/x-python" ? ".py" : ".txt";
      attachments.push({
        type: "file", mimeType: artifact.metadata.mimeType === "text/csv" ? "text/plain" : artifact.metadata.mimeType,
        fileName: "input-" + index + extension, content: artifact.bytes.toString("base64"), sizeBytes: artifact.bytes.length,
      });
    }
    const identity = JSON.stringify([args.kind, args.scope.ownerProfileId, args.scope.conversationId, args.scope.taskId, args.submissionId]);
    const key = createHash("sha256").update(identity).digest("hex").slice(0, 40);
    const sessionKey = "hardy-home:restricted:" + args.kind + ":" + key;
    await this.admissionCheck(admissionRequest);
    await this.adapter.createRestrictedSession({
      sessionKey, agentId, permissionMode: args.kind === "diagnostic" ? "read-only" : "workspace",
    });
    const context = args.kind === "diagnostic"
      ? "Analyze only the provided sanitized evidence. This entire native session is read-only. Report observations, hypotheses and a proposed fix. Do not apply or delegate repairs."
      : "Use only the native sandbox and attached task inputs. Write short Python programs and inspect their results as needed. Save useful outputs inside the session workspace. No network or host credentials are available.";
    await this.admissionCheck(admissionRequest);
    const admission = await this.adapter.submitRestricted({
      sessionKey, agentId, submissionId: args.submissionId,
      message: context + "\nTask reference: " + args.scope.taskId + "\nUser goal:\n" + args.goal,
      ...(attachments.length ? { attachments } : {}),
    });
    return { ...admission, agentId, kind: args.kind, taskId: args.scope.taskId, inputArtifactIds: args.inputArtifactIds ?? [] };
  }
}
