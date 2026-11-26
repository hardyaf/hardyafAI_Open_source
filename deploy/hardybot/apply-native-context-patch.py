#!/usr/bin/env python3
"""Apply the reviewed exact-version context patch offline; lifecycle/backup belong to the caller."""
import argparse
import hashlib
import json
import os
import pathlib
import re
import secrets
import stat
import subprocess
import tempfile

class PatchError(Exception):
    pass

def require(condition, code):
    if not condition:
        raise PatchError(code)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def regular_bytes(path):
    require(path.is_file() and not path.is_symlink(), "regular_file_required")
    return path.read_bytes()

def safe_relative(value):
    require(isinstance(value, str) and re.fullmatch(r"dist/[A-Za-z0-9_./-]+\.mjs", value), "invalid_patch_path")
    path = pathlib.PurePosixPath(value)
    require(".." not in path.parts and str(path) == value, "invalid_patch_path")
    return value

def target_path(root, relative):
    target = root / relative
    require(target.resolve(strict=False).is_relative_to(root), "patch_path_escape")
    cursor = target
    while cursor != root:
        require(not cursor.is_symlink(), "patch_symlink_refused")
        cursor = cursor.parent
    require(target.parent.is_dir(), "patch_parent_missing")
    return target

def metadata(path):
    value = path.stat()
    return {"uid": value.st_uid, "gid": value.st_gid, "mode": stat.S_IMODE(value.st_mode),
            "xattrs": {name: os.getxattr(path, name, follow_symlinks=False)
                       for name in os.listxattr(path, follow_symlinks=False)}}

