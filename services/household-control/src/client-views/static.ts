import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "../http-codec.ts";

const contentTypes = {
  "index.html": "text/html; charset=utf-8",
  "styles.css": "text/css; charset=utf-8",
  "app.mjs": "text/javascript; charset=utf-8",
  "signing.mjs": "text/javascript; charset=utf-8",
  "api.mjs": "text/javascript; charset=utf-8",
  "library.mjs": "text/javascript; charset=utf-8",
  "media.mjs": "text/javascript; charset=utf-8",
  "workspace.mjs": "text/javascript; charset=utf-8",
  "sidebar.mjs": "text/javascript; charset=utf-8",
  "fitbit.mjs": "text/javascript; charset=utf-8",
  "connections.mjs": "text/javascript; charset=utf-8",
  "connections.css": "text/css; charset=utf-8",
  "household-ca.cer": "application/pkix-cert",
};
type Asset = keyof typeof contentTypes;

const csp="default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob: data:; frame-src blob: 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'";

/** Public static assets only, with an exact asset allowlist and no arbitrary filesystem routing. */
function createAssetRoutes(options:{root:string}, prefix:string, files:Asset[], kind:"display"|"home") {
  if(!path.isAbsolute(options.root))throw new Error(kind + "_asset_root_invalid");
  const root=path.resolve(options.root);
  const assets = new Map<string, Asset>([[prefix, "index.html"], [prefix + "/", "index.html"]]);
  for (const name of files) assets.set(prefix + "/" + name, name);
  const unavailable = kind + "_assets_unavailable";
  return async(request:IncomingMessage,response:ServerResponse,url:URL):Promise<boolean>=>{
    const asset=assets.get(url.pathname);
    if(!asset)return false;
    if(request.method!=="GET"&&request.method!=="HEAD"){response.setHeader("Allow","GET, HEAD");sendJson(response,405,{error:"method_not_allowed"});return true;}
    let handle:Awaited<ReturnType<typeof open>>|undefined;
    try {
      const directory=await lstat(root);
      if(!directory.isDirectory()||directory.isSymbolicLink()||await realpath(root)!==root)throw new Error(unavailable);
      handle=await open(path.join(root,asset),constants.O_RDONLY|(constants.O_NOFOLLOW??0));
      const stat=await handle.stat();
      if(!stat.isFile()||stat.nlink!==1||stat.size>1024*1024)throw new Error(unavailable);
      const bytes=await handle.readFile();if(bytes.length!==stat.size)throw new Error(unavailable);
      response.writeHead(200,{"content-type":contentTypes[asset],"content-length":bytes.length,"cache-control":"no-store","content-security-policy":csp,
        "x-content-type-options":"nosniff","referrer-policy":"no-referrer","permissions-policy":kind === "home"
          ? "camera=(self), microphone=(self), on-device-speech-recognition=(self), geolocation=()"
          : "camera=(), microphone=(), geolocation=()","cross-origin-opener-policy":"same-origin"});
      response.end(request.method==="HEAD"?undefined:bytes);
    } catch {if(!response.headersSent)sendJson(response,503,{error:unavailable});else response.destroy();}
    finally {await handle?.close().catch(()=>{});}
    return true;
  };
}

export function createDisplayAssetRoutes(options:{root:string}) {
  return createAssetRoutes(options, "/display", ["index.html","styles.css","app.mjs","signing.mjs"], "display");
}

export function createHomeAssetRoutes(options:{root:string}) {
  return createAssetRoutes(options, "/home", ["index.html","styles.css","app.mjs","signing.mjs","api.mjs","library.mjs","media.mjs","workspace.mjs","sidebar.mjs","fitbit.mjs","connections.mjs","connections.css","household-ca.cer"], "home");
}
