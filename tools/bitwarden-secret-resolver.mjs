#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allowedEnvironment = ["PATH", "LANG", "LC_ALL", "BWS_ACCESS_TOKEN"];
const profileName = "hardy_home";

export function validateAutomationConfig(filename, expectedServer) {
  if (!filename || !path.isAbsolute(filename)) throw new Error("BWS_CONFIG_UNAVAILABLE");
  const stat = lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 16_384 ||
    (process.platform !== "win32" && ((stat.mode & 0o077) !== 0 || ![0, process.getuid()].includes(stat.uid)))) {
    throw new Error("BWS_CONFIG_UNSAFE");
  }
  const content = readFileSync(filename, "utf8");
  const values = Object.create(null);
  let profile = false;
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line === "[profiles." + profileName + "]") {
      if (profile) throw new Error("BWS_CONFIG_INVALID");
      profile = true;
      continue;
    }
    const assignment = /^([a-z_]+)\s*=\s*("(?:[^"\\]|\\.)*")$/.exec(line);
    if (!profile || !assignment || !["state_opt_out", "server_base"].includes(assignment[1]) ||
      Object.hasOwn(values, assignment[1])) throw new Error("BWS_CONFIG_INVALID");
    values[assignment[1]] = JSON.parse(assignment[2]);
  }
  if (!profile || values.state_opt_out !== "true") throw new Error("BWS_STATE_CACHE_FORBIDDEN");
  let server;
  if (values.server_base !== undefined) {
    server = new URL(values.server_base);
    if (server.protocol !== "https:" || server.username || server.password || server.search || server.hash) {
      throw new Error("BWS_CONFIG_INVALID");
    }
  }
  if (expectedServer) {
    const expected = new URL(expectedServer);
    if (!server || expected.href.replace(/\/$/, "") !== server.href.replace(/\/$/, "")) throw new Error("BWS_SERVER_MISMATCH");
  }
  return { filename: realpathSync(filename), profile: profileName };
}

export function resolveRequest(request, environment = process.env, invoke = spawnSync) {
  const values = Object.create(null);
  const errors = Object.create(null);
  const valid = request && request.protocolVersion === 1 && typeof request.provider === "string" &&
    /^[a-z][a-z0-9_-]{0,63}$/.test(request.provider) && Array.isArray(request.ids) &&
    request.ids.length <= 32 && request.ids.every((id) => typeof id === "string" && uuid.test(id));
  if (!valid) return { protocolVersion: 1, values, errors: { request: { code: "INVALID_REQUEST" } } };
  const permitted = new Set((environment.BWS_ALLOWED_SECRET_IDS ?? "").split(",").map((id) => id.trim().toLowerCase()).filter((id) => uuid.test(id)));
  let binary;
  let config;
  try {
    const configured = environment.BWS_BIN;
    if (!configured || !path.isAbsolute(configured) || !environment.BWS_ACCESS_TOKEN) throw new Error();
    const stat = lstatSync(configured);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 ||
      (process.platform !== "win32" && ((stat.mode & 0o022) !== 0 || ![0, process.getuid()].includes(stat.uid)))) throw new Error();
    binary = realpathSync(configured);
    config = validateAutomationConfig(environment.BWS_CONFIG_FILE, environment.BWS_SERVER_URL);
  } catch {
    for (const id of request.ids) errors[id] = { code: "PROVIDER_UNAVAILABLE" };
    return { protocolVersion: 1, values, errors };
  }
  const env = Object.create(null);
  for (const key of allowedEnvironment) if (environment[key]) env[key] = environment[key];
  // Passing --server-url/BWS_SERVER_URL makes bws discard the selected profile,
  // including its state_opt_out setting. The server is configured only in TOML.
  const deadline = Date.now() + 8_000;
  let outputBytes = 0;
  for (const id of new Set(request.ids)) {
    if (!permitted.has(id.toLowerCase())) { errors[id] = { code: "NOT_FOUND" }; continue; }
    const remaining = deadline - Date.now();
    if (remaining < 1) { errors[id] = { code: "PROVIDER_TIMEOUT" }; continue; }
    try {
      const result = invoke(binary, ["--config-file", config.filename, "--profile", config.profile, "--output", "json", "secret", "get", id], {
        env, encoding: "utf8", timeout: Math.min(remaining, 5_000), maxBuffer: 256 * 1024,
        windowsHide: true, shell: false,
      });
      if (result.error || result.status !== 0) throw new Error();
      const item = JSON.parse(result.stdout);
      if (item.id?.toLowerCase() !== id.toLowerCase() || typeof item.value !== "string" || !item.value ||
        Buffer.byteLength(item.value) > 64 * 1024) throw new Error();
      const size = Buffer.byteLength(JSON.stringify(item.value));
      if (outputBytes + size > 512 * 1024) throw new Error();
      outputBytes += size;
      values[id] = item.value;
    } catch { errors[id] = { code: "RESOLUTION_FAILED" }; }
  }
  return { protocolVersion: 1, values, errors };
}

async function main() {
  let bytes = 0;
  const chunks = [];
  try {
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      if (bytes > 16_384) throw new Error();
      chunks.push(chunk);
    }
    const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    process.stdout.write(JSON.stringify(resolveRequest(request)) + "\n");
  } catch {
    process.stdout.write(JSON.stringify({ protocolVersion: 1, values: {}, errors: { request: { code: "INVALID_REQUEST" } } }) + "\n");
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
