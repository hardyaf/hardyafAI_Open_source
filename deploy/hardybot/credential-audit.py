#!/usr/bin/env python3
"""Content-free activation gate for the protected Connections ingress."""
import argparse
import hashlib
import json
import os
import pathlib
import stat
import subprocess
import sys

ROOT = pathlib.Path("/opt/hardy-home-credentials")
CONFIG = pathlib.Path("/etc/hardy-home-credentials/openclaw.json")
DOMAINS = pathlib.Path("/etc/hardy-home-credentials/domains.json")
STATE = pathlib.Path("/var/lib/hardy-home-credentials")
ATTESTATION = pathlib.Path("/run/hardy-home-credential-policy/gateway.json")
NATIVE_PACKAGE = ROOT / "runtime/lib/node_modules/openclaw"
NATIVE_PATCH = ROOT / "source/deploy/hardybot/patches/native-context-budget.json"
RAW = {"exec", "process", "read", "write", "edit", "apply_patch", "browser", "gateway",
       "nodes", "computer", "screen", "code_execution", "code_exec"}
META = {"get_goal", "create_goal", "update_goal", "sessions_spawn", "sessions_yield",
        "session_status", "subagents", "sessions_send", "tool_search", "tool_describe",
        "tool_call", "progress_card", "web_search", "web_fetch"}

def workshop_policy(agent, workshop):
    """The owner lab is online and unrestricted internally; host credentials stay outside."""
    if not isinstance(workshop, dict):
        return False
    data = workshop.get("dataRoot")
    if not isinstance(data, str) or not pathlib.Path(data).is_absolute() or not workshop.get("ownerProfileId"):
        return False
    sandbox = agent.get("sandbox", {}); docker = sandbox.get("docker", {}); tools = agent.get("tools", {})
    binds = [data + "/system/" + name + ":/" + name + ":rw" for name in ["usr", "etc", "var", "opt", "tmp", "root"]]
    binds.append(data + "/reference:/reference:ro")
    return (sandbox.get("mode") == "all" and sandbox.get("backend") == "docker"
        and sandbox.get("scope") == "agent" and sandbox.get("workspaceAccess") == "none"
        and sandbox.get("workspaceRoot") == workshop.get("sandboxRoot")
        and docker.get("image") == workshop.get("image") and docker.get("binds") == binds
        and docker.get("network") == "bridge" and docker.get("readOnlyRoot") is False
        and docker.get("user") == "0:0" and docker.get("gpus") == "driver=cdi,device=nvidia.com/gpu=all"
        and not any(key in docker for key in ["memory", "memorySwap", "cpus", "pidsLimit", "setupCommand"])
        and docker.get("env") == {"HOME": "/workspace", "PYTHONUNBUFFERED": "1", "HARDY_WORKSHOP": "1"}
        and sandbox.get("browser", {}).get("allowHostControl") is False
        and sandbox.get("browser", {}).get("binds") == []
        and tools.get("fs", {}).get("workspaceOnly") is False
        and tools.get("exec", {}).get("host") == "sandbox" and tools.get("exec", {}).get("mode") == "full")


