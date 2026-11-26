#!/usr/bin/env node
import path from "node:path";
import { buildNativeExecutionProfiles, nativeAnalysisAttachmentPolicy } from "../services/household-control/src/platform/native-execution.ts";

const [stateRoot, image, sandboxUser] = process.argv.slice(2);
if (!stateRoot || !path.isAbsolute(stateRoot) || !image || !sandboxUser) {
  process.stderr.write("Usage: node render-native-platform-config.mjs ABSOLUTE_STATE_ROOT FIXED_IMAGE UID:GID\n");
  process.exitCode = 2;
} else {
  const entries = buildNativeExecutionProfiles({
    analysisWorkspace: path.join(stateRoot, "native-profiles", "analysis"),
    diagnosticWorkspace: path.join(stateRoot, "native-profiles", "diagnostic"),
    image, sandboxUser,
  });
  process.stdout.write(JSON.stringify({ agents: { entries }, tools: { sessions_spawn: { attachments: nativeAnalysisAttachmentPolicy } } }, null, 2) + "\n");
}
