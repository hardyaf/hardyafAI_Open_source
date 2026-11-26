import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const serviceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("node_24_required");
function sources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sources(path) : /\.(ts|mjs)$/.test(entry.name) ? [path] : [];
  });
}
const paths = [...sources(join(serviceRoot, "src")), ...sources(join(serviceRoot, "scripts")), ...sources(join(serviceRoot, "test"))];
for (const path of paths) {
  const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8", timeout: 30_000 });
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "syntax_check_failed");
    throw new Error("source_check_failed");
  }
}
JSON.parse(readFileSync(join(serviceRoot, "package.json"), "utf8"));
await import(pathToFileURL(join(serviceRoot, "src", "server.ts")).href);
process.stdout.write(JSON.stringify({ status: "source_ready", checkedFiles: paths.length, node: process.versions.node, functionalTestsRun: false }) + "\n");
