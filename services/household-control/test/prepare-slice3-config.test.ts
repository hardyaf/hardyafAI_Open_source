import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const generator = path.join(repository, "deploy/hardybot/prepare-slice3.py");
const home = homedir(), relativeRepository = path.relative(home, repository);
const supported = process.platform === "linux" && relativeRepository !== ".." && !relativeRepository.startsWith("../") && !path.isAbsolute(relativeRepository);

async function fixture() {
  const staging = path.join(home, "hardybot_testing", "tests");
  await mkdir(staging, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(staging, "prepare-slice3-config-"));
  assert.ok(path.resolve(root).startsWith(path.resolve(staging) + path.sep));
  const files = { native: path.join(root, "native-input.json"), domains: path.join(root, "domains-input.json"), rules: path.join(root, "entry-rules.json"),
    nativeOutput: path.join(root, "native-candidate.json"), domainsOutput: path.join(root, "domains-candidate.json"), control: path.join(root, "control.env") };
  const native = { agents: { entries: { main: { workspace: path.join(root, "main") } } }, plugins: { entries: {
    "hardy-household": { config: { controlEnvironmentPath: files.control } },
    "memory-wiki": { enabled: true, config: { vault: { scope: "agent", path: path.join(root, "wiki") }, vaultMode: "isolated" } },
  } } };
  const domains = { version: 1, profiles: { alex: { enabled: true, domains: ["lists"], scopes: ["personal", "household"], sharedDomains: ["lists"] } },
    memory: { workspaces: { main: path.join(root, "main") } }, documents: { python: "/usr/bin/python3" }, uplift: { python: "/usr/bin/python3" } };
  const rules = { nativeEntries: [], familyProfiles: [{ profileId: "alex", agentId: "main", role: "admin" }] };
  for (const [filename, value] of [[files.native, native], [files.domains, domains], [files.rules, rules]] as const)
    await writeFile(filename, JSON.stringify(value) + "\n", { mode: 0o600 });
  await writeFile(files.control, "HARDY_HOME_DOMAINS_CONFIG=" + files.domainsOutput + "\n", { mode: 0o600 });
  const initial = await Promise.all([files.native, files.domains, files.rules].map(filename => readFile(filename)));
  function run(extra: string[] = []) {
    return execFileSync("/usr/bin/python3", [generator, "--config", files.native, "--domains", files.domains, "--entry-rules", files.rules,
      "--native-output", files.nativeOutput, "--domains-output", files.domainsOutput, "--openclaw-bin", "/usr/bin/true", "--node-bin", process.execPath,
      "--state-root", path.join(root, "state"), "--sandbox-root", path.join(root, "sandbox"), "--sandbox-image", "hardy-home-analysis:test",
      "--native-active-path", files.nativeOutput, ...extra], { encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] });
  }
  return { root, files, run, async unchanged() {
    const current = await Promise.all([files.native, files.domains, files.rules].map(filename => readFile(filename)));
    for (let index = 0; index < initial.length; index++) assert.deepEqual(current[index], initial[index]);
  }, async close() { assert.ok(path.resolve(root).startsWith(path.resolve(staging) + path.sep)); await rm(root, { recursive: true, force: true }); } };
}

test("real Slice3 generator defaults to an isolated native/domain candidate pair", { skip: !supported }, async () => {
  const f = await fixture(); try {
    const result = JSON.parse(f.run()); assert.equal(result.prepared, true); assert.equal(result.nativeActivated, false); assert.equal(result.providerCalls, false);
    const native = JSON.parse(await readFile(f.files.nativeOutput, "utf8")), domains = JSON.parse(await readFile(f.files.domainsOutput, "utf8"));
    assert.equal(native.plugins.entries["hardy-household"].config.domainConfigurationPath, f.files.domainsOutput);
    assert.equal(domains.execution.nativeConfigPath, f.files.nativeOutput);
    assert.equal(native.agents.entries.main.tools.allow.includes("web_search"), false);
    assert.equal(native.agents.entries.main.tools.allow.includes("web_fetch"), false);
    assert.deepEqual(native.tools.sessions_spawn.attachments,{enabled:true,maxFiles:32,maxTotalBytes:16777216,maxFileBytes:16777216,retainOnSessionKeep:true});
    await f.unchanged();
  } finally { await f.close(); }
});

