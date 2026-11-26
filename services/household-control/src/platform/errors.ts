export class PlatformError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, statusCode = 409) {
    super(code);
    this.name = "PlatformError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function platformErrorCode(error: unknown): string {
  return error instanceof PlatformError ? error.code : "platform_unavailable";
}
