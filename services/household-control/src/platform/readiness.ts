import { constants } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { validateAutomationConfig } from "../../../../tools/bitwarden-secret-resolver.mjs";

export type DependencyReadiness = { status: "ready" | "not_configured" | "unavailable"; detail: string };
async function executable(filename: string | undefined): Promise<boolean> {
  if (!filename || !path.isAbsolute(filename)) return false;
  try {
    const resolved = await realpath(filename);
    const stat = await lstat(resolved);
    if (!stat.isFile()) return false;
    await access(resolved, constants.X_OK);
    return true;
  } catch { return false; }
}

export async function inspectPlatformDependencies(options: {
  pythonPath?: string;
  documentReaderPath?: string;
  bitwardenPath?: string;
  bitwardenBootstrapPresent?: boolean;
  bitwardenConfigPath?: string;
  bitwardenServerUrl?: string;
}) {
  const [python, documents, bitwarden] = await Promise.all([
    executable(options.pythonPath), executable(options.documentReaderPath), executable(options.bitwardenPath),
  ]);
  let automationConfig = false;
  try { validateAutomationConfig(options.bitwardenConfigPath, options.bitwardenServerUrl); automationConfig = true; } catch { /* no secrets are read */ }
  return {
    analysisPython: { status: python ? "ready" : options.pythonPath ? "unavailable" : "not_configured", detail: "Executable readiness only; sandbox image libraries are checked during deployment." },
    localDocuments: { status: documents ? "ready" : options.documentReaderPath ? "unavailable" : "not_configured", detail: "Existing local reader; source quality and card-image support are not certified." },
    bitwarden: {
      status: bitwarden && options.bitwardenBootstrapPresent && automationConfig ? "ready" : !options.bitwardenPath || !options.bitwardenBootstrapPresent || !options.bitwardenConfigPath ? "not_configured" : "unavailable",
      detail: "Binary/bootstrap and dedicated non-caching configuration readiness only; no credential has been resolved by this health check.",
    },
  } satisfies Record<string, DependencyReadiness>;
}
