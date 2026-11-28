#!/usr/bin/env python3
"""Install the protected ingress without copying or restoring business data."""
import argparse
import datetime
import grp
import json
import os
import pathlib
import pwd
import shutil
import ipaddress
import importlib.util
import platform
from urllib.parse import urlsplit
import stat
import subprocess
import sys
import tempfile

ROOT = pathlib.Path("/opt/hardy-home-credentials")
CONF = pathlib.Path("/etc/hardy-home-credentials")
STATE = pathlib.Path("/var/lib/hardy-home-credentials")
POLICY = pathlib.Path("/run/hardy-home-credential-policy")
OWNER = None
OPERATOR_HOME = None
SOURCE = None
BIND_ADDRESS = None
PUBLIC_ORIGIN = None
SERVICE = "hardy-credentials"
REUSE_RUNTIME_INODES = False

def run(argv, **kwargs):
    return subprocess.run(argv, check=True, **kwargs)

def owner_command(argv, **kwargs):
    uid = pwd.getpwnam(OWNER).pw_uid
    return run(["/usr/sbin/runuser", "-u", OWNER, "--", "/usr/bin/env",
                "XDG_RUNTIME_DIR=/run/user/" + str(uid),
                "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/" + str(uid) + "/bus",
                *argv], **kwargs)

def parse_env(path):
    values = {}
    for line in path.read_text().splitlines():
        if line and not line.lstrip().startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
                value = value[1:-1]
            values[key] = value
    return values

def control_url(environment):
    address = ipaddress.ip_address(environment.get("BIND_ADDRESS", "127.0.0.1"))
    if address.is_unspecified:
        address = ipaddress.ip_address("::1" if address.version == 6 else "127.0.0.1")
    local_networks = (
        ipaddress.ip_network("127.0.0.0/8"), ipaddress.ip_network("10.0.0.0/8"),
        ipaddress.ip_network("172.16.0.0/12"), ipaddress.ip_network("192.168.0.0/16"),
        ipaddress.ip_network("::1/128"), ipaddress.ip_network("fc00::/7"),
    )
    if not any(address in network for network in local_networks if address.version == network.version):
        raise RuntimeError("private_control_address_required")
    port = int(environment.get("PORT", "4317"))
    if not 1 <= port <= 65535:
        raise RuntimeError("valid_control_port_required")
    authority = "[" + str(address) + "]" if address.version == 6 else str(address)
    return "http://" + authority + ":" + str(port)

def write_env(path, values, mode=0o640):
    lines = []
    for key, value in values.items():
        escaped = str(value).replace("\\", "\\\\").replace('"', '\\"')
        lines.append(key + '="' + escaped + '"\n')
    path.write_text("".join(lines))
    path.chmod(mode)

def replace_private_file(path, text):
    current = path.stat()
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, prefix=".credential-env-", delete=False) as output:
            temporary = pathlib.Path(output.name)
            output.write(text)
            output.flush()
            os.fsync(output.fileno())
        temporary.chmod(0o600)
        os.chown(temporary, current.st_uid, current.st_gid)
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()

def update_environment(path, updates, removals):
    # Preserve unrelated environment lines byte-for-byte. Existing protected
    # consumers strip quotes without decoding escapes.
    lines = path.read_text().splitlines(keepends=True)
    keys = set(updates) | set(removals)
    retained = [line for line in lines if line.split("=", 1)[0] not in keys]
    text = "".join(retained)
    if text and not text.endswith("\n"):
        text += "\n"
    text += "".join(key + "=" + value + "\n" for key, value in updates.items())
    replace_private_file(path, text)

def rewrite_runtime_dependencies(root):
    installed_runtime = (OPERATOR_HOME / ".openclaw/tools/node/bin/node").resolve().parent.parent
    installed_package = (installed_runtime / "lib/node_modules/openclaw").resolve()
    for dependency in root.rglob("openclaw"):
        if dependency.parent.name != "node_modules" or not dependency.is_symlink():
            continue
        if dependency.resolve() != installed_package:
            continue
        dependency.unlink()
        dependency.symlink_to(ROOT / "runtime/lib/node_modules/openclaw", target_is_directory=True)

