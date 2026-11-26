import { createServer, request as httpRequest } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { isIP } from "node:net";
import { HouseholdDatabase } from "../database.ts";
import { DeviceAuthenticator } from "../device-auth.ts";
import { createSecureListener } from "../platform/secure-listener.ts";
import { createHomeAssetRoutes } from "../client-views/static.ts";
import { sendJson } from "../http-codec.ts";
import { ConnectionRepository } from "./repository.ts";
import { ConnectionsService } from "./service.ts";
import { ConnectionsError } from "./contracts.ts";
import { loadDomainConfiguration } from "../domain-runtime/configuration.ts";
import { createNativeCredentialConsumer, listenNativeCredentialConsumer } from "./native-consumer.ts";
import { BitwardenConnectionsVault } from "./vault.ts";
import { createGoogleProvider } from "./google.ts";
import { createConnectionsRoutes } from "./routes.ts";

const maximumCredentialBytes = 96 * 1024;
const auditScript = "/opt/hardy-home-credentials/source/deploy/hardybot/credential-audit.py";

export function credentialIsolationReady(): boolean {
  try {
    const result = spawnSync("/usr/bin/python3", ["-I", auditScript], {
      env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
      encoding: "utf8", timeout: 5000, maxBuffer: 16384, shell: false,
    });
    return !result.error && result.status === 0 && JSON.parse(result.stdout).ready === true;
  } catch { return false; }
}

async function credentialBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maximumCredentialBytes) throw new Error("credential_request_too_large");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

/** Ordinary traffic stays in the current control service. Secret requests never enter it. */
export function proxyControl(request: IncomingMessage, response: ServerResponse, controlUrl: URL): void {
  const upstream = httpRequest({
    hostname: controlUrl.hostname, port: controlUrl.port, method: request.method,
    path: request.url, headers: { ...request.headers, host: controlUrl.host },
    timeout: 360000,
  }, incoming => {
    response.writeHead(incoming.statusCode ?? 502, incoming.headers);
    incoming.pipe(response);
  });
  upstream.on("error", () => {
    if (!response.headersSent) sendJson(response, 502, { error: "control_service_unavailable" });
    else response.destroy();
  });
  upstream.on("timeout", () => upstream.destroy());
  response.on("close", () => upstream.destroy());
  request.pipe(upstream);
}

export function createCredentialIngress(options: {
  database: HouseholdDatabase;
  service: ConnectionsService;
  controlUrl: URL;
  homeRoot: string;
  publicOrigin: string;
}) {
  const controlHost = options.controlUrl.hostname;
  const octets = controlHost.split(".").map(Number);
  const privateHost = controlHost === "127.0.0.1" || isIP(controlHost) === 4 &&
    (octets[0] === 10 || octets[0] === 192 && octets[1] === 168 ||
     octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31);
  if (options.controlUrl.protocol !== "http:" || !privateHost ||
      options.controlUrl.username || options.controlUrl.password || options.controlUrl.pathname !== "/" ||
      options.controlUrl.search || options.controlUrl.hash)
    throw new Error("credential_control_origin_invalid");
  const publicOrigin = new URL(options.publicOrigin);
  if (publicOrigin.protocol !== "https:" || publicOrigin.origin !== options.publicOrigin)
    throw new Error("credential_public_origin_invalid");
  const authenticator = new DeviceAuthenticator({ database: options.database });
  const homeAssets = createHomeAssetRoutes({ root: options.homeRoot });
  const assertCurrent = (context: { profile: { id: string }; device: { deviceId: string; kind: string } }) => {
    const device = options.database.getDevice(context.device.deviceId);
    const profile = options.database.getProfile(context.profile.id);
    if (context.device.kind !== "signed" || !device || device.status !== "active" ||
        device.deviceKind !== "personal" || device.profileId !== context.profile.id ||
        profile?.role !== "admin" || !profile.capabilities.includes("manageAccess"))
      throw Object.assign(new Error("connection_owner_required"), { statusCode: 403 });
  };
  const connections = createConnectionsRoutes({ service: options.service, assertCurrent });
  const server = createServer({ requestTimeout: 60000, headersTimeout: 15000 }, async (request, response) => {
    let bytes: Buffer | undefined;
    try {
      const url = new URL(request.url ?? "/", options.publicOrigin);
      if (url.pathname === "/v1/connections" || url.pathname.startsWith("/v1/connections/")) {
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Referrer-Policy", "no-referrer");
        if (!(request.socket as { encrypted?: boolean }).encrypted) {
          sendJson(response, 426, { error: "credential_https_required" }); return;
        }
        if (connections.publicRoute && await connections.publicRoute(request, response, url)) return;
        bytes = await credentialBody(request);
        const device = authenticator.authenticate(request, url.pathname + url.search, bytes);
        const profile = device ? options.database.getProfile(device.profileId) : undefined;
        if (!device || !profile) { sendJson(response, 401, { error: "device_not_enrolled" }); return; }
        const context = { profile, device };
        assertCurrent(context);
        if (await connections.route(request, response, url, bytes, context)) return;
        sendJson(response, 404, { error: "connection_route_not_found" });
        return;
      }
      if (await homeAssets(request, response, url)) return;
      proxyControl(request, response, options.controlUrl);
    } catch (error) {
      const known = error instanceof ConnectionsError && /^[a-z][a-z0-9_]{0,79}$/.test(error.code);
      const code = known ? error.code : error instanceof Error && error.message === "credential_request_too_large"
        ? "credential_request_too_large" : "connection_request_failed";
      const status = known && [400,403,404,409,503].includes(error.statusCode) ? error.statusCode
        : code === "credential_request_too_large" ? 413
        : (error as {statusCode?: number}).statusCode === 403 ? 403 : 500;
      if (!response.headersSent) sendJson(response, status, { error: code });
      else response.end();
    } finally { bytes?.fill(0); }
  });
  return Object.assign(server, { closeConnections: () => connections.close() });
}

