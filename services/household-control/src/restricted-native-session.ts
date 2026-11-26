export type RestrictedAttachment = {
  type: "file";
  mimeType: "text/plain" | "application/json" | "text/x-python";
  fileName: string;
  content: string;
  sizeBytes: number;
};
export type RestrictedSession = {
  sessionKey: string;
  agentId: string;
  permissionMode: "workspace" | "read-only";
};

export function restrictedPermission(agentId: string): RestrictedSession["permissionMode"] {
  if (agentId === "household-analysis") return "workspace";
  if (agentId === "household-diagnostics") return "read-only";
  throw new Error("restricted_runtime_unavailable");
}

export function validateRestrictedKey(sessionKey: string, agentId: string): void {
  const kind = agentId === "household-analysis" ? "analysis" : "diagnostic";
  const canonical = sessionKey.startsWith(`agent:${agentId}:`) ? sessionKey.slice(`agent:${agentId}:`.length) : sessionKey;
  if (!new RegExp(`^hardy-home:restricted:${kind}:[a-f0-9]{40}$`).test(canonical)) {
    throw new Error("restricted_session_invalid");
  }
}

export function validateRestrictedAttachments(attachments: RestrictedAttachment[] | undefined, agentId: string): void {
  if (!attachments) return;
  if (attachments.length > 8) throw new Error("restricted_attachment_invalid");
  let size = 0;
  for (const attachment of attachments) {
    if (attachment.type !== "file" || !["text/plain", "application/json", "text/x-python"].includes(attachment.mimeType) ||
      agentId === "household-diagnostics" && attachment.mimeType === "text/x-python" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(attachment.fileName) ||
      typeof attachment.content !== "string" || attachment.content.length > 699_052 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(attachment.content) ||
      !Number.isSafeInteger(attachment.sizeBytes) || attachment.sizeBytes < 0) throw new Error("restricted_attachment_invalid");
    const bytes = Buffer.from(attachment.content, "base64");
    if (bytes.length !== attachment.sizeBytes || bytes.toString("base64") !== attachment.content) throw new Error("restricted_attachment_invalid");
    size += bytes.length;
    if (size > 512 * 1024) throw new Error("restricted_attachment_too_large");
  }
}
