import { resolve } from "node:path";
import { HouseholdDatabase } from "./database.ts";
import { OpenClawAgentAdapter } from "./openclaw-adapter.ts";

const [command, profileId = "alex", ttlValue = "15", requestedCode] = process.argv.slice(2);
const databasePath = process.env.HARDY_HOME_DATABASE ?? resolve("data", "household-control.sqlite");
const database = new HouseholdDatabase(databasePath);

try {
  if (command === "invite") {
    const ttlMinutes = Number(ttlValue);
    if (!Number.isInteger(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > 1440) {
      throw new Error("TTL must be an integer from 1 to 1440 minutes");
    }
    const invitation = database.createInvitation(profileId, ttlMinutes, requestedCode);
    process.stdout.write(`Profile: ${profileId}\n`);
    process.stdout.write(`Enrollment code: ${invitation.code}\n`);
    process.stdout.write(`Expires: ${invitation.expiresAt}\n`);
  } else if (command === "probe-openclaw") {
    const url = process.env.OPENCLAW_GATEWAY_URL;
    const token = process.env.OPENCLAW_GATEWAY_TOKEN;
    if (!url || !token) throw new Error("OPENCLAW_GATEWAY_URL and OPENCLAW_GATEWAY_TOKEN are required");
    const adapter = new OpenClawAgentAdapter({ url, token });
    try {
      process.stdout.write(`${JSON.stringify(await adapter.probe())}\n`);
    } finally {
      await adapter.close();
    }
  } else {
    process.stderr.write("Usage: npm run invite -- <profile-id> [ttl-minutes] [one-time-code], or npm run probe\n");
    process.exitCode = 2;
  }
} finally {
  database.close();
}
