import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { PlatformError } from "./errors.ts";

export type WorkshopConfiguration = { ownerProfileId: string; image: string; sandboxRoot: string; dataRoot: string };
export const workshopTools = ["read", "write", "edit", "apply_patch", "exec", "process", "browser"];
export const workshopSystemDirectories = ["usr", "etc", "var", "opt", "tmp", "root"];

/** Native execution owns the environment. These are lab copies, never host system mounts. */
export function buildWorkshopProfile(configuration: WorkshopConfiguration) {
  const { image, sandboxRoot, dataRoot } = configuration;
  if (![sandboxRoot, dataRoot].every(path.isAbsolute) || !image) throw new PlatformError("workshop_configuration_invalid", 500);
  return {
    sandbox: {
      mode: "all", backend: "docker", scope: "agent", workspaceAccess: "none", workspaceRoot: sandboxRoot,
      prune: { idleHours: 0, maxAgeDays: 0 },
      docker: {
        image, readOnlyRoot: false, network: "bridge", user: "0:0", capDrop: [], tmpfs: ["/dev/shm:rw,size=100%,mode=1777"],
        gpus: "driver=cdi,device=nvidia.com/gpu=all",
        dangerouslyAllowReservedContainerTargets: true, dangerouslyAllowExternalBindSources: true,
        binds: [
          ...workshopSystemDirectories.map(name => `${dataRoot}/system/${name}:/${name}:rw`),
          `${dataRoot}/reference:/reference:ro`,
        ],
        env: { HOME: "/workspace", PYTHONUNBUFFERED: "1", HARDY_WORKSHOP: "1" },
      },
      browser: { enabled: true, image: "hardy-home-workshop-browser:20260908", network: "bridge", binds: [], allowHostControl: false, headless: true },
    },
    tools: {
      fs: { workspaceOnly: false }, exec: { host: "sandbox", mode: "full", strictInlineEval: false, pathPrepend: [], applyPatch: { enabled: true, workspaceOnly: false } },
      elevated: { enabled: false }, sandbox: { tools: { allow: ["*"] } },
    },
  };
}

/** Validate credential/host separation, not the agent's choice of experiments. */
export function assertWorkshopProfile(configuration: WorkshopConfiguration, agentId: string, config: any): void {
  const agent = config?.agents?.entries?.[agentId], expected = buildWorkshopProfile(configuration);
  const inherited = config?.agents?.defaults?.sandbox?.docker ?? {};
  const docker = agent?.sandbox?.docker, tools = agent?.tools;
  const bad = () => { throw new PlatformError("workshop_environment_unavailable", 503); };
  if (!agent || agent.sandbox.mode !== "all" || agent.sandbox.backend !== "docker" ||
    agent.sandbox.scope !== "agent" || agent.sandbox.workspaceRoot !== configuration.sandboxRoot ||
    agent.sandbox.workspaceAccess !== "none" || tools?.exec?.host !== "sandbox" || tools?.exec?.mode !== "full" ||
    tools?.elevated?.enabled !== false || tools?.fs?.workspaceOnly !== false ||
    agent.sandbox.browser?.allowHostControl !== false) bad();
  if (!isDeepStrictEqual(docker, expected.sandbox.docker)) bad();
  // Native resolution inherits omitted quotas; do not accidentally keep the former global limits.
  if (["memory", "memorySwap", "cpus", "pidsLimit", "binds", "env", "setupCommand"].some(key =>
    inherited[key] !== undefined && !(Array.isArray(inherited[key]) && !inherited[key].length))) bad();
  const primary = agent.model ?? config.agents.defaults.model;
  if (!(typeof primary === "string" ? primary : primary?.primary)?.startsWith("ollama/") || primary?.fallbacks?.length) bad();
}