async function main() {
  const databasePath = process.env.HARDY_CREDENTIALS_DATABASE;
  const stateRoot = process.env.HARDY_CREDENTIALS_STATE_DIR;
  const certificate = process.env.TLS_CERTIFICATE;
  const privateKey = process.env.TLS_PRIVATE_KEY;
  const pythonPath = process.env.HARDY_CREDENTIALS_PYTHON;
  const scriptPath = process.env.HARDY_CREDENTIALS_VAULT_SCRIPT;
  if (!databasePath || !stateRoot || !certificate || !privateKey || !pythonPath || !scriptPath)
    throw new Error("credential_service_configuration_required");
  const database = new HouseholdDatabase(databasePath);
  const vault = new BitwardenConnectionsVault({ stateRoot, pythonPath, scriptPath });
  const service = new ConnectionsService({ store: new ConnectionRepository(database.domainConnection()),
    vault, google: await createGoogleProvider(), securityReady: credentialIsolationReady });
  const application = createCredentialIngress({ database, service,
    controlUrl: new URL(process.env.HARDY_CREDENTIALS_CONTROL_URL ?? "http://127.0.0.1:4317"),
    homeRoot: resolve(process.env.HARDY_CREDENTIALS_HOME_ROOT ?? "../../apps/hardy-home-web/dist"),
    publicOrigin: process.env.HARDY_CREDENTIALS_PUBLIC_ORIGIN ?? (() => { throw new Error("credential_public_origin_required"); })(),
  });
  const socketPath = process.env.HARDY_CREDENTIALS_CONSUMER_SOCKET;
  const domainConfigPath = process.env.HARDY_CREDENTIALS_DOMAIN_CONFIG;
  if (!socketPath || !domainConfigPath) throw new Error("credential_consumer_configuration_required");
  const consumer = createNativeCredentialConsumer({ database, service, configuration: await loadDomainConfiguration(domainConfigPath) });
  await listenNativeCredentialConsumer(consumer, socketPath);
  const secure = await createSecureListener(application, { certificate, privateKey });
  secure.listen(Number(process.env.PORT ?? "8443"), process.env.BIND_ADDRESS ?? "0.0.0.0",
    () => process.stdout.write("Hardy Home protected connections listener ready\n"));
  const shutdown = () => {
    application.closeConnections();
    consumer.close();
    secure.close(() => { database.close(); process.exit(0); });
    secure.closeIdleConnections();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(() => { process.stderr.write("credential_service_start_failed\n"); process.exitCode = 1; });