def atomic_write(path, data, previous):
    saved = previous or {"uid": path.parent.stat().st_uid, "gid": path.parent.stat().st_gid, "mode": 0o644, "xattrs": {}}
    temporary = path.with_name("." + path.name + ".context-" + secrets.token_hex(8) + ".tmp")
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.chown(temporary, saved["uid"], saved["gid"])
        temporary.chmod(saved["mode"])
        for name, value in saved["xattrs"].items():
            os.setxattr(temporary, name, value, follow_symlinks=False)
        require(metadata(temporary) == saved, "replacement_metadata_mismatch")
        with temporary.open("rb") as synced:
            os.fsync(synced.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
        require(metadata(path) == saved and digest(path.read_bytes()) == digest(data), "replacement_verification_failed")
    finally:
        if temporary.exists() and not temporary.is_symlink():
            temporary.unlink()

def prepare(package_root, manifest_path):
    require(not package_root.is_symlink(), "package_root_symlink_refused")
    root = package_root.resolve(strict=True)
    manifest = json.loads(regular_bytes(manifest_path))
    require(manifest.get("upstreamVersion") == "2026.9.8", "unapproved_upstream_version")
    package = json.loads(regular_bytes(root / "package.json"))
    require(package.get("name") == "openclaw" and package.get("version") == manifest["upstreamVersion"], "package_version_mismatch")
    rows = manifest.get("files")
    require(isinstance(rows, list) and rows, "patch_files_required")
    entries = {}
    for row in rows:
        require(isinstance(row, dict), "invalid_patch_entry")
        relative = safe_relative(row.get("path"))
        require(relative not in entries, "duplicate_patch_path")
        before, after = row.get("beforeSha256"), row.get("afterSha256")
        require(before is None or isinstance(before, str) and re.fullmatch("[a-f0-9]{64}", before), "invalid_before_hash")
        require(isinstance(after, str) and re.fullmatch("[a-f0-9]{64}", after), "invalid_after_hash")
        path = target_path(root, relative)
        data = regular_bytes(path) if path.exists() else None
        actual = digest(data) if data is not None else None
        require(actual in (before, after), "package_content_mismatch")
        entries[relative] = {"path": path, "before": before, "after": after, "data": data,
                             "metadata": metadata(path) if data is not None else None, "applied": actual == after}
    patch_name = manifest.get("patchFile", manifest_path.with_suffix(".patch").name)
    require(isinstance(patch_name, str) and re.fullmatch("[A-Za-z0-9_.-]+[.]patch", patch_name), "invalid_patch_filename")
    patch_data = regular_bytes(manifest_path.parent / patch_name)
    require(digest(patch_data) == manifest.get("patchSha256"), "patch_hash_mismatch")
    try:
        patch_text = patch_data.decode("utf-8")
    except UnicodeDecodeError:
        raise PatchError("patch_encoding_invalid")
    headers = []
    pending = None
    for line in patch_text.splitlines():
        require(not line.startswith(("rename from ", "rename to ", "copy from ", "copy to ", "GIT binary patch", "Binary files ",
                                     "Index:", "Prereq:", "Only in ", "*** ", "old mode ", "new mode ")), "unsupported_patch_operation")
        if line.startswith("diff --git "):
            match = re.fullmatch(r"diff --git a/([^ ]+) b/([^ ]+)", line)
            require(match is not None and match[1] == match[2] and match[1] in entries, "invalid_git_patch_header")
        if line.startswith("--- "):
            require(pending is None, "invalid_patch_headers")
            pending = line[4:].split("\t", 1)[0]
        elif line.startswith("+++ "):
            require(pending is not None, "invalid_patch_headers")
            after_path = line[4:].split("\t", 1)[0]
            require(after_path.startswith("b/"), "invalid_patch_headers")
            relative = safe_relative(after_path[2:])
            require(relative in entries and relative not in headers, "unexpected_patch_path")
            expected = "/dev/null" if entries[relative]["before"] is None else "a/" + relative
            require(pending == expected, "invalid_patch_headers")
            headers.append(relative)
            pending = None
    require(pending is None and set(headers) == set(entries), "patch_header_manifest_mismatch")
    applied = [entry["applied"] for entry in entries.values()]
    require(all(applied) or not any(applied), "partial_patch_state")
    if all(applied):
        return manifest, entries, {}
    payload = {}
    with tempfile.TemporaryDirectory(prefix="hardy-context-patch-") as directory:
        temporary_root = pathlib.Path(directory)
        for relative, entry in entries.items():
            destination = temporary_root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            if entry["data"] is not None:
                destination.write_bytes(entry["data"])
        result = subprocess.run(["/usr/bin/patch", "--batch", "--forward", "--fuzz=0", "--no-backup-if-mismatch", "-p1"],
                                input=patch_data, cwd=temporary_root, capture_output=True, timeout=60)
        require(result.returncode == 0, "exact_patch_rejected")
        actual_paths = {str(path.relative_to(temporary_root)) for path in temporary_root.rglob("*") if path.is_file()}
        require(actual_paths == set(entries), "unexpected_patch_output")
        for relative, entry in entries.items():
            data = regular_bytes(temporary_root / relative)
            require(digest(data) == entry["after"], "patched_content_mismatch")
            payload[relative] = data
    return manifest, entries, payload

def run(package_root, manifest_path, apply=False):
    manifest, entries, payload = prepare(pathlib.Path(package_root), pathlib.Path(manifest_path))
    if apply:
        # All postimages are prepared/hash-verified before the first replacement.
        for relative, data in payload.items():
            entry = entries[relative]
            current = entry["path"]
            actual = digest(regular_bytes(current)) if current.exists() else None
            require(actual == entry["before"], "package_changed_after_preparation")
            atomic_write(current, data, entry["metadata"])
    return {"patchId": manifest.get("patchId"), "upstreamVersion": manifest["upstreamVersion"],
            "status": "already_applied" if not payload else "applied" if apply else "ready",
            "files": len(entries), "writtenFiles": len(payload) if apply else 0,
            "metadataPreserved": True, "databaseChanged": False}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package-root", type=pathlib.Path, required=True)
    parser.add_argument("--manifest", type=pathlib.Path, required=True)
    parser.add_argument("--apply", action="store_true", help="Caller must quiesce and back up the production runtime first.")
    args = parser.parse_args()
    try:
        print(json.dumps(run(args.package_root, args.manifest, args.apply), sort_keys=True))
    except (PatchError, OSError, ValueError, subprocess.SubprocessError):
        print(json.dumps({"status": "failed" if args.apply else "refused",
                          "reason": "native_patch_validation_or_write_failed",
                          "writesMayHaveOccurred": args.apply, "offlineInspectionRequired": args.apply}))
        raise SystemExit(1)

if __name__ == "__main__":
    main()
