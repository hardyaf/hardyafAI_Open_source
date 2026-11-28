import { createHash } from "node:crypto";
import { PlatformError } from "../platform/errors.ts";
import type { TaskFlowContext, TaskFlowPorts, VerifiedTaskEvidence } from "./types.ts";

/** A report/chart/file is evidence only when the existing artifact owner confirms its exact output. */
export async function verifyTaskArtifact(context: TaskFlowContext, id: string, artifacts: TaskFlowPorts["artifacts"]): Promise<VerifiedTaskEvidence> {
  context.assertCurrent();
  const verified = artifacts.verify ? await artifacts.verify(id, context.principal, context.assertCurrent) : null;
  const buffered = verified ? null : await artifacts.read(id, context.principal);
  const metadata = verified ?? buffered!.metadata;
  context.assertCurrent();
  if (metadata.ownerProfileId !== context.scope.ownerProfileId || metadata.conversationId !== context.scope.conversationId ||
    metadata.taskId !== context.scope.taskId || metadata.audience !== context.scope.audience) throw new PlatformError("task_evidence_binding_mismatch", 409);
  if (metadata.kind !== "output" ||
    ["task-handoff.json", "task-question.json"].includes(metadata.filename)) throw new PlatformError("task_artifact_not_outcome_evidence", 409);
  const sha256 = verified ? verified.sha256 : createHash("sha256").update(buffered!.bytes).digest("hex");
  if (sha256 !== metadata.sha256) throw new PlatformError("task_evidence_integrity_failed", 503);
  return { kind: "artifact", id, verified: true, digest: sha256,
    provenance: "scoped_immutable_output_artifact", summary: metadata.filename + " (" + metadata.mimeType + ", " + metadata.byteLength + " bytes)" };
}