def policy_checks(config, workshop=None):
    """Reject unreviewed tool routes, native escapes and unsandboxed raw tools."""
    checks = {}
    if workshop is None:
        try:
            workshop = json.loads(DOMAINS.read_text()).get("execution", {}).get("workshop")
        except (OSError, ValueError):
            pass
    agents = config.get("agents", {})
    entries = agents.get("entries", {})
    checks["explicit_agent_roster"] = bool(entries) and not agents.get("list")
    checks["no_acp_dispatch"] = not config.get("acp", {}).get("enabled", False)
    checks["no_default_runtime_escape"] = agents.get("defaults", {}).get("runtime", {}).get("type") != "acp" if isinstance(agents.get("defaults", {}).get("runtime", {}), dict) else False
    inherited = agents.get("defaults", {}).get("sandbox", {}).get("docker", {})
    checks["sandbox_defaults_safe"] = (not inherited.get("binds", []) and all(key in {"LANG", "LC_ALL", "HOME", "PYTHONDONTWRITEBYTECODE", "PYTHONUNBUFFERED", "MPLCONFIGDIR"} for key in inherited.get("env", {})))
    checks["elevated_disabled"] = config.get("tools", {}).get("elevated", {}).get("enabled") is False
    for name, agent in entries.items():
        tools = agent.get("tools", {})
        denied = tools.get("deny", [])
        if "*" in denied:
            checks[name + "_tools"] = True
            continue
        allowed = tools.get("allow")
        checks[name + "_explicit_tools"] = isinstance(allowed, list) and bool(allowed)
        if not isinstance(allowed, list):
            continue
        checks[name + "_known_tools"] = all(
            isinstance(tool, str) and (tool in META or tool in RAW or tool.startswith("household_"))
            and "*" not in tool and ":" not in tool for tool in allowed)
        checks[name + "_elevated_disabled"] = tools.get("elevated", {}).get("enabled") is False
        checks[name + "_no_native_escape"] = agent.get("runtime", {}).get("type") != "acp" if isinstance(agent.get("runtime", {}), dict) else False
        active_raw = set(allowed) & RAW - set(denied)
        if active_raw:
            sandbox = agent.get("sandbox", {})
            docker = sandbox.get("docker", {})
            execution = tools.get("exec", {})
            if name == "main" and workshop:
                checks[name + "_workshop_separation"] = workshop_policy(agent, workshop)
                checks[name + "_workshop_no_inherited_limits"] = not any(key in inherited for key in ["memory", "memorySwap", "cpus", "pidsLimit", "setupCommand"])
            else:
                checks[name + "_offline_sandbox"] = (
                sandbox.get("mode") == "all" and sandbox.get("backend", "docker") == "docker"
                and sandbox.get("workspaceAccess") == "none"
                and docker.get("network") == "none" and docker.get("readOnlyRoot") is True
                and docker.get("binds", []) == [] and "ALL" in docker.get("capDrop", [])
                and not sandbox.get("browser", {}).get("enabled", False)
                and not (active_raw - {"read", "write", "edit", "apply_patch", "exec", "process"})
                and ("exec" not in active_raw or execution.get("host") == "sandbox")
                and tools.get("fs", {}).get("workspaceOnly") is True)
        else:
            checks[name + "_raw_denied"] = RAW.issubset(set(denied))
        if "sessions_spawn" in allowed:
            children = agent.get("subagents", {}).get("allowAgents")
            checks[name + "_spawn_roster"] = (
                isinstance(children, list) and bool(children)
                and all(child in entries and "*" not in child for child in children))
    return checks

def protected(path, private=False):
    """Every ancestor is root-owned, with no symlink or non-root write access."""
    path = pathlib.Path(path)
    try:
        for part in [path, *path.parents]:
            value = part.lstat()
            if stat.S_ISLNK(value.st_mode) or value.st_uid != 0 or value.st_mode & 0o022:
                return False
        return not private or path.stat().st_mode & 0o007 == 0
    except OSError:
        return False

def config_digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def autonomy_patch_checks():
    manifest = ROOT / "source/deploy/hardybot/patches/autonomy-runtime.json"
    if not manifest.exists(): return {}
    valid = protected(manifest) and not manifest.is_symlink()
    try:
        data = json.loads(manifest.read_text()); rows = data["files"]
        valid = valid and data["nativeVersion"] == "2026.9.8" and len(rows) == 10
        seen = set()
        for row in rows:
            relative = pathlib.PurePosixPath(row["path"]); package = row["package"]
            valid = valid and package in {"openclaw", "searxng"} and not relative.is_absolute() and ".." not in relative.parts and relative.parts[0] == "dist" and relative.suffix == ".mjs"
            key = (package, str(relative)); valid = valid and key not in seen; seen.add(key)
            target = (NATIVE_PACKAGE if package == "openclaw" else ROOT / "plugin-load/1") / relative
            valid = valid and protected(target) and not target.is_symlink() and config_digest(target) == row["afterSha256"]
    except (OSError, ValueError, KeyError, TypeError): valid = False
    return {"autonomy_native_provider_overlays_pinned": bool(valid)}

def overlay_expected(relative, base_hash):
    manifest = ROOT / "source/deploy/hardybot/patches/autonomy-runtime.json"
    if not manifest.exists(): return base_hash
    if not all(autonomy_patch_checks().values()): return base_hash
    for row in json.loads(manifest.read_text())["files"]:
        if row["package"] == "openclaw" and row["path"] == relative:
            if row["beforeSha256"] != base_hash: raise ValueError("autonomy_base_pin_mismatch")
            return row["afterSha256"]
    return base_hash


