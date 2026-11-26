import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { DomainError } from "./common.ts";

export type ProcessOptions = { cwd?: string; timeoutMs?: number; maxBytes?: number; input?: string | Buffer;
  env?: Record<string,string>; signal?: AbortSignal; assertCurrent?: () => void; effect?: boolean; completionOnly?:boolean; errorEnvelopeExitCode?: 1 };
export class BoundedProcessRunner {
  private readonly children = new Set<ReturnType<typeof spawn>>();
  private closed = false;
  private kill(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
    try {
      if (process.platform !== "win32" && child.pid) process.kill(-child.pid,signal);
      else child.kill(signal);
    } catch { /* Already exited; no provider text is propagated. */ }
  }
  async runJson(binary: string, args: readonly string[], options: ProcessOptions = {}): Promise<unknown> {
    if (this.closed) throw new DomainError("domain_runtime_stopping");
    if (!path.isAbsolute(binary) || args.some(arg => typeof arg !== "string" || arg.includes("\0"))) throw new DomainError("domain_command_invalid");
    const executable = await realpath(binary).catch(() => null);
    if (!executable) throw new DomainError("dependency_unavailable", { httpStatus: 503 });
    const stat = await lstat(executable);
    if (!stat.isFile() || (stat.mode & 0o022) !== 0) throw new DomainError("dependency_untrusted", { httpStatus: 503 });
    await access(executable, constants.X_OK);
    if (options.cwd && !path.isAbsolute(options.cwd)) throw new DomainError("domain_command_invalid");
    const maxBytes = Math.max(1024,Math.min(options.maxBytes ?? 1024*1024,36*1024*1024));
    const timeoutMs = Math.max(1000,Math.min(options.timeoutMs ?? 30_000,360_000));
    if (options.signal?.aborted) throw new DomainError("operation_cancelled");
    options.assertCurrent?.();
    if(this.closed)throw new DomainError("domain_runtime_stopping");
    if (this.children.size >= 4) throw new DomainError("dependency_capacity_busy",{httpStatus:503});
    if (options.input && Buffer.byteLength(options.input) > 36*1024*1024) throw new DomainError("dependency_input_limit");
    const env = { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: process.env.HOME ?? "",
      LANG: "C.UTF-8", PYTHONDONTWRITEBYTECODE: "1", ...options.env };
    return new Promise((resolve,reject) => {
      const chunks: Buffer[] = []; let bytes=0; let settled=false; let failure: string | null=null;
      // Keep the trusted configured path: Python virtualenv discovery depends on its symlink path.
      const child = spawn(binary,args,{ cwd:options.cwd,env,stdio:["pipe","pipe","pipe"],shell:false,detached:process.platform!=="win32",windowsHide:true });
      this.children.add(child);
      const stop=(code:string) => { failure ??= code; this.kill(child,"SIGTERM"); killTimer ??= setTimeout(() => this.kill(child,"SIGKILL"),1000); killTimer.unref(); };
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const timer=setTimeout(() => stop("dependency_timeout"),timeoutMs);timer.unref();
      const aborted=() => stop("operation_cancelled");options.signal?.addEventListener("abort",aborted,{once:true});
      if(options.signal?.aborted)stop("operation_cancelled");
      const finish=(error?: Error,result?: unknown) => {
        if(settled)return;settled=true;clearTimeout(timer);if(killTimer)clearTimeout(killTimer);
        options.signal?.removeEventListener("abort",aborted);this.children.delete(child);
        error ? reject(error) : resolve(result);
      };
      child.stdout.on("data",(chunk:Buffer) => {bytes+=chunk.length;if(bytes>maxBytes)stop("dependency_output_limit");else chunks.push(chunk);});
      // stderr is drained but never returned: providers can include credentials/documents in it.
      child.stderr.on("data",(chunk:Buffer) => {bytes+=chunk.length;if(bytes>maxBytes)stop("dependency_output_limit");});
      child.on("error",() => finish(new DomainError("dependency_spawn_failed")));
      child.on("close",code => {
        this.kill(child,"SIGKILL");
        if(failure || code!==0 && code!==options.errorEnvelopeExitCode) { finish(new DomainError(failure ?? "dependency_failed",{outcome:options.effect ? "unknown" : "not_sent",httpStatus:503}));return; }
        if(options.completionOnly===true){finish(undefined,{completed:true,exitCode:0});return;}
        try {
          const result=JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if(code!==0 && (!result || result.version!==1 || result.ok!==false || typeof result.error?.code!=="string" || !Number.isInteger(result.error?.status)))throw Error();
          finish(undefined,result);
        }
        catch { finish(new DomainError("dependency_invalid_output",{outcome:options.effect ? "unknown" : "not_sent",httpStatus:503})); }
      });
      child.stdin.on("error",() => { /* close determines outcome; no raw errors */ });
      child.stdin.end(options.input);
    });
  }
  async close(): Promise<void> {
    this.closed=true;
    await Promise.all([...this.children].map(child => new Promise<void>(resolve => {
      child.once("close",() => {this.kill(child,"SIGKILL");resolve();});this.kill(child,"SIGTERM");
      const timer=setTimeout(() => this.kill(child,"SIGKILL"),1000);timer.unref();child.once("close",() => clearTimeout(timer));
    })));
  }
}