def protect_tree(path):
    rewrite_runtime_dependencies(path)
    for directory, dirs, files in os.walk(path, followlinks=False):
        current = pathlib.Path(directory)
        os.chown(current, 0, 0)
        current.chmod(0o755)
        for name in dirs + files:
            item = current / name
            if item.is_symlink():
                if not item.resolve().is_relative_to(ROOT):
                    raise RuntimeError("snapshot_symlink_outside_protected_root")
                continue
            os.chown(item, 0, 0)
            mode = item.stat().st_mode
            item.chmod(0o755 if stat.S_ISDIR(mode) or mode & 0o111 else 0o644)

def private_copy(source, destination, uid, gid):
    if source.is_symlink() or not source.is_file():
        raise RuntimeError("private_input_invalid")
    shutil.copyfile(source, destination)
    destination.chmod(0o600)
    os.chown(destination, uid, gid)

def backup(path, root):
    destination = root / path.name
    if path.exists():
        shutil.copy2(path, destination)
        destination.chmod(0o600)

def apply_context_patch(snapshot_root):
    """Apply only to the protected snapshot; atomic replacements leave operator inodes intact."""
    snapshot_root = pathlib.Path(snapshot_root)
    deployment = snapshot_root / "source/deploy/hardybot"
    applier = deployment / "apply-native-context-patch.py"
    manifest = deployment / "patches/native-context-budget.json"
    for path in (applier, manifest):
        if not path.is_file() or path.is_symlink():
            raise RuntimeError("native_context_patch_bundle_missing")
    # A known post-V5 overlay is an accepted successor, never an excuse to install stock.
    overlay = deployment / "autonomy-runtime-patch.py"
    if overlay.is_file():
        import runpy
        ns = runpy.run_path(str(overlay)); runtime = snapshot_root / "runtime/lib/node_modules/openclaw"
        if ns["installed"](runtime, snapshot_root / "source"): return
    run(["/usr/bin/python3", "-I", str(applier),
         "--package-root", str(snapshot_root / "runtime/lib/node_modules/openclaw"),
         "--manifest", str(manifest), "--apply"])
    if overlay.is_file():
        writer = runpy.run_path(str(applier))
        for relative, body in ns["payloads"](runtime, snapshot_root / "source").items():
            target=runtime/relative
            writer["atomic_write"](target,body,writer["metadata"](target))

def snapshot(source):
    if ROOT.exists() and any(ROOT.iterdir()):
        raise RuntimeError("protected_snapshot_already_exists")
    ROOT.mkdir(mode=0o755, exist_ok=True)
    destination = ROOT / "source"
    for relative in ("services/household-control", "tools", "apps/hardy-home-web/src",
                     "apps/hardy-home-web/build.mjs", "apps/kitchen-display/src/signing.mjs", "integrations/uplift/operations.json",
                     "plugins/household-domains", "skills", "deploy/hardybot"):
        original = source / relative
        target = destination / relative
        if original.is_dir():
            shutil.copytree(original, target, symlinks=True)
        elif original.is_file():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(original, target)
        else:
            raise RuntimeError("source_component_missing:" + relative)
    node = (OPERATOR_HOME / ".openclaw/tools/node/bin/node").resolve()
    runtime = node.parent.parent
    if REUSE_RUNTIME_INODES:
        if runtime.stat().st_dev != ROOT.stat().st_dev:
            raise RuntimeError("runtime_hardlinks_require_same_filesystem")
        # SecretRef exec-provider validation requires the original interpreter
        # to retain its user owner. Its protected executable has a distinct inode.
        def copy_runtime_file(original, target):
            if pathlib.Path(original) == runtime / "bin/node":
                return shutil.copy2(original, target)
            return os.link(original, target)
        # Remaining installed static libraries share pinned, root-owned inodes.
        shutil.copytree(runtime, ROOT / "runtime", copy_function=copy_runtime_file, symlinks=True)
    else:
        shutil.copytree(runtime, ROOT / "runtime", symlinks=True)
    shutil.copytree(OPERATOR_HOME / ".openclaw/tools/bitwarden-connector", ROOT / "sdk", symlinks=False)

    web_root = destination / "apps/hardy-home-web"
    run([str(ROOT / "runtime/bin/node"), str(web_root / "build.mjs")],
        cwd=web_root, env={"PATH": str(ROOT / "runtime/bin") + ":/usr/bin:/bin"})
    public_ca = source / "apps/hardy-home-web/dist/household-ca.cer"
    if public_ca.is_file() and not public_ca.is_symlink():
        shutil.copyfile(public_ca, web_root / "dist/household-ca.cer")
    protect_tree(ROOT)
    apply_context_patch(ROOT)

