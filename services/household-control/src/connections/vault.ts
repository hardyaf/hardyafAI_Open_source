import { spawnSync } from "node:child_process";
import { constants, lstatSync, realpathSync } from "node:fs";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { ConnectionsError } from "./contracts.ts";
import type { ConnectionVault, VaultReceipt } from "./contracts.ts";

type Bootstrap = { accessToken: string; organizationId: string; projectId: string };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const same = (left: string, right: string) => { const a = Buffer.from(left), b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); };

/** Owns only the unavoidable protected bootstrap. Provider secrets remain in Bitwarden. */
export class BitwardenConnectionsVault implements ConnectionVault {
  #root: string; #python: string; #script: string; #api: string; #identity: string; #busy = false;
  constructor(options: { stateRoot: string; pythonPath: string; scriptPath: string; apiUrl?: string; identityUrl?: string }) {
    for (const value of [options.stateRoot, options.pythonPath, options.scriptPath]) if (!path.isAbsolute(value)) throw new ConnectionsError("credential_configuration_unavailable");
    this.#root = options.stateRoot; this.#python = options.pythonPath; this.#script = options.scriptPath;
    this.#api = options.apiUrl ?? "https://api.bitwarden.com"; this.#identity = options.identityUrl ?? "https://identity.bitwarden.com";
    for (const value of [this.#api, this.#identity]) {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new ConnectionsError("credential_configuration_unavailable");
    }
  }
  async #prepare() {
    await mkdir(this.#root, { recursive: true, mode: 0o700 });
    const stat = lstatSync(this.#root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(this.#root) !== this.#root ||
      (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) throw new ConnectionsError("credential_state_unsafe");
  }
  async #load(): Promise<Bootstrap | undefined> {
    await this.#prepare();
    const filename = path.join(this.#root, "bootstrap.json");
    const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW).catch(error => {
      if (error.code === "ENOENT") return undefined;
      throw new ConnectionsError("credential_state_unsafe");
    });
    if (!handle) return undefined;
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.() || stat.size > 16384)
        throw new ConnectionsError("credential_state_unsafe");
      const value = JSON.parse(await handle.readFile("utf8"));
      if (!value || typeof value.accessToken !== "string" || !value.accessToken || !uuid.test(value.organizationId) || !uuid.test(value.projectId))
        throw new ConnectionsError("credential_state_unsafe");
      return value;
    } catch { throw new ConnectionsError("credential_state_unsafe"); } finally { await handle.close(); }
  }
  #execute(configuration: Bootstrap, request: Record<string, unknown>): Record<string, unknown> {
    for (const filename of [this.#python, this.#script]) {
      const target = lstatSync(realpathSync(filename));
      if (!target.isFile() || (target.mode & 0o022) !== 0 || ![0, process.getuid?.()].includes(target.uid))
        throw new ConnectionsError("credential_helper_unsafe");
    }
    const result = spawnSync(this.#python, ["-I", this.#script], {
      env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", BWS_ACCESS_TOKEN: configuration.accessToken, BWS_SDK_API_URL: this.#api, BWS_SDK_IDENTITY_URL: this.#identity },
      input: JSON.stringify({ ...request, organizationId: configuration.organizationId, projectId: configuration.projectId }),
      encoding: "utf8", timeout: 15_000, maxBuffer: 128 * 1024, shell: false, windowsHide: true,
    });
    let value: Record<string, unknown>;
    try { value = JSON.parse(result.stdout ?? ""); } catch { throw new ConnectionsError("credential_vault_outcome_unknown", 503, "unknown"); }
    if (result.error || result.status !== 0 || !["ready", "committed", "read"].includes(String(value.status))) {
      if (value.status === "conflict") throw new ConnectionsError("connection_operation_conflict", 409);
      throw new ConnectionsError(value.status === "unknown" ? "credential_vault_outcome_unknown" : "credential_vault_unavailable", 503,
        value.status === "unknown" || result.error ? "unknown" : "not_sent");
    }
    return value;
  }
  async configured() { return !!await this.#load(); }
  async bootstrap(input: Bootstrap) {
    if (!uuid.test(input.organizationId) || !uuid.test(input.projectId)) throw new ConnectionsError("invalid_bitwarden_project", 400);
    if (this.#busy) throw new ConnectionsError("connection_operation_in_progress", 409);
    this.#busy = true;
    try {
      const prior = await this.#load();
      if (prior) {
        if (!same(JSON.stringify(prior), JSON.stringify(input))) throw new ConnectionsError("bitwarden_bootstrap_already_configured", 409);
        return;
      }
      this.#execute(input, { action: "probe" });
      const filename = path.join(this.#root, "bootstrap.json"), temporary = filename + "." + randomBytes(12).toString("hex");
      const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(JSON.stringify(input)); await handle.sync(); } finally { await handle.close(); }
      try { await rename(temporary, filename); } finally { await unlink(temporary).catch(() => {}); }
      const directory = await open(this.#root, constants.O_RDONLY);
      try { await directory.sync(); } finally { await directory.close(); }
    } finally { this.#busy = false; }
  }
  async put(key: string, value: string, allowCreate: boolean): Promise<VaultReceipt> {
    if (!/^connection-[a-f0-9]{32}$/.test(key) || Buffer.byteLength(value) > 65536) throw new ConnectionsError("invalid_connection_request", 400);
    const configuration = await this.#load();
    if (!configuration) throw new ConnectionsError("bitwarden_not_configured", 409);
    const receipt = this.#execute(configuration, { action: "put", key, value, allowCreate });
    if (typeof receipt.secretId !== "string" || !uuid.test(receipt.secretId) || typeof receipt.revision !== "string")
      throw new ConnectionsError("credential_vault_outcome_unknown", 503, "unknown");
    return { secretId: receipt.secretId, revision: receipt.revision };
  }
  async replace(secretId: string, previous: string, value: string): Promise<VaultReceipt> {
    if (!uuid.test(secretId) || !previous || !value || Buffer.byteLength(value) > 65536 || Buffer.byteLength(previous) > 65536)
      throw new ConnectionsError("invalid_connection_request", 400);
    const configuration = await this.#load();
    if (!configuration) throw new ConnectionsError("bitwarden_not_configured", 409);
    const receipt = this.#execute(configuration, { action: "replace", secretId, expectedValue: previous, value });
    if (receipt.secretId !== secretId || typeof receipt.revision !== "string") throw new ConnectionsError("credential_vault_outcome_unknown", 503, "unknown");
    return {secretId, revision: receipt.revision};
  }
  async read(secretId: string): Promise<string> {
    if (!uuid.test(secretId)) throw new ConnectionsError("invalid_connection_request", 400);
    const configuration = await this.#load();
    if (!configuration) throw new ConnectionsError("bitwarden_not_configured", 409);
    const result = this.#execute(configuration, { action: "read", secretId });
    if (typeof result.value !== "string" || !result.value) throw new ConnectionsError("credential_vault_unavailable");
    return result.value;
  }
}
