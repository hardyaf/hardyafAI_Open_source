/** Reserved framework metadata, created only by this trusted native bridge. */
export const nativeContextProjectionKey = "__openclawContextProjectionV1";
const object = value => value && typeof value === "object" && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const identifier = value => typeof value === "string" && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value);
const messagePath = ["result", "result", "result"];

/**
 * Domain-owned recovery contract. Never scan provider text or promote a descriptor
 * supplied inside business data. This only describes context delivery, not authority.
 */
export function createNativeContextProjection(nativeName, value, params) {
  if (nativeName !== "household_email_read" || !object(value) || value.source !== "connected_google" || value.untrusted !== true ||
      !object(value.result) || value.result.operation !== "gmail.get" || value.result.untrusted !== true) return;
  const receipt = value.result, message = receipt.result;
  if (!identifier(receipt.connectionId) || typeof receipt.account !== "string" || receipt.account.length > 320 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(receipt.account) || !object(message) || !identifier(message.id) ||
      message.bodySource !== "text/plain" || typeof message.body !== "string" || !message.body.length ||
      typeof message.bodyComplete !== "boolean" || typeof message.bodyTruncated !== "boolean" ||
      !Array.isArray(message.omissions) || message.omissions.some(code => typeof code !== "string" || !/^[a-z_]{1,80}$/.test(code))) return;
  const window = message.bodyWindow;
  if (!object(window) || window.projection !== "gmail-plain-text-v1" || typeof window.version !== "string" ||
      !/^sha256-v1:[a-f0-9]{64}$/.test(window.version) || !integer(window.offset) || !integer(window.endOffset) ||
      !integer(window.totalChars) || window.endOffset < window.offset || window.totalChars < window.endOffset ||
      typeof window.complete !== "boolean" || window.complete && window.endOffset !== window.totalChars ||
      window.nextOffset !== (window.endOffset < window.totalChars ? window.endOffset : null) ||
      Array.from(message.body).length !== window.endOffset - window.offset ||
      message.bodyComplete !== (window.complete && window.offset === 0) ||
      message.bodyTruncated !== (!window.complete || window.offset > 0 || window.endOffset < window.totalChars)) return;
  if (!object(params) || Object.keys(params).some(key => !["connectionId", "messageId", "format", "bodyWindow"].includes(key)) ||
      params.messageId !== message.id || params.connectionId !== undefined && params.connectionId !== receipt.connectionId ||
      params.format !== undefined && params.format !== "full") return;
  let requestedOffset = 0, maximum = 60000;
  if (params.bodyWindow !== undefined) {
    const request = params.bodyWindow;
    if (!object(request) || Object.keys(request).some(key => !["offset", "maxChars", "version"].includes(key)) ||
        request.offset !== undefined && !integer(request.offset) || !integer(request.maxChars) || request.maxChars < 1 || request.maxChars > 60000 ||
        request.version !== undefined && request.version !== window.version) return;
    requestedOffset = request.offset ?? 0; maximum = request.maxChars;
    if (requestedOffset > 0 && request.version === undefined) return;
  }
  if (requestedOffset !== window.offset || window.endOffset - window.offset > maximum) return;
  return {version: 1, blocks: [{index: 0, format: "json", omissions: [{
    path: [...messagePath, "body"],
    updates: [
      {path: [...messagePath, "bodyComplete"], value: false},
      {path: [...messagePath, "bodyTruncated"], value: true},
      {path: [...messagePath, "bodyWindow", "endOffset"], value: window.offset},
      {path: [...messagePath, "bodyWindow", "nextOffset"], value: window.offset},
      {path: [...messagePath, "bodyWindow", "complete"], value: false},
    ],
    readback: {
      toolName: "household_email_read",
      args: {connectionId: receipt.connectionId, messageId: message.id, format: "full",
        bodyWindow: {offset: window.offset, version: window.version}},
      requires: ["bodyWindow.maxChars"],
    },
  }]}]};
}
