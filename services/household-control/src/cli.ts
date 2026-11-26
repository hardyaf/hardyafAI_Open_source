import { resolve } from "node:path";
import { HouseholdDatabase } from "./database.ts";
import { OpenClawAgentAdapter } from "./openclaw-adapter.ts";

const [command, profileId = "alex", ttlValue = "15", requestedCode] = process.argv.slice(2);
if (command === "invite" || command === "invite-display") {
  const ttlMinutes = Number(ttlValue);
  if (!Number.isInteger(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > 1440) throw new Error("invalid_invitation_ttl");
  const databasePath = process.env.HARDY_HOME_DATABASE ?? resolve("data", "household-control.sqlite");
  const database = new HouseholdDatabase(databasePath);
  try {
    const invitation = database.createInvitation(profileId, ttlMinutes, requestedCode,command === "invite-display"?"display":"personal");
    process.stdout.write(`Profile: ${profileId}\nEnrollment code: ${invitation.code}\nExpires: ${invitation.expiresAt}\n`);
  } finally { database.close(); }
} else if (command === "probe-openclaw") {
  const url = process.env.OPENCLAW_GATEWAY_URL;
  const token = process.env.OPENCLAW_GATEWAY_TOKEN;
  if (!url || !token) throw new Error("gateway_not_configured");
  const adapter = new OpenClawAgentAdapter({ url, token });
  try {
    process.stdout.write(JSON.stringify(await adapter.probe()) + "\n");
  } finally { await adapter.close(); }
} else {
  process.stderr.write("Usage: npm run invite -- <profile-id> [ttl-minutes] [one-time-code], or npm run probe\n");
  process.exitCode = 2;
}
