import { createHash, randomUUID } from "node:crypto";
import { GatewayClient } from "@openclaw/gateway-client";
import { PROTOCOL_VERSION } from "@openclaw/gateway-protocol/version";
import type {
  ChatMessage,
  Conversation,
  FamilyProfile,
  HouseholdAgentAdapter,
  HouseholdAgentEvent,
  HouseholdAgentRunState,
  SubmissionReceipt,
} from "./domain.ts";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    const item = record(part);
    return typeof item?.text === "string" ? item.text : "";
  }).filter(Boolean).join("\n");
}

function normalizeHistory(conversationId: string, result: unknown): ChatMessage[] {
  const root = record(result);
  const values = Array.isArray(root?.messages) ? root.messages : [];
  return values.flatMap((value, index) => {
    const item = record(value);
    if (!item) return [];
    const role = item.role;
    if (role !== "user" && role !== "assistant" && role !== "system") return [];
    const text = textFromContent(item.content ?? item.text ?? item.message).trim();
    if (!text) return [];
    const metadata = record(item.__openclaw);
    const rawTimestamp = item.createdAt ?? item.timestamp ?? item.ts;
    const createdAt = typeof rawTimestamp === "number"
      ? new Date(rawTimestamp).toISOString()
      : typeof rawTimestamp === "string"
        ? rawTimestamp
        : new Date().toISOString();
    const stableSource = `${conversationId}\n${role}\n${createdAt}\n${text}\n${index}`;
    return [{
      id: typeof metadata?.id === "string"
        ? metadata.id
        : createHash("sha256").update(stableSource).digest("hex").slice(0, 24),
      conversationId,
      role,
      text,
      createdAt,
    } satisfies ChatMessage];
  });
}

export class OpenClawAgentAdapter implements HouseholdAgentAdapter {
  readonly mode = "openclaw" as const;
  private readonly client: GatewayClient;
  private readonly listeners = new Set<(event: HouseholdAgentEvent) => void>();
  private ready = false;
  private started = false;
  private readyPromise: Promise<void>;
  private resolveReady: (() => void) | undefined;
  private rejectReady: ((error: Error) => void) | undefined;
  private lastError: string | undefined;

  constructor(options: { url: string; token: string }) {
    this.readyPromise = this.newReadyPromise();
    this.client = new GatewayClient({
      url: options.url,
      token: options.token,
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      clientName: "gateway-client",
      clientDisplayName: "Hardy Home control service",
      clientVersion: "0.2.0",
      platform: process.platform,
      mode: "backend",
      role: "operator",
      scopes: ["operator.read", "operator.write"],
      onHelloOk: () => {
        this.ready = true;
        this.lastError = undefined;
        this.resolveReady?.();
      },
      onConnectError: (error) => {
        this.lastError = error.message;
        if (!this.ready) this.rejectReady?.(error);
      },
      onClose: () => {
        this.ready = false;
        this.readyPromise = this.newReadyPromise();
      },
      onEvent: (event) => this.handleEvent(event.event, event.payload),
    });
  }

  private newReadyPromise(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
  }

  private async connected() {
    if (!this.started) {
      this.started = true;
      this.client.start();
    }
    if (this.ready) return;
    await this.readyPromise;
  }

  private handleEvent(name: string, payload: unknown) {
    if (name !== "chat") return;
    const data = record(payload);
    if (!data || typeof data.sessionKey !== "string") return;
    const state = typeof data.state === "string" ? data.state : "";
    const phase: HouseholdAgentEvent["phase"] = state === "final"
      ? "complete"
      : state === "error"
        ? "failed"
        : state === "aborted"
          ? "cancelled"
          : "changed";
    const event: HouseholdAgentEvent = {
      sessionKey: data.sessionKey,
      runId: typeof data.runId === "string" ? data.runId : null,
      phase,
    };
    for (const listener of this.listeners) listener(event);
  }