def native_patch_checks(package_root, manifest_path):
    """Verify the exact protected patch; this adds no account or execution authority."""
    checks = {"native_patch_manifest": False, "native_patch_version": False,
              "native_patch_files_protected": False, "native_patch_hashes": False}
    try:
        package_root, manifest_path = pathlib.Path(package_root), pathlib.Path(manifest_path)
        if not protected(manifest_path) or manifest_path.is_symlink():
            return checks
        manifest = json.loads(manifest_path.read_text())
        patch_name = manifest.get("patchFile", manifest_path.with_suffix(".patch").name)
        if (not isinstance(patch_name, str) or pathlib.PurePosixPath(patch_name).name != patch_name
                or not patch_name.endswith(".patch")):
            return checks
        patch_path = manifest_path.parent / patch_name
        checks["native_patch_manifest"] = (
            protected(patch_path) and not patch_path.is_symlink()
            and config_digest(patch_path) == manifest.get("patchSha256"))
        package_path = package_root / "package.json"
        if not protected(package_path) or package_path.is_symlink():
            return checks
        package = json.loads(package_path.read_text())
        checks["native_patch_version"] = (
            package.get("name") == "openclaw"
            and package.get("version") == manifest.get("upstreamVersion") == "2026.9.8")
        rows = manifest.get("files")
        if not isinstance(rows, list) or not rows:
            return checks
        seen = set()
        paths_safe, hashes_match = True, True
        for row in rows:
            if not isinstance(row, dict):
                return checks
            relative = row.get("path")
            if not isinstance(relative, str):
                return checks
            pure = pathlib.PurePosixPath(relative)
            if (pure.is_absolute() or ".." in pure.parts or str(pure) != relative
                    or len(pure.parts) < 2 or pure.parts[0] != "dist"
                    or pure.suffix != ".mjs" or relative in seen):
                return checks
            seen.add(relative)
            target = package_root / relative
            target_safe = protected(target) and not target.is_symlink()
            paths_safe = paths_safe and target_safe
            hashes_match = hashes_match and target_safe and config_digest(target) == overlay_expected(relative, row.get("afterSha256"))
        checks["native_patch_files_protected"] = paths_safe
        checks["native_patch_hashes"] = hashes_match
    except (OSError, ValueError, TypeError, KeyError):
        pass
    return checks

def system_gateway():
    result = subprocess.run(
        ["/usr/bin/systemctl", "show", "openclaw-gateway.service",
         "--property=MainPID,ActiveState,FragmentPath,NeedDaemonReload"],
        capture_output=True, text=True, timeout=5, check=True,
        env={"PATH": "/usr/bin:/bin", "LANG": "C"})
    return dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)

def runtime_entry_matches(cmdline, environment, node_path, config_path, package_root):
    if (not cmdline or cmdline[0] != str(node_path).encode()
            or environment.get(b"OPENCLAW_CONFIG_PATH") != str(config_path).encode()):
        return False
    if any(value in {b"-e", b"--eval", b"-p", b"--print"} for value in cmdline[1:]):
        return False
    scripts = []
    for value in cmdline[1:]:
        text = value.decode("utf-8", errors="replace")
        path = pathlib.Path(text)
        if path.is_absolute() and path.suffix in {".js", ".mjs"}:
            scripts.append(path)
    return bool(scripts) and scripts[0].resolve().is_relative_to(pathlib.Path(package_root).resolve()) and protected(scripts[0])

def workshop_patch_checks():
    try:
        if not json.loads(DOMAINS.read_text()).get("execution", {}).get("workshop"):
            return {}
        manifest = ROOT / "source/deploy/hardybot/patches/workshop-runtime.json"
        data = json.loads(manifest.read_text())
        rows = data.get("files", [])
        expected = {"dist/bash-tools-3n5rTZUL.mjs", "dist/fs-bridge-CkHTzWVb.mjs", "dist/household-workshop-fs-20261127.mjs"}
        valid = protected(manifest) and data.get("nativeVersion") == "2026.9.8" and len(rows) == 3 and {row.get("path") for row in rows} == expected
        for row in rows:
            relative = pathlib.PurePosixPath(row["path"])
            target = NATIVE_PACKAGE / relative
            valid = valid and relative.parts[0] == "dist" and ".." not in relative.parts and not relative.is_absolute()
            valid = valid and protected(target) and config_digest(target) == row["afterSha256"]
        return {"workshop_native_compatibility_pinned": bool(valid)}
    except (OSError, ValueError, KeyError):
        return {"workshop_native_compatibility_pinned": False}


