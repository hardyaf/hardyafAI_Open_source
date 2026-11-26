export type BwsInvocationOptions = {
  env: Record<string, string>;
  encoding: "utf8";
  timeout: number;
  maxBuffer: number;
  windowsHide: boolean;
  shell: false;
};
export type BwsInvoker = (command: string, args: string[], options: BwsInvocationOptions) => {
  status: number | null;
  stdout: string;
  error?: Error;
};
export type BwsSecretResponse = {
  protocolVersion: 1;
  values: Record<string, string>;
  errors: Record<string, { code: string }>;
};
export function validateAutomationConfig(filename?: string, expectedServer?: string): { filename: string; profile: string };
export function resolveRequest(request: unknown, environment?: Record<string, string | undefined>, invoke?: BwsInvoker): BwsSecretResponse;
