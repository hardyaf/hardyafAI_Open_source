import type { ServerResponse } from "node:http";

export type HouseholdEventScope =
  | { kind: "household" }
  | { kind: "profile"; profileId: string }
  | { kind: "conversation"; conversationId: string };

export type HouseholdEventSubscriber = {
  isActive: () => boolean;
  canRead: (scope: HouseholdEventScope) => boolean;
};

type Client = {
  response: ServerResponse;
  subscriber: HouseholdEventSubscriber;
  sequence: number;
  dispose: () => void;
};

export class HouseholdEventHub {
  private readonly clients = new Set<Client>();

  add(response: ServerResponse, subscriber: HouseholdEventSubscriber): () => void {
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const client: Client = {
      response,
      subscriber,
      sequence: 0,
      dispose: () => {
        if (heartbeat) clearInterval(heartbeat);
        this.clients.delete(client);
      },
    };
    this.clients.add(client);
    heartbeat = setInterval(() => {
      if (!subscriber.isActive() || response.destroyed || response.writableLength > 256 * 1024) {
        client.dispose();
        response.end();
        return;
      }
      response.write(": heartbeat\n\n");
    }, 20_000);
    heartbeat.unref();
    response.once("close", client.dispose);
    return client.dispose;
  }

  publish(event: string, payload: unknown, scope: HouseholdEventScope): void {
    if (!/^[a-z][a-z0-9.:-]{0,79}$/.test(event)) throw new Error("invalid_event_name");
    const data = JSON.stringify(payload);
    for (const client of this.clients) {
      if (!client.subscriber.isActive() || client.response.destroyed) {
        client.dispose();
        client.response.end();
        continue;
      }
      if (!client.subscriber.canRead(scope)) continue;
      if (client.response.writableLength > 256 * 1024) {
        client.dispose();
        client.response.end();
        continue;
      }
      // Per-subscriber counters do not expose gaps caused by another person's events.
      client.response.write(`id: ${++client.sequence}\nevent: ${event}\ndata: ${data}\n\n`);
    }
  }

  close(): void {
    for (const client of [...this.clients]) {
      client.dispose();
      client.response.end();
    }
  }
}