def attest(pid):
    if os.geteuid() != 0:
        raise PermissionError("root_required")
    expected = str(ROOT / "runtime/bin/node")
    cmdline = pathlib.Path("/proc", str(pid), "cmdline").read_bytes().split(b"\0")
    environment = dict(item.split(b"=", 1) for item in pathlib.Path(
        "/proc", str(pid), "environ").read_bytes().split(b"\0") if b"=" in item)
    if not runtime_entry_matches(cmdline, environment, expected, CONFIG, NATIVE_PACKAGE):
        raise ValueError("gateway_runtime_mismatch")
    checks = {**policy_checks(json.loads(CONFIG.read_text())), **workshop_patch_checks(), **autonomy_patch_checks()}
    if not checks or not all(checks.values()):
        raise ValueError("native_policy_unsafe")
    patch_checks = native_patch_checks(NATIVE_PACKAGE, NATIVE_PATCH)
    if not all(patch_checks.values()):
        raise ValueError("native_patch_unverified")
    ATTESTATION.parent.mkdir(mode=0o755, exist_ok=True)
    if not protected(ATTESTATION.parent):
        raise ValueError("attestation_directory_unsafe")
    temporary = ATTESTATION.with_suffix(".new")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o644)
    with os.fdopen(descriptor, "w") as output:
        json.dump({"pid": pid, "configSha256": config_digest(CONFIG), "domainsSha256": config_digest(DOMAINS),
                   "nativePatchSha256": config_digest(NATIVE_PATCH)}, output)
        output.write("\n")
    os.replace(temporary, ATTESTATION)

def inspect():
    checks = {}
    try:
        config = json.loads(CONFIG.read_text())
        checks.update(policy_checks(config))
        checks.update(workshop_patch_checks())
        checks.update(native_patch_checks(NATIVE_PACKAGE, NATIVE_PATCH))
        checks["root_config"] = protected(CONFIG, private=True)
        checks["root_domains"] = protected(DOMAINS, private=True) and stat.S_IMODE(DOMAINS.stat().st_mode) == 0o440
        checks["root_snapshot"] = protected(ROOT / "source/services/household-control/src/connections/server.ts")
        checks["root_auditor"] = protected(ROOT / "source/deploy/hardybot/credential-audit.py")
        checks["root_runtime"] = protected(ROOT / "runtime/bin/node")
        checks["root_unit"] = protected(pathlib.Path("/etc/systemd/system/hardy-home-credentials.service"))
        checks["private_state"] = (
            STATE.stat().st_uid == os.geteuid() and STATE.stat().st_mode & 0o077 == 0
            and os.geteuid() != 0)
        checks["attestation_protected"] = protected(ATTESTATION)
        gateway = system_gateway()
        proof = json.loads(ATTESTATION.read_text())
        checks["gateway_system_unit"] = (
            gateway.get("ActiveState") == "active" and gateway.get("NeedDaemonReload") == "no"
            and gateway.get("FragmentPath") == "/etc/systemd/system/openclaw-gateway.service"
            and int(gateway.get("MainPID", "0")) == proof.get("pid")
            and proof.get("configSha256") == config_digest(CONFIG)
            and proof.get("domainsSha256") == config_digest(DOMAINS)
            and proof.get("nativePatchSha256") == config_digest(NATIVE_PATCH))
        for filename in ("server-chain.pem", "server.key"):
            value = (STATE / filename).lstat()
            checks["private_" + filename] = (
                stat.S_ISREG(value.st_mode) and value.st_uid == os.geteuid()
                and value.st_nlink == 1 and value.st_mode & 0o077 == 0)
    except (OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError):
        checks["complete_evidence"] = False
    return {"ready": bool(checks) and all(checks.values()), "checks": checks,
            "reason": None if checks and all(checks.values()) else "isolation_unavailable"}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--policy-only", type=pathlib.Path)
    parser.add_argument("--attest-runtime", type=int)
    args = parser.parse_args()
    if args.attest_runtime:
        attest(args.attest_runtime)
        return 0
    if args.policy_only:
        checks = policy_checks(json.loads(args.policy_only.read_text()))
        result = {"ready": bool(checks) and all(checks.values()), "checks": checks}
    else:
        result = inspect()
    print(json.dumps(result, sort_keys=True))
    return 0 if result["ready"] else 1

if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        print('{"ready":false,"reason":"isolation_unavailable","checks":{"audit_completed":false}}')
        sys.exit(1)