def tighten(config, copy_plugins=True):
    raw = ["exec", "process", "read", "write", "edit", "apply_patch", "browser",
           "gateway", "nodes", "computer", "screen", "code_execution", "code_exec"]
    config.setdefault("acp", {})["enabled"] = False
    config.setdefault("tools", {}).setdefault("elevated", {})["enabled"] = False
    config["tools"].setdefault("exec", {})["host"] = "sandbox"
    config["tools"]["exec"]["mode"] = "deny"
    for name, agent in config["agents"]["entries"].items():
        tools = agent.setdefault("tools", {})
        allowed = tools.get("allow", [])
        for existing, discovery in (("household_email_read", "household_email_connections"),
                                    ("household_calendar_list", "household_calendar_connections"),
                                    ("household_diagnostics_evidence", "household_diagnostics_system_status")):
            if existing in allowed and discovery not in allowed:
                allowed.append(discovery)
        tools.setdefault("elevated", {})["enabled"] = False
        if name in {"household-analysis"} or name == "main" and agent.get("sandbox", {}).get("docker", {}).get("gpus") == "driver=cdi,device=nvidia.com/gpu=all":
            tools.setdefault("exec", {})["host"] = "sandbox"
            tools["exec"]["mode"] = "full"
        elif name == "household-diagnostics":
            pass
        elif "*" not in tools.get("deny", []):
            tools["deny"] = sorted(set(tools.get("deny", []) + raw))
    config["plugins"]["entries"]["hardy-household"]["config"]["domainConfigurationPath"] = str(CONF / "domains.json")
    paths = config.get("plugins", {}).get("load", {}).get("paths", [])
    for index, original in enumerate(paths):
        original_path = pathlib.Path(original).resolve()
        if original_path == (SOURCE / "plugins/household-domains").resolve():
            paths[index] = str(ROOT / "source/plugins/household-domains")
        else:
            destination = ROOT / "plugin-load" / str(index)
            if copy_plugins:
                shutil.copytree(original_path, destination, symlinks=True)
            paths[index] = str(destination)
    overlay = ROOT / "source/deploy/hardybot/autonomy-runtime-patch.py"
    if overlay.is_file():
        import runpy
        ns=runpy.run_path(str(overlay));ns["configure"](config)
        if copy_plugins:
            writer=runpy.run_path(str(ROOT / "source/deploy/hardybot/apply-native-context-patch.py"))
            for relative,body in ns["payloads"](ROOT/"plugin-load/1",ROOT/"source","searxng").items():
                target=ROOT/"plugin-load/1"/relative
                writer["atomic_write"](target,body,writer["metadata"](target))
    return config

def prepare_skill_cache(owner):
    cache = CONF / "plugin-skills"
    if cache.is_symlink() or cache.exists() and not cache.is_dir():
        raise RuntimeError("plugin_skill_cache_unsafe")
    cache.mkdir(mode=0o700, exist_ok=True)
    account = pwd.getpwnam(owner)
    os.chown(cache, account.pw_uid, account.pw_gid)
    cache.chmod(0o700)

