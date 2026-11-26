import type { DomainTool } from "../domain-runtime/common.ts";
const artifact = { type: "string", pattern: "^artifact-[a-f0-9]{64}$" };
const operation = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$" };
export const analysisToolDescriptors: DomainTool[] = [
  { name: "analysis.start", capability: "analysis", effect: "write", description: "Start an actual native child for local Python analysis in the fixed no-network/no-secrets sandbox. Inputs are authorized text/JSON/CSV/Python, raster image artifacts, up to 32 files and 16 MiB total. A separate native goal is optional. Returns native child identity and request artifact. For an accepted pending child call the visible native sessions_yield function directly with {}. Omit waitFor and do not wrap it in tool_call. Use analysis.result after child completion. Inspect uncertain admission before considering any retry. A rejected admission has no child: inspect its cause and report the blocker; do not replace this typed boundary with raw sessions_spawn or create_goal.",
    inputSchema: { type: "object", additionalProperties: false, required: ["instruction", "inputArtifactIds"], properties: {
      operationId: operation, instruction: { type: "string", minLength: 1, maxLength: 12000 },
      inputArtifactIds: { type: "array", maxItems: 32, uniqueItems: true, items: artifact } } } },
  { name: "analysis.result", capability: "analysis", effect: "read", description: "Verify the exact announced native analysis child's scoped output manifests and immutable files. This is a current-state read after native completion, not a status polling or replay mechanism.",
    inputSchema: { type: "object", additionalProperties: false, required: ["requestArtifactId", "childSessionKey", "childRunId", "outputManifestIds"], properties: {
      requestArtifactId: artifact, childSessionKey: { type: "string", minLength: 1, maxLength: 256 }, childRunId: { type: "string", minLength: 1, maxLength: 128 },
      outputManifestIds: { type: "array", minItems: 1, maxItems: 16, uniqueItems: true, items: artifact } } } },
  { name: "analysis.publish_output", capability: "analysis", effect: "write", description: "Child-only: import one actual analysis output from outputs/<basename> in this exact native sandbox into the existing scoped artifact store. The parent cannot call this tool; host paths, symlinks, raw transcript and input files are rejected. Include returned outputManifestId in your native completion.",
    inputSchema: { type: "object", additionalProperties: false, required: ["requestArtifactId", "relativePath"], properties: {
      operationId: operation, requestArtifactId: artifact, relativePath: { type: "string", pattern: "^outputs/[A-Za-z0-9][A-Za-z0-9._-]{0,119}$" } } } },
  { name: "analysis.publish_report", capability: "analysis", effect: "write", description: "Publish a bounded text-only report as an immutable current-task output artifact, including diagnosis-only reports. No shell, helper, provider operation, external message or operational state change. Cite real diagnostic evidence and label uncertainty.",
    inputSchema: { type: "object", additionalProperties: false, required: ["title", "text"], properties: {
      operationId: operation, title: { type: "string", minLength: 1, maxLength: 120 }, text: { type: "string", minLength: 1, maxLength: 48000 } } } },
];