test("Slice3 preserves only explicit adult public web tools without enabling other agents", { skip: !supported }, async () => {
  const f = await fixture();
  try {
    const domains = JSON.parse(await readFile(f.files.domains, "utf8"));
    domains.profiles.alex.domains.push("web");
    domains.profiles.alex.sharedDomains.push("web");
    domains.profiles.other = { ...domains.profiles.alex, enabled: false };
    domains.profiles.child = { ...domains.profiles.alex, enabled: false };
    await writeFile(f.files.domains, JSON.stringify(domains) + "\n", { mode: 0o600 });

    const rules = JSON.parse(await readFile(f.files.rules, "utf8"));
    rules.familyProfiles.push({ profileId: "other", agentId: "other", role: "adult" }, { profileId: "child", agentId: "child", role: "child" });
    await writeFile(f.files.rules, JSON.stringify(rules) + "\n", { mode: 0o600 });
    f.run();

    const { agents: { entries } } = JSON.parse(await readFile(f.files.nativeOutput, "utf8"));
    assert.deepEqual(entries.main.tools.allow.filter((tool: string) => tool === "browser" || tool.startsWith("web_")), ["web_search", "web_fetch"]);
    assert.equal(entries.other.tools.allow.includes("web_search"), false);
    assert.deepEqual(entries.child.tools.deny, ["*"]);
    assert.ok(entries["household-analysis"].tools.deny.includes("web_search"));
    assert.ok(entries["household-analysis"].tools.deny.includes("web_fetch"));
  } finally { await f.close(); }
});

test("real Slice3 generator can stage outputs while both runtime pointers target canonical authorities", { skip: !supported }, async () => {
  const f = await fixture(); try {
    await writeFile(f.files.control, "HARDY_HOME_DOMAINS_CONFIG=" + f.files.domains + "\n", { mode: 0o600 });
    f.run(["--native-active-path", f.files.native, "--domains-active-path", f.files.domains]);
    const native = JSON.parse(await readFile(f.files.nativeOutput, "utf8")), domains = JSON.parse(await readFile(f.files.domainsOutput, "utf8"));
    assert.equal(native.plugins.entries["hardy-household"].config.domainConfigurationPath, f.files.domains);
    assert.equal(native.plugins.entries["hardy-household"].config.controlEnvironmentPath, f.files.control);
    assert.equal(domains.execution.nativeConfigPath, f.files.native);
    assert.equal((await readFile(f.files.control, "utf8")).trim(), "HARDY_HOME_DOMAINS_CONFIG=" + native.plugins.entries["hardy-household"].config.domainConfigurationPath);
    await f.unchanged();
  } finally { await f.close(); }
});

test("real Slice3 generator refuses active-domain authority collisions and paths outside owner home", { skip: !supported }, async () => {
  const f = await fixture(); try {
    for (const target of [f.files.native, f.files.nativeOutput, f.files.rules, f.files.control]) {
      assert.throws(() => f.run(["--domains-active-path", target]), (error: unknown) =>
        String((error as { stderr?: Buffer }).stderr).includes("slice3_domains_authority_path_invalid"));
    }
    assert.throws(() => f.run(["--native-active-path", path.join(f.root, "canonical-native.json"), "--domains-active-path", path.join(f.root, "canonical-native.json")]),
      (error: unknown) => String((error as { stderr?: Buffer }).stderr).includes("slice3_domains_authority_path_invalid"));
    assert.throws(() => f.run(["--domains-active-path", "/tmp/unowned-domain-authority.json"]),
      (error: unknown) => String((error as { stderr?: Buffer }).stderr).includes("domain_prepare_path_outside_owner_home"));
    await assert.rejects(readFile(f.files.nativeOutput)); await assert.rejects(readFile(f.files.domainsOutput)); await f.unchanged();
  } finally { await f.close(); }
});

test("Slice3 preparation fills missing bounded attachment fields and preserves helper model",{skip:!supported},async()=>{
  const f=await fixture();try{
    const native=JSON.parse(await readFile(f.files.native,"utf8"));native.tools={sessions_spawn:{attachments:{enabled:true}}};
    native.agents.entries["household-analysis"]={model:{primary:"ollama/fixture-local",fallbacks:[]}};
    await writeFile(f.files.native,JSON.stringify(native)+"\n",{mode:0o600});f.run();
    const saved=JSON.parse(await readFile(f.files.nativeOutput,"utf8"));
    assert.deepEqual(saved.tools.sessions_spawn.attachments,{enabled:true,maxFiles:32,maxTotalBytes:16777216,maxFileBytes:16777216,retainOnSessionKeep:true});
    assert.deepEqual(saved.agents.entries["household-analysis"].model,native.agents.entries["household-analysis"].model);
    assert.deepEqual(JSON.parse(await readFile(f.files.native,"utf8")),native);
  }finally{await f.close();}
});
test("Slice3 preparation refuses conflicting explicit attachment policy",{skip:!supported},async()=>{
  const f=await fixture();try{
    for(const attachments of [{enabled:false},{enabled:true,maxFiles:50},{enabled:true,unexpected:true}]){
      const native=JSON.parse(await readFile(f.files.native,"utf8"));native.tools={sessions_spawn:{attachments}};
      await writeFile(f.files.native,JSON.stringify(native)+"\n",{mode:0o600});
      assert.throws(()=>f.run(),(error:unknown)=>String((error as {stderr?:Buffer}).stderr).includes("slice3_existing_spawn_attachments_requires_explicit_merge"));
      await assert.rejects(readFile(f.files.nativeOutput));await assert.rejects(readFile(f.files.domainsOutput));
      assert.deepEqual(JSON.parse(await readFile(f.files.native,"utf8")),native);
    }
  }finally{await f.close();}
});