def prepare(source):
    if not shutil.which("setfacl"):
        raise RuntimeError("install_ubuntu_acl_package_first")
    if not (source / "services/household-control/src/connections/server.ts").is_file():
        raise RuntimeError("credential_server_missing")
    if not (source / "apps/hardy-home-web/src/connections.mjs").is_file():
        raise RuntimeError("connections_ui_source_missing")
    home = pathlib.Path(pwd.getpwnam(OWNER).pw_dir)
    control_env = home / ".config/hardy-home/control.env"
    environment = parse_env(control_env)
    proxy_target = control_url(environment)
    database = pathlib.Path(environment["HARDY_HOME_DATABASE"]).resolve()
    if not database.is_file():
        raise RuntimeError("existing_canonical_database_required")
    if database != home / ".local/share/hardy-home/household-control.sqlite":
        raise RuntimeError("unexpected_canonical_database")
    original_config = home / ".openclaw/openclaw.json"
    config = json.loads(original_config.read_text())
    if not config.get("agents", {}).get("entries"):
        raise RuntimeError("explicit_agent_roster_required")
    uid = pwd.getpwnam(OWNER).pw_uid
    gateway_pid = int(owner_command(
        ["/usr/bin/systemctl", "--user", "show", "openclaw-gateway.service", "--property=MainPID", "--value"],
        capture_output=True, text=True).stdout.strip())
    if gateway_pid <= 0:
        raise RuntimeError("running_gateway_required")
    process_environment = dict(
        item.split(b"=", 1) for item in pathlib.Path("/proc", str(gateway_pid), "environ")
        .read_bytes().split(b"\0") if b"=" in item)
    current_unit = owner_command(
        ["/usr/bin/systemctl", "--user", "cat", "openclaw-gateway.service"],
        capture_output=True, text=True).stdout
    snapshot(source)
    CONF.mkdir(mode=0o750, exist_ok=True)
    backup_root = STATE / ("rollback-" + datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
    backup_root.mkdir(parents=True, mode=0o700)
    STATE.chmod(0o700)
    for item in (control_env, original_config, home / ".config/hardy-home/domains.json"):
        backup(item, backup_root)
    (backup_root / "openclaw-gateway.user.service").write_text(current_unit)
    (backup_root / "openclaw-gateway.user.service").chmod(0o600)
    try:
        account = pwd.getpwnam(SERVICE)
    except KeyError:
        run(["/usr/sbin/useradd", "--system", "--home-dir", str(STATE),
             "--shell", "/usr/sbin/nologin", SERVICE])
        account = pwd.getpwnam(SERVICE)
    os.chown(STATE, account.pw_uid, account.pw_gid)
    os.chown(CONF, 0, account.pw_gid)
    CONF.chmod(0o750)
    private_copy(pathlib.Path(environment["HARDY_HOME_TLS_CERTIFICATE"]),
                 STATE / "server-chain.pem", account.pw_uid, account.pw_gid)
    private_copy(pathlib.Path(environment["HARDY_HOME_TLS_PRIVATE_KEY"]),
                 STATE / "server.key", account.pw_uid, account.pw_gid)
    # Same canonical SQLite authority. Traverse only named ancestors, and preserve
    # per-user ownership while granting the daemon inherited WAL/SHM permissions.
    for parent in reversed(database.parent.parents):
        if parent not in (pathlib.Path("/"), pathlib.Path("/home")):
            run(["/usr/bin/setfacl", "-m", "u:" + SERVICE + ":x", str(parent)])
    run(["/usr/bin/setfacl", "-m", "u:" + SERVICE + ":rwx,d:u:" + SERVICE + ":rwx,d:u:" + OWNER + ":rwx", str(database.parent)])
    for suffix in ("", "-wal", "-shm"):
        item = pathlib.Path(str(database) + suffix)
        if item.exists():
            run(["/usr/bin/setfacl", "-m", "u:" + SERVICE + ":rw", str(item)])
    domains = json.loads((home / ".config/hardy-home/domains.json").read_text())
    domains["execution"]["nativeConfigPath"] = str(CONF / "openclaw.json")
    domains["execution"]["openclawBinary"] = str(ROOT / "runtime/bin/openclaw")
    domains["execution"]["skillsRoot"] = str(ROOT / "source/skills")
    (CONF / "domains.json").write_text(json.dumps(domains, indent=2) + "\n")
    os.chown(CONF / "domains.json", 0, pwd.getpwnam(OWNER).pw_gid)
    (CONF / "domains.json").chmod(0o440)
    tightened = tighten(config)
    (CONF / "openclaw.json").write_text(json.dumps(tightened, indent=2) + "\n")
    os.chown(CONF / "openclaw.json", 0, account.pw_gid)
    (CONF / "openclaw.json").chmod(0o640)
    run(["/usr/bin/setfacl", "-m", "u:" + OWNER + ":x", str(CONF)])
    run(["/usr/bin/setfacl", "-m", "u:" + OWNER + ":r", str(CONF / "openclaw.json")])
    prepare_skill_cache(OWNER)
    managed = {}
    for key in ("DISCORD_BOT_TOKEN", "GOG_HOME", "GOG_KEYRING_BACKEND",
                "GOG_KEYRING_PASSWORD", "OLLAMA_API_KEY", "OPENCLAW_GATEWAY_TOKEN"):
        encoded = key.encode()
        if encoded in process_environment:
            managed[key] = process_environment[encoded].decode()
    write_env(CONF / "gateway.env", managed, 0o600)
    service_environment = {
        "PORT": "8443",
        "BIND_ADDRESS": BIND_ADDRESS,
        "HARDY_CREDENTIALS_DATABASE": str(database),
        "HARDY_CREDENTIALS_DOMAIN_CONFIG": str(CONF / "domains.json"),
        "HARDY_CREDENTIALS_PUBLIC_ORIGIN": PUBLIC_ORIGIN,
        "HARDY_CREDENTIALS_STATE_DIR": str(STATE),
        "HARDY_CREDENTIALS_CONTROL_URL": proxy_target,
        "HARDY_CREDENTIALS_CONSUMER_SOCKET": "/run/hardy-home-credentials/consumer.sock",
        "HARDY_CREDENTIALS_HOME_ROOT": str(ROOT / "source/apps/hardy-home-web/dist"),
        "HARDY_CREDENTIALS_PYTHON": str(ROOT / "sdk/bin/python"),
        "HARDY_CREDENTIALS_VAULT_SCRIPT": str(ROOT / "source/tools/bitwarden-connections.py"),
        "HARDY_CREDENTIALS_AUDIT": str(ROOT / "source/deploy/hardybot/credential-audit.py"),
        "TLS_CERTIFICATE": str(STATE / "server-chain.pem"),
        "TLS_PRIVATE_KEY": str(STATE / "server.key"),
    }
    write_env(CONF / "service.env", service_environment)
    os.chown(CONF / "service.env", 0, account.pw_gid)
    # Preserve the deployed stock service options and replace only immutable paths
    # and service ownership/environment, without changing sessions or model choice.
    runtime_before = str((OPERATOR_HOME / ".openclaw/tools/node/bin/node").resolve().parent.parent)
    original_command = next(line for line in current_unit.splitlines() if line.startswith("ExecStart="))
    command = original_command.replace(runtime_before, str(ROOT / "runtime"))
    command = command.replace(str(OPERATOR_HOME / ".openclaw/tools/node/bin/node"), str(ROOT / "runtime/bin/node"))
    unit = [
        "[Unit]", "Description=OpenClaw Gateway with protected credential policy",
        "After=network-online.target", "Wants=network-online.target", "",
        "[Service]", "Type=simple", "User=" + OWNER, "Group=" + grp.getgrgid(pwd.getpwnam(OWNER).pw_gid).gr_name,
        "WorkingDirectory=" + str(home), command, "Restart=always", "RestartSec=5",
        "RestartPreventExitStatus=78", "TimeoutStopSec=330", "TimeoutStartSec=60",
        "SuccessExitStatus=0 143", "OOMPolicy=continue", "KillMode=mixed",
        "EnvironmentFile=" + str(CONF / "gateway.env"),
        "Environment=HOME=" + str(home),
        "Environment=PATH=" + str(ROOT / "runtime/bin") + ":/usr/local/bin:/usr/bin:/bin",
        "Environment=OPENCLAW_CONFIG_PATH=" + str(CONF / "openclaw.json"),
        "Environment=OPENCLAW_GATEWAY_PORT=18789",
        "Environment=OPENCLAW_SYSTEMD_UNIT=openclaw-gateway.service",
        "Environment=OPENCLAW_SERVICE_MARKER=openclaw",
        "Environment=OPENCLAW_SERVICE_KIND=gateway",
        "ExecStartPost=+/usr/bin/python3 " + str(ROOT / "source/deploy/hardybot/credential-audit.py") + " --attest-runtime ${MAINPID}",
        "", "[Install]", "WantedBy=multi-user.target", "",
    ]
    pathlib.Path("/etc/systemd/system/openclaw-gateway.service").write_text("\n".join(unit))
    unit_template = (ROOT / "source/deploy/hardybot/credential-service.service").read_text()
    unit_template = unit_template.replace("@OWNER_GROUP@", grp.getgrgid(pwd.getpwnam(OWNER).pw_gid).gr_name)
    unit_template = unit_template.replace("@OPERATOR_HOME@", str(home))
    unit_template = unit_template.replace("@DATABASE_DIRECTORY@", str(database.parent))
    pathlib.Path("/etc/systemd/system/hardy-home-credentials.service").write_text(unit_template)
    pathlib.Path("/etc/systemd/system/openclaw-gateway.service").chmod(0o644)
    pathlib.Path("/etc/systemd/system/hardy-home-credentials.service").chmod(0o644)
    protect_tree(ROOT)
    POLICY.mkdir(mode=0o755, exist_ok=True)
    POLICY.chmod(0o755)
    (CONF / "deployment.json").write_text(json.dumps({
        "backup": str(backup_root), "database": str(database),
        "source": str(source), "owner": OWNER, "originalGatewayConfig": str(original_config),
        "runtimeInodesPromoted": REUSE_RUNTIME_INODES,
        "controlEnvironment": str(control_env), "domains": str(home / ".config/hardy-home/domains.json"),
    }, indent=2) + "\n")
    (CONF / "deployment.json").chmod(0o644)
    result = run(["/usr/bin/python3", str(ROOT / "source/deploy/hardybot/credential-audit.py"),
                  "--policy-only", str(CONF / "openclaw.json")], capture_output=True, text=True)
    try:
        owner_command([
            "/usr/bin/env", "HOME=" + str(home),
            "OPENCLAW_CONFIG_PATH=" + str(CONF / "openclaw.json"),
            "PATH=" + str(ROOT / "runtime/bin") + ":/usr/bin:/bin",
            str(ROOT / "runtime/bin/openclaw"), "config", "validate", "--json",
        ], capture_output=True, text=True, timeout=90)
        run(["/usr/bin/systemd-analyze", "verify",
             "/etc/systemd/system/openclaw-gateway.service",
             "/etc/systemd/system/hardy-home-credentials.service"],
            capture_output=True, text=True, timeout=30)
    except subprocess.SubprocessError:
        raise RuntimeError("prepared_configuration_validation_failed") from None
    print(result.stdout.strip())
    print("Protected artifacts prepared. The existing gateway and TLS listener are still active.")

def check_readiness(source):
    required = (
        "services/household-control/src/connections/server.ts",
        "services/household-control/node_modules",
        "tools/bitwarden-connections.py",
        "apps/hardy-home-web/src/connections.mjs",
        "apps/hardy-home-web/src/connections.css",
        "apps/hardy-home-web/build.mjs",
        "apps/kitchen-display/src/signing.mjs",
        "integrations/uplift/operations.json",
        "deploy/hardybot/credential-service.service",
    )
    checks = {
        "ubuntu": platform.freedesktop_os_release().get("ID") == "ubuntu",
        "acl_installed": bool(shutil.which("setfacl")),
        "source_components": all((source / relative).exists() for relative in required),
        "node_available": (OPERATOR_HOME / ".openclaw/tools/node/bin/node").is_file(),
        "sdk_available": False,
        "native_policy": False,
    }
    python = OPERATOR_HOME / ".openclaw/tools/bitwarden-connector/bin/python"
    if python.is_file():
        probe = subprocess.run(
            [str(python), "-I", "-c",
             "import importlib.metadata,sys;sys.exit(0 if importlib.metadata.version('bitwarden-sdk')=='2.1.0' else 1)"],
            capture_output=True, timeout=10, env={"PATH": "/usr/bin:/bin"})
        checks["sdk_available"] = probe.returncode == 0
    try:
        configuration = json.loads((OPERATOR_HOME / ".openclaw/openclaw.json").read_text())
        tightened = tighten(configuration, copy_plugins=False)
        spec = importlib.util.spec_from_file_location(
            "credential_audit", source / "deploy/hardybot/credential-audit.py")
        audit = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(audit)
        policy = audit.policy_checks(tightened)
        checks.update({"native_" + key: value for key, value in policy.items()})
        checks["native_policy"] = bool(policy) and all(policy.values())
    except (OSError, ValueError, KeyError, TypeError):
        checks["native_policy"] = False
    ready = all(checks.values())
    print(json.dumps({"ready": ready, "checks": checks}, sort_keys=True))
    return 0 if ready else 1

def rollback():
    metadata = json.loads((CONF / "deployment.json").read_text())
    control = pathlib.Path(metadata["controlEnvironment"])
    previous = pathlib.Path(metadata["backup"]) / "control.env"
    keys = {
        "HARDY_HOME_TLS_CERTIFICATE", "HARDY_HOME_TLS_PRIVATE_KEY", "HARDY_HOME_TLS_PORT",
        "HARDY_HOME_DOMAINS_CONFIG", "OPENCLAW_CONFIG_PATH",
        "HARDY_CREDENTIALS_CONSUMER_SOCKET", "PATH",
    }
    original_lines = previous.read_text().splitlines(keepends=True)
    original_settings = [line for line in original_lines if line.split("=", 1)[0] in keys]
    current_lines = control.read_text().splitlines(keepends=True)
    retained = [line for line in current_lines if line.split("=", 1)[0] not in keys]
    restored = "".join(retained)
    if restored and not restored.endswith("\n"):
        restored += "\n"
    restored += "".join(original_settings)
    for unit in ("hardy-home-credentials.service", "openclaw-gateway.service"):
        subprocess.run(["/usr/bin/systemctl", "disable", "--now", unit], check=False)
    replace_private_file(control, restored)
    account = pwd.getpwnam(OWNER)
    os.chown(control, account.pw_uid, account.pw_gid)
    owner_command(["/usr/bin/systemctl", "--user", "daemon-reload"])
    owner_command(["/usr/bin/systemctl", "--user", "enable", "--now", "openclaw-gateway.service"])
    owner_command(["/usr/bin/systemctl", "--user", "restart", "household-control.service"])
    print("Retained user gateway and TLS settings restored. Current database, vault state and protected artifacts were retained.")

def activate():
    metadata = json.loads((CONF / "deployment.json").read_text())
    try:
        control_env = pathlib.Path(metadata["controlEnvironment"])
        # Keep current provider/business configuration. Only change the effective
        # native configuration pointer, never restore an earlier SQLite database.
        domains_path = pathlib.Path(metadata["domains"])
        domains = json.loads(domains_path.read_text())
        domains["execution"]["nativeConfigPath"] = str(CONF / "openclaw.json")
        domains["execution"]["openclawBinary"] = str(ROOT / "runtime/bin/openclaw")
        domains["execution"]["skillsRoot"] = str(ROOT / "source/skills")
        root_domains = CONF / "domains.json"
        root_domains.write_text(json.dumps(domains, indent=2) + "\n")
        os.chown(root_domains, 0, pwd.getpwnam(OWNER).pw_gid)
        root_domains.chmod(0o440)
        update_environment(control_env, {
            "HARDY_HOME_DOMAINS_CONFIG": str(root_domains),
            "OPENCLAW_CONFIG_PATH": str(CONF / "openclaw.json"),
            "HARDY_CREDENTIALS_CONSUMER_SOCKET": "/run/hardy-home-credentials/consumer.sock",
            "PATH": str(ROOT / "runtime/bin") + ":/usr/local/bin:/usr/bin:/bin",
        }, ("HARDY_HOME_TLS_CERTIFICATE", "HARDY_HOME_TLS_PRIVATE_KEY", "HARDY_HOME_TLS_PORT"))
        account = pwd.getpwnam(OWNER)
        os.chown(control_env, account.pw_uid, account.pw_gid)
        owner_command(["/usr/bin/systemctl", "--user", "disable", "--now", "openclaw-gateway.service"])
        run(["/usr/bin/systemctl", "daemon-reload"])
        run(["/usr/bin/systemctl", "enable", "--now", "openclaw-gateway.service"])
        owner_command(["/usr/bin/systemctl", "--user", "restart", "household-control.service"])
        run(["/usr/bin/systemctl", "enable", "--now", "hardy-home-credentials.service"])
        run(["/usr/bin/systemctl", "is-active", "--quiet",
             "openclaw-gateway.service", "hardy-home-credentials.service"])
        print("Protected gateway and HTTPS ingress started. Verify actual native tool denial before submitting credentials.")
    except Exception:
        try:
            rollback()
        except Exception:
            raise RuntimeError("credential_activation_failed_rollback_requires_attention") from None
        raise RuntimeError("credential_activation_failed_previous_services_restored") from None

def main():
    global OWNER, OPERATOR_HOME, SOURCE, BIND_ADDRESS, PUBLIC_ORIGIN, REUSE_RUNTIME_INODES
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("check", "prepare", "activate", "rollback"))
    parser.add_argument("--source", type=pathlib.Path)
    parser.add_argument("--owner")
    parser.add_argument("--bind")
    parser.add_argument("--public-origin")
    parser.add_argument("--reuse-runtime-inodes", action="store_true",
                        help="Promote static runtime library inodes to root-owned hardlinks and separately copy Node")
    args = parser.parse_args()
    if args.action in ("check", "prepare"):
        if not all((args.source, args.owner, args.bind, args.public_origin)):
            parser.error("check and prepare require --source, --owner, --bind and --public-origin")
        REUSE_RUNTIME_INODES = args.reuse_runtime_inodes
        OWNER = args.owner
        OPERATOR_HOME = pathlib.Path(pwd.getpwnam(OWNER).pw_dir)
        SOURCE = args.source.resolve(strict=True)
        BIND_ADDRESS = str(ipaddress.ip_address(args.bind))
        origin = urlsplit(args.public_origin)
        if origin.scheme != "https" or not origin.hostname or origin.username or origin.password or origin.path not in ("", "/") or origin.query or origin.fragment:
            raise RuntimeError("https_public_origin_required")
        PUBLIC_ORIGIN = args.public_origin.rstrip("/")
        if args.action == "check":
            return check_readiness(SOURCE)
    if os.geteuid() != 0 or sys.platform != "linux" or platform.freedesktop_os_release().get("ID") != "ubuntu":
        raise RuntimeError("ubuntu_root_required")
    if args.action == "prepare":
        prepare(SOURCE)
    else:
        OWNER = json.loads((CONF / "deployment.json").read_text())["owner"]
        OPERATOR_HOME = pathlib.Path(pwd.getpwnam(OWNER).pw_dir)
        if args.action == "activate":
            activate()
        else:
            rollback()
    return 0

if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        # Never echo provider responses, environment values, process output or
        # arbitrary paths derived from submitted credentials.
        reason = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print("credential_install_failed:" + reason, file=sys.stderr)
        sys.exit(1)

