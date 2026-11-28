#!/usr/bin/env python3
"""Prepare only static reviewed source/toolchain inputs; never reads credentials."""
import argparse
import hashlib
import json
import pathlib
import shutil
import stat

def copy_static(source, destination, authority):
    source, destination = pathlib.Path(source), pathlib.Path(destination)
    resolved = source.resolve(strict=True)
    if not resolved.is_relative_to(authority.resolve(strict=True)):
        raise RuntimeError("snapshot_symlink_outside_static_authority:" + str(source))
    info = resolved.stat()
    if stat.S_ISDIR(info.st_mode):
        destination.mkdir(parents=True, exist_ok=True)
        for child in sorted(source.iterdir()):
            if child.name.startswith(".env") or child.name in {".git", ".npmrc", ".cache", "__pycache__", ".pytest_cache"}:
                continue
            copy_static(child, destination / child.name, authority)
    elif stat.S_ISREG(info.st_mode):
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
        destination.chmod(0o755 if info.st_mode & 0o111 else 0o644)
    else:
        raise RuntimeError("snapshot_nonregular_source:" + str(source))

def prepare(source, runtime, output):
    source, runtime, output = (pathlib.Path(p).resolve() for p in (source, runtime, output))
    if output.exists():
        raise RuntimeError("workshop_build_context_already_exists")
    output.mkdir(parents=True, mode=0o700)
    application = output / "reference/application"
    for relative in ["services/household-control/src", "services/household-control/test", "services/household-control/scripts",
                     "services/household-control/package.json", "services/household-control/package-lock.json",
                     "plugins/household-domains", "skills", "contracts", "tools", "docs/independent-workshop.md",
                     "deploy/hardybot/workshop-runtime-patch.py", "deploy/hardybot/prepare-workshop-storage.py",
                     "deploy/hardybot/prepare-workshop-image.py", "deploy/hardybot/workshop-sandbox.Dockerfile",
                     "deploy/hardybot/patches/workshop-runtime.json", "deploy/hardybot/patches/native-context-budget.json",
                     "deploy/hardybot/credential-audit.py", "deploy/hardybot/credential-install.py"]:
        original = source / relative
        if not original.exists():
            if relative.endswith("package-lock.json"):
                continue
            raise RuntimeError("workshop_static_source_missing:" + relative)
        if original.is_dir() and relative == "plugins/household-domains":
            for entry in original.iterdir():
                if entry.name != "node_modules":
                    copy_static(entry, application / relative / entry.name, source)
        else:
            copy_static(original, application / relative, source)
    package = runtime / "lib/node_modules/openclaw"
    copy_static(package, output / "reference/openclaw", runtime)
    copy_static(source / "services/household-control/node_modules", output / "dependencies/node_modules", source)
    copy_static(runtime / "bin/node", output / "toolchain/node", runtime)
    copy_static(runtime / "lib/node_modules/npm", output / "toolchain/npm", runtime)
    files = {}
    for item in sorted((output / "reference").rglob("*")):
        if item.is_file():
            files[str(item.relative_to(output / "reference"))] = hashlib.sha256(item.read_bytes()).hexdigest()
    native = json.loads((package / "package.json").read_text())
    manifest = {"schemaVersion": 1, "kind": "workshop_static_reference", "nativeVersion": native["version"],
                "applicationRole": "reviewed-workshop-release-source", "deploymentAttestationRequired": True,
                "filesManifest": "files.sha256.json", "sourceFiles": len(files),
                "applicationPath": "/reference/application", "nativePath": "/reference/openclaw",
                "developmentDependencies": "/opt/workshop-dependencies/node_modules"}
    manifest["sourceDigest"] = hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()
    (output / "reference/files.sha256.json").write_text(json.dumps(files, indent=2) + "\n")
    (output / "reference/manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    shutil.copyfile(source / "deploy/hardybot/workshop-sandbox.Dockerfile", output / "Dockerfile")
    print(json.dumps({"prepared": True, "sourceDigest": manifest["sourceDigest"], "sourceFiles": len(files),
                      "nativeVersion": native["version"], "credentialsRead": False}))

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--runtime", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    prepare(args.source, args.runtime, args.output)
