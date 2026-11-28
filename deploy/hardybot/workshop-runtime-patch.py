#!/usr/bin/env python3
"""Build exact workshop compatibility payloads for the pinned native distribution.

The caller owns deployment/metadata. This module performs no runtime writes.
The independent eight-file V5 context manifest remains unchanged.
"""
import hashlib
import json
import pathlib

EDITS = {
    "dist/bash-tools-3n5rTZUL.mjs": [
        ("await rejectUnsafeExecControlShellCommand(params.command);", 'const unrestrictedWorkshop = host === "sandbox" && security === "full" && ask === "off" && defaults?.sandbox?.docker?.env?.HARDY_WORKSHOP === "1";\n\t\t\tif (!unrestrictedWorkshop) await rejectUnsafeExecControlShellCommand(params.command);'),
        ("if (scriptPreflightCwd && !shouldSkipExecScriptPreflight({", "if (scriptPreflightCwd && !unrestrictedWorkshop && !shouldSkipExecScriptPreflight({"),
    ],
    "dist/fs-bridge-CkHTzWVb.mjs": [
        ("function createSandboxFsBridge(params) {", 'function createSandboxFsBridge(params) {\n\tif (params.sandbox.docker?.env?.HARDY_WORKSHOP === "1") return createWorkshopFsBridge(params.sandbox, SANDBOX_FILE_IDENTITY);'),
    ],
}


def payloads(runtime, source):
    runtime, source = pathlib.Path(runtime), pathlib.Path(source)
    manifest = json.loads((source / "deploy/hardybot/patches/workshop-runtime.json").read_text())
    if json.loads((runtime / "package.json").read_text())["version"] != manifest["nativeVersion"]:
        raise RuntimeError("workshop_native_version_mismatch")
    context = json.loads((source / "deploy/hardybot/patches/native-context-budget.json").read_text())
    if len(context["files"]) != 8 or any(hashlib.sha256((runtime / row["path"]).read_bytes()).hexdigest() != row["afterSha256"] for row in context["files"]):
        raise RuntimeError("workshop_pinned_v5_context_patch_changed")
    result = {}
    for row in manifest["files"]:
        relative = row["path"]
        if relative not in EDITS and relative != "dist/household-workshop-fs-20261127.mjs":
            raise RuntimeError("workshop_native_manifest_target_invalid")
        if row.get("source"):
            body = (source / row["source"]).read_bytes()
        else:
            original = (runtime / relative).read_bytes()
            if hashlib.sha256(original).hexdigest() == row["afterSha256"]:
                body = original
            else:
                if hashlib.sha256(original).hexdigest() != row["beforeSha256"]:
                    raise RuntimeError("workshop_native_preimage_mismatch")
                text = original.decode()
                for before, after in EDITS[relative]:
                    if text.count(before) != 1:
                        raise RuntimeError("workshop_native_anchor_mismatch")
                    text = text.replace(before, after)
                if relative.startswith("dist/fs-bridge-"):
                    text = 'import { createWorkshopFsBridge } from "./household-workshop-fs-20261127.mjs";\n' + text
                body = text.encode()
        if hashlib.sha256(body).hexdigest() != row["afterSha256"]:
            raise RuntimeError("workshop_native_payload_mismatch")
        result[relative] = body
    if len(result) != 3:
        raise RuntimeError("workshop_native_manifest_incomplete")
    return result
