import type { ArtifactInput, ArtifactMetadata, ArtifactPrincipal, ArtifactScope } from "../platform/artifacts.ts";
import type { TaskFlowContext } from "../task-flow/types.ts";

export type AnalysisExecution = { agentId: string; sessionKey: string; sessionId: string; runId: string;
  sandboxed: boolean; workspaceDir?: string; toolCallId?: string };
export type AnalysisFlowContext = TaskFlowContext & { execution: AnalysisExecution };
export type NativeAnalysisAttachment = { name: string; content: string; encoding: "base64"; mimeType: string };
export type NativeAnalysisRequest = {
  /** Application-only admission correlation; strip before native sessions_spawn. */
  requestArtifactId: string;
  task: string; taskName: string; label: string; agentId: "household-analysis";
  runtime: "subagent"; mode: "run"; cleanup: "keep"; sandbox: "require";
  context: "isolated"; completionTarget: "parent"; visible: false; thread: false;
  expectsCompletionMessage: true; attachments: NativeAnalysisAttachment[];
};
export type NativeAnalysisAdmission = { state: "accepted" | "rejected" | "unknown";
  childSessionKey: string | null; runId: string | null; rejectionCode?: "analysis_attachments_disabled" | "analysis_attachment_policy_unavailable" | "analysis_attachment_limit_exceeded" | "analysis_native_configuration_unavailable" | "analysis_native_forbidden" | "analysis_native_outcome_unknown" };
export type NativeAnalysisChild = { childSessionKey: string; runId: string; agentId: "household-analysis";
  parentSessionKey: string; rootTaskId: string; sandboxed: true;
  state: "running" | "paused" | "complete" | "failed" | "cancelled" };
export type AnalysisChildIdentity = {
  childSessionKey: string; runId: string; parentSessionKey: string; parentAgentId: string; expectedSessionId?: string;
};
export type NativeAnalysisObservation = Omit<AnalysisChildIdentity, "parentAgentId" | "expectedSessionId"> & {
  expectedSessionId: string | null; rootTaskId: string; assertCurrent: () => void;
};
export type AnalysisRequestRecord = {
  schemaVersion: 1; kind: "analysis_request"; scope: ArtifactScope;
  nativeSessionId: string; nativeGoalId: string | null; parent: AnalysisExecution;
  sourcePromptId: string; sourceSha256: string; operationId: string; instruction: string;
  inputs: Array<{ artifactId: string; sha256: string; mimeType: string; name: string }>;
};
export type AnalysisOutputRecord = {
  schemaVersion: 1; kind: "analysis_output"; requestArtifactId: string;
  childSessionKey: string; childSessionId: string; childRunId: string;
  artifactId: string; sha256: string; filename: string; mimeType: string;
};
export type AnalysisFlowPorts = {
  artifacts: {
    read(id: string, principal: ArtifactPrincipal): Promise<{ metadata: ArtifactMetadata; bytes: Buffer }>;
    put(scope: ArtifactScope, principal: ArtifactPrincipal, input: ArtifactInput): Promise<ArtifactMetadata>;
  };
  /** Existing NativeExecutionPolicies, plus effective current child-only tool grant. */
  assertAnalysisPolicy(context: AnalysisFlowContext): Promise<void>;
  /** Must invoke the real native same-parent spawn tool, not an independent session. */
  spawn(context: AnalysisFlowContext, request: NativeAnalysisRequest): Promise<NativeAnalysisAdmission>;
  /** Native owner read; rejects unrelated or unknown child/run identities. No model-provided lineage. */
  child(context: AnalysisFlowContext, identity: AnalysisChildIdentity): Promise<NativeAnalysisChild>;
  /** Exact trusted spawn admission retained by the existing application authority. */
  childRequestMatches(context: AnalysisFlowContext, requestArtifactId: string, childSessionKey: string, runId: string): Promise<boolean>;
  /** A trusted native workspace root; never taken from model arguments or a report. */
  sandboxRoots: string[];
  writeArtifact?(context: AnalysisFlowContext, input: ArtifactInput): Promise<ArtifactMetadata>;
};
