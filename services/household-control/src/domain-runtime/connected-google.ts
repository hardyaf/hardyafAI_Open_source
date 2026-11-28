import { googleMessageReadInput } from "../domains/google/message-read.ts";
import { request } from "node:http";
import path from "node:path";
import type { ConnectedGooglePort } from "../domains/google/connections-port.ts";
import { NativeDomainError } from "../domains/native-contracts.ts";
import type { NativeDomainContext } from "../domains/native-contracts.ts";

/** Scoped results only over the protected service socket. No credential fetch operation. */
export class ConnectedGoogleClient implements ConnectedGooglePort {
  private readonly socketPath: string;
  constructor(socketPath: string) {
    if (!path.isAbsolute(socketPath)) throw new Error("credential_consumer_socket_invalid");
    this.socketPath = socketPath;
  }
  write(connectionId:string,tool:string,args:unknown,context:NativeDomainContext){return this.call({action:'write',connectionId,tool,args},context);}
  writeDefaultEmail(tool:string,args:unknown,context:NativeDomainContext){return this.call({action:'write_default_email',tool,args},context);}
  list(context: NativeDomainContext) { return this.call({ action: "list" }, context); }
  readDefaultEmail(tool: string, args: unknown, context: NativeDomainContext) {
    return this.call({ action: "read_default_email", tool, args: tool === "household_email_read" ? googleMessageReadInput(args) : args }, context);
  }
  read(connectionId: string, tool: string, args: unknown, context: NativeDomainContext) {
    return this.call({ action: "read", connectionId, tool, args: tool === "household_email_read" ? googleMessageReadInput(args) : args }, context);
  }
  private call(input: Record<string, unknown>, context: NativeDomainContext): Promise<unknown> {
    context.assertCurrent();
    if (context.audience !== "private" || !context.credentialAuthority)
      throw new NativeDomainError("private_connection_context_required", 403);
    const body = JSON.stringify({ ...input, context: context.credentialAuthority });
    return new Promise((resolve, reject) => {
      const writing=String(input.action).startsWith('write'),transportError=()=>new NativeDomainError(writing?'connected_google_write_outcome_unknown':'connected_google_unavailable',503,writing?'unknown':'not_sent');
      const outbound = request({ socketPath: this.socketPath, method: "POST", path: "/google",
        signal: context.signal,
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
      }, response => {
        const chunks: Buffer[] = [];
        response.on("data", chunk => {
          chunks.push(chunk);
        });
        response.on("error", () => reject(transportError()));
        response.on("aborted", () => reject(transportError()));
        response.on("end", () => {
          try {
            context.assertCurrent();
            const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (response.statusCode !== 200) {
              const code = typeof value.error === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(value.error)
                ? value.error : "connected_google_unavailable";
              throw new NativeDomainError(code, [400,403,404,409,503].includes(response.statusCode ?? 0) ? response.statusCode : 503, value.outcome==="unknown"?"unknown":"not_sent");
            }
            resolve(value);
          } catch (error) { reject(error instanceof NativeDomainError ? error : transportError()); }
        });
      });
      outbound.on("error", () => reject(transportError()));
      outbound.end(body);
    });
  }
}
