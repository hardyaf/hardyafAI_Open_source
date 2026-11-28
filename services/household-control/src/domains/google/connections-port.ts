export type { GoogleBodyWindow, GoogleMessageReadInput } from "./message-read.ts";
import type { NativeDomainContext } from "../native-contracts.ts";

export interface ConnectedGooglePort {
  write?(connectionId:string,tool:string,args:unknown,context:NativeDomainContext):Promise<unknown>;
  writeDefaultEmail?(tool:string,args:unknown,context:NativeDomainContext):Promise<unknown>;
  list(context: NativeDomainContext): Promise<unknown>;
  readDefaultEmail(tool: string, args: unknown, context: NativeDomainContext): Promise<unknown>;
  read(connectionId: string, tool: string, args: unknown, context: NativeDomainContext): Promise<unknown>;
}
