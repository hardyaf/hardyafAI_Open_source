#!/usr/bin/env python3
"""Prepare a merged native platform configuration; activation is an operator step."""
import argparse
import json
import os
import pathlib
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("--config", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--state-root", required=True)
parser.add_argument("--image", required=True)
parser.add_argument("--bws-bin", required=True)
parser.add_argument("--node-real", required=True)
args = parser.parse_args()
home = pathlib.Path.home().resolve()
config_path = pathlib.Path(args.config).resolve()
output = pathlib.Path(args.output).resolve()
state = pathlib.Path(args.state_root).resolve()
if not all(p.is_relative_to(home) for p in [config_path, output, state]):
    raise SystemExit("platform_paths_outside_owner_home")
repo = pathlib.Path(__file__).resolve().parents[2]
os.umask(0o077)
state.mkdir(parents=True, exist_ok=True, mode=0o700)
for name in ["analysis", "diagnostic"]:
    (state/"native-profiles"/name).mkdir(parents=True, exist_ok=True, mode=0o700)
bws_config = home/".config"/"hardy-home"/"bws.toml"
bws_config.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
if not bws_config.exists():
    bws_config.write_text('[profiles.hardy_home]\nstate_opt_out = "true"\n', encoding="utf-8")
    os.chmod(bws_config, 0o600)
node = pathlib.Path(args.node_real).resolve()
bws = pathlib.Path(args.bws_bin).resolve()
if not node.is_file() or not bws.is_file():
    raise SystemExit("platform_binary_unavailable")
patch = json.loads(subprocess.check_output([str(node), str(repo/"tools"/"render-native-platform-config.mjs"), str(state), args.image, f"{os.getuid()}:{os.getgid()}"], text=True))
config = json.loads(config_path.read_text(encoding="utf-8"))
entries = config.setdefault("agents", {}).setdefault("entries", {})
for key, value in patch["agents"]["entries"].items():
    entries[key] = value
attachments = config.setdefault("tools", {}).setdefault("sessions_spawn", {}).setdefault("attachments", {})
desired_attachments = patch["tools"]["sessions_spawn"]["attachments"]
if not isinstance(attachments, dict) or any(key not in desired_attachments or value != desired_attachments[key] for key, value in attachments.items()):
    raise SystemExit("existing_spawn_attachments_requires_explicit_merge")
attachments.update(desired_attachments)
providers = config.setdefault("secrets", {}).setdefault("providers", {})
provider = {
    "source": "exec", "command": str(node),
    "args": [str(repo/"tools"/"bitwarden-secret-resolver.mjs")],
    "env": {"BWS_BIN": str(bws), "BWS_CONFIG_FILE": str(bws_config)},
    "passEnv": ["PATH", "LANG", "LC_ALL", "BWS_ACCESS_TOKEN", "BWS_ALLOWED_SECRET_IDS"],
    "timeoutMs": 10000, "noOutputTimeoutMs": 10000, "maxOutputBytes": 600000, "jsonOnly": True,
}
if "bitwarden" in providers and providers["bitwarden"] != provider:
    raise SystemExit("existing_bitwarden_provider_requires_explicit_merge")
providers["bitwarden"] = provider
output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
output.write_text(json.dumps(config, indent=2)+"\n", encoding="utf-8")
os.chmod(output, 0o600)
print(json.dumps({"prepared": True, "agents": list(patch["agents"]["entries"]), "image": args.image, "credentialsTouched": False}))
