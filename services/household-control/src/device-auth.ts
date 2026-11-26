import { createHash, createPublicKey, verify } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { HouseholdDatabase } from "./database.ts";

export const deviceAuthWindowMs = 5 * 60_000;

export function canonicalDeviceRequest(args: {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  body: Buffer;
}): string {
  const bodyHash = createHash("sha256").update(args.body).digest("hex");
  return [args.method.toUpperCase(), args.path, args.timestamp, args.nonce, bodyHash].join("\n");
}

export type AuthenticatedDevice = {
  deviceId: string;
  profileId: string;
  kind: "signed" | "development";
  deviceKind?: "personal" | "display";
};

export class DeviceAuthenticator {
  private readonly database: HouseholdDatabase | null;
  private readonly developmentDevices: Map<string, string> | null;

  constructor(options: {
    database?: HouseholdDatabase;
    developmentDevices?: Map<string, string>;
  }) {
    this.database = options.database ?? null;
    this.developmentDevices = options.developmentDevices ?? null;
  }

  authenticate(request: IncomingMessage, path: string, body: Buffer): AuthenticatedDevice | undefined {
    const developmentId = request.headers["x-device-id"];
    if (this.developmentDevices && typeof developmentId === "string") {
      const profileId = this.developmentDevices.get(developmentId);
      return profileId ? { deviceId: developmentId, profileId, kind: "development" } : undefined;
    }

    if (!this.database) return undefined;
    const deviceId = request.headers["x-hardy-device-id"];
    const timestamp = request.headers["x-hardy-timestamp"];
    const nonce = request.headers["x-hardy-nonce"];
    const signature = request.headers["x-hardy-signature"];
    if (
      typeof deviceId !== "string" ||
      typeof timestamp !== "string" ||
      typeof nonce !== "string" ||
      typeof signature !== "string"
    ) return undefined;

    if (!/^[0-9]{13}$/.test(timestamp) || nonce.length < 16 || nonce.length > 128) return undefined;
    const signedAt = Number(timestamp);
    if (!Number.isSafeInteger(signedAt) || Math.abs(Date.now() - signedAt) > deviceAuthWindowMs) return undefined;

    const device = this.database.getDevice(deviceId);
    if (!device || device.status !== "active") return undefined;
    try {
      const publicKey = createPublicKey({
        key: Buffer.from(device.publicKeyDerBase64, "base64"),
        format: "der",
        type: "spki",
      });
      const canonical = canonicalDeviceRequest({
        method: request.method ?? "GET",
        path,
        timestamp,
        nonce,
        body,
      });
      const valid = verify("sha256", Buffer.from(canonical, "utf8"), publicKey, Buffer.from(signature, "base64"));
      if (!valid) return undefined;
      const nonceExpires = new Date(signedAt + deviceAuthWindowMs).toISOString();
      if (!this.database.consumeNonce(deviceId, nonce, nonceExpires)) return undefined;
      this.database.recordDeviceSeen(deviceId);
      return { deviceId, profileId: device.profileId, kind: "signed", deviceKind: device.deviceKind };
    } catch {
      return undefined;
    }
  }
}
