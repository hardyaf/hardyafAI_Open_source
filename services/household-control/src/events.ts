import type { ServerResponse } from "node:http";

export class HouseholdEventHub {
  private readonly clients = new Set<ServerResponse>();
  private nextId = 1;

  add(response: ServerResponse): () => void {
    this.clients.add(response);
    const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 20_000);
    const remove = () => {
      clearInterval(heartbeat);
      this.clients.delete(response);
    };
    response.once("close", remove);
    return remove;
  }

  publish(event: string, payload: unknown) {
    const frame = `id: ${this.nextId++}\nevent: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of this.clients) client.write(frame);
  }

  close() {
    for (const client of this.clients) client.end();
    this.clients.clear();
  }
}