  async ensureConversation(conversation: Conversation): Promise<void> {
    await this.connected();
    await this.client.request("sessions.create", {
      key: conversation.sessionKey,
      agentId: conversation.agentId,
      displayName: conversation.title,
      titleSource: conversation.title,
    });
  }

  async listMessages(conversation: Conversation): Promise<ChatMessage[]> {
    await this.connected();
    const result = await this.client.request("chat.history", {
      sessionKey: conversation.sessionKey,
      agentId: conversation.agentId,
      limit: 200,
      maxChars: 100_000,
    });
    return normalizeHistory(conversation.id, result);
  }

  async submitMessage(args: {
    conversation: Conversation;
    profile: FamilyProfile;
    text: string;
    submissionId: string;
    shouldQueue: boolean;
    queuePosition: number | null;
  }): Promise<SubmissionReceipt> {
    if (args.shouldQueue) {
      return {
        submissionId: args.submissionId,
        conversationId: args.conversation.id,
        profileId: args.profile.id,
        agentId: args.profile.agentId,
        status: "queued",
        queuePosition: args.queuePosition,
        runId: null,
      };
    }
    await this.connected();
    const result = await this.client.request<JsonRecord>("chat.send", {
      sessionKey: args.conversation.sessionKey,
      agentId: args.conversation.agentId,
      message: args.text,
      idempotencyKey: args.submissionId,
      deliver: false,
    }, { timeoutMs: 45_000 });
    return {
      submissionId: args.submissionId,
      conversationId: args.conversation.id,
      profileId: args.profile.id,
      agentId: args.profile.agentId,
      status: "running",
      queuePosition: null,
      runId: typeof result.runId === "string" ? result.runId : null,
    };
  }

  async getRunState(conversation: Conversation): Promise<HouseholdAgentRunState> {
    await this.connected();
    const result = record(await this.client.request("sessions.list", {
      agentId: conversation.agentId,
      includeGlobal: true,
      limit: 500,
    }));
    const sessions = Array.isArray(result?.sessions) ? result.sessions : [];
    const row = sessions.map(record).find((candidate) => {
      const key = candidate?.key;
      return typeof key === "string" && (
        key === conversation.sessionKey || key.endsWith(`:${conversation.sessionKey}`)
      );
    });
    if (!row) return { status: "unknown", runId: null, updatedAt: null };
    const rawStatus = typeof row.status === "string" ? row.status : "unknown";
    const status: HouseholdAgentRunState["status"] = rawStatus === "done"
      ? "complete"
      : rawStatus === "failed" || rawStatus === "timeout"
        ? "failed"
        : rawStatus === "interrupted" || rawStatus === "killed"
          ? "cancelled"
          : rawStatus === "queued"
            ? "queued"
            : rawStatus === "running"
              ? "running"
              : "unknown";
    const updatedAt = typeof row.updatedAt === "number"
      ? new Date(row.updatedAt).toISOString()
      : null;
    return {
      status,
      runId: typeof row.lastRunId === "string" ? row.lastRunId : null,
      updatedAt,
    };
  }

  async cancel(conversation: Conversation, runId?: string): Promise<void> {
    await this.connected();
    await this.client.request("chat.abort", {
      sessionKey: conversation.sessionKey,
      agentId: conversation.agentId,
      ...(runId ? { runId } : {}),
    });
  }

  onEvent(listener: (event: HouseholdAgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async diagnostics() {
    if (!this.started) return { status: "not-started" };
    if (this.ready) return { status: "connected" };
    return { status: "reconnecting", ...(this.lastError ? { detail: this.lastError } : {}) };
  }

  async probe(): Promise<{ status: string; gatewayVersion?: string }> {
    await this.connected();
    const result = await this.client.request<JsonRecord>("status", {});
    const version = typeof result.version === "string"
      ? result.version
      : typeof record(result.server)?.version === "string"
        ? record(result.server)?.version as string
        : undefined;
    return { status: "connected", ...(version ? { gatewayVersion: version } : {}) };
  }

  async close(): Promise<void> {
    if (this.started) await this.client.stopAndWait();
  }
}
