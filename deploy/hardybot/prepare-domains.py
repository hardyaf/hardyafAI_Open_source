#!/usr/bin/env python3
"""Prepare protected Slice 2 configuration; never activate or call providers."""
import argparse
import copy
import json
import os
from pathlib import Path
import stat
import tempfile
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def fail(code):
    raise SystemExit(code)


def mapping(value, code="domain_prepare_config_invalid"):
    if not isinstance(value, dict):
        fail(code)
    return value


def string(value, code="domain_prepare_config_invalid"):
    if not isinstance(value, str) or not value or "\0" in value:
        fail(code)
    return value


def strings(value, code="domain_prepare_config_invalid"):
    if not isinstance(value, list) or any(not isinstance(item, str) or not item for item in value):
        fail(code)
    return list(value)


def owned_path(value, home):
    raw = Path(string(value)).expanduser()
    if not raw.is_absolute() or raw.is_symlink():
        fail("domain_prepare_owned_path_invalid")
    resolved = raw.resolve()
    if not resolved.is_relative_to(home):
        fail("domain_prepare_path_outside_owner_home")
    current = home
    for part in raw.relative_to(home).parts:
        current = current / part
        if current.is_symlink():
            fail("domain_prepare_symlinked_owned_path")
    return resolved


def executable(value):
    raw = Path(string(value)).expanduser()
    if not raw.is_absolute():
        fail("domain_prepare_binary_path_invalid")
    resolved = raw.resolve(strict=True)
    info = resolved.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o022 or not os.access(resolved, os.X_OK):
        fail("domain_prepare_binary_untrusted")
    # Preserve venv/bin/python argv[0] semantics after validating its real target.
    return os.path.abspath(raw)


def private_json(filename):
    descriptor = os.open(filename, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(descriptor, "rb") as handle:
        info = os.fstat(handle.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > 1024 * 1024:
            fail("domain_prepare_protected_config_invalid")
        if hasattr(os, "getuid") and (info.st_uid != os.getuid() or info.st_mode & 0o077):
            fail("domain_prepare_protected_config_permissions")
        content = handle.read(1024 * 1024 + 1)
        if len(content) != info.st_size:
            fail("domain_prepare_protected_config_changed")
    try:
        return mapping(json.loads(content)), content
    except (ValueError, UnicodeError):
        fail("domain_prepare_protected_config_invalid")


def secure_directory(directory, home):
    owned_path(str(directory), home)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = directory.stat()
    if not stat.S_ISDIR(info.st_mode) or hasattr(os, "getuid") and info.st_uid != os.getuid():
        fail("domain_prepare_directory_owner_invalid")
    os.chmod(directory, 0o700)


def write_private(filename, value, home):
    secure_directory(filename.parent, home)
    if filename.exists():
        info = filename.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or hasattr(os, "getuid") and info.st_uid != os.getuid():
            fail("domain_prepare_output_invalid")
    descriptor, temporary = tempfile.mkstemp(prefix="." + filename.name + ".", suffix=".tmp", dir=filename.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            os.fchmod(handle.fileno(), 0o600)
            json.dump(value, handle, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, filename)
        directory = os.open(filename.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def append_unique(values, *additions):
    result = strings(values)
    for value in additions:
        if value not in result:
            result.append(value)
    return result


def merge_owned_entry(entries, key, expected):
    existing = entries.get(key)
    if existing is None:
        entries[key] = copy.deepcopy(expected)
        return
    existing = mapping(existing)
    for field, value in expected.items():
        if field in existing and existing[field] != value:
            fail("domain_prepare_existing_" + key.replace("-", "_") + "_requires_explicit_merge")
    entries[key] = {**existing, **copy.deepcopy(expected)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["config", "domains-output", "native-output", "state-root", "python", "document-python", "gog-bin", "google-account", "google-client", "calendar-id"]:
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--timezone", default="America/New_York")
    args = parser.parse_args()
    os.umask(0o077)
    home = Path.home().resolve()
    config_path = owned_path(args.config, home)
    domains_output = owned_path(args.domains_output, home)
    native_output = owned_path(args.native_output, home)
    state = owned_path(args.state_root, home)
    repo = owned_path(str(Path(__file__).resolve().parents[2]), home)
    if len({config_path, domains_output, native_output}) != 3:
        fail("domain_prepare_activation_or_output_collision_refused")
    before, original_bytes = private_json(config_path)
    native = copy.deepcopy(before)
    if mapping(native.get("plugins", {})).get("enabled") is False:
        fail("domain_prepare_plugins_globally_disabled")
    try:
        ZoneInfo(args.timezone)
    except (ZoneInfoNotFoundError, ValueError):
        fail("domain_prepare_timezone_invalid")
    python = executable(args.python)
    document_python = executable(args.document_python)
    gog = executable(args.gog_bin)
    for field in [args.google_account, args.google_client, args.calendar_id]:
        if len(string(field)) > 4096 or field.startswith("-"):
            fail("domain_prepare_google_binding_invalid")
    agents = mapping(native.setdefault("agents", {}))
    entries = mapping(agents.setdefault("entries", {}))
    if "main" not in entries:
        fail("domain_prepare_main_agent_required")
    defaults = mapping(agents.get("defaults", {}))
    default_workspace = defaults.get("workspace", str(home / ".openclaw" / "workspace"))
    main_entry = mapping(entries["main"])
    family_workspaces = {"main": str(owned_path(main_entry.get("workspace", default_workspace), home))}
    if "natasha" in entries:
        family_workspaces["natasha"] = str(owned_path(mapping(entries["natasha"]).get("workspace", str(home / ".openclaw" / "workspace-natasha")), home))
    for workspace in family_workspaces.values():
        if not Path(workspace).is_dir():
            fail("domain_prepare_family_workspace_unavailable")
    capture_script = repo / "skills" / "household-capture" / "scripts" / "capture.py"
    document_script = repo / "skills" / "local-documents" / "scripts" / "read_document.py"
    plugin_path = repo / "plugins" / "household-domains"
    uplift_root = repo / "integrations" / "uplift"
    if not capture_script.is_file() or not document_script.is_file() or not (plugin_path / "openclaw.plugin.json").is_file() or not uplift_root.is_dir():
        fail("domain_prepare_source_dependency_unavailable")
    knowledge = state / "native-profiles" / "knowledge"
    wiki_parent = state / "native-wiki"
    managed_directories = [state, state / "native-profiles", knowledge, wiki_parent, state / "document-cache", state / "uplift", state / "uplift" / "originals"]
    # No source, receipt or ledger data is imported. Only empty managed directories are prepared.
    for directory in managed_directories:
        owned_path(str(directory), home)
    disabled = {"enabled": False, "domains": [], "scopes": [], "contactEditing": False, "projectCodes": [], "canManageProjects": False, "canReviewReceipts": False, "allowedAttendees": [], "sharedDomains": []}
    profiles = {name: copy.deepcopy(disabled) for name in ["natasha", "fred", "belle"]}
    profiles["alex"] = {"enabled": True, "domains": ["contacts", "documents", "lists", "memory", "calendar", "email", "schedule", "receipts", "diagnostics"],
        "scopes": ["personal", "household"], "contactEditing": True, "projectCodes": [], "canManageProjects": True, "canReviewReceipts": True,
        "allowedAttendees": [], "sharedDomains": ["contacts", "documents", "lists", "memory", "calendar", "schedule", "effects"]}
    domains = {"version": 1, "profiles": profiles,
        "capture": {"python": python, "script": str(capture_script), "workspaces": family_workspaces},
        "google": {"gogBinary": gog, "account": args.google_account, "client": args.google_client, "calendarId": args.calendar_id, "timezone": args.timezone},
        "memory": {"workspaces": {**family_workspaces, "household-knowledge": str(knowledge)}, "sharedAgentId": "household-knowledge"},
        "documents": {"python": document_python, "script": str(document_script), "cacheRoot": str(state / "document-cache")},
        "uplift": {"python": python, "moduleRoot": str(uplift_root), "database": str(state / "uplift" / "uplift.sqlite"), "vaultRoot": str(state / "uplift" / "originals")}}
    if domains_output.exists() and private_json(domains_output)[0] != domains:
        fail("domain_prepare_existing_domain_grants_require_explicit_merge")
    helper = {"name": "Household knowledge scope", "workspace": str(knowledge), "tools": {"deny": ["*"], "elevated": {"enabled": False}, "fs": {"workspaceOnly": True}}, "subagents": {"allowAgents": []}}
    merge_owned_entry(entries, "household-knowledge", helper)
    main_tools = mapping(main_entry.setdefault("tools", {}))
    if "allow" in main_tools and "alsoAllow" in main_tools:
        fail("domain_prepare_existing_tool_policy_invalid")
    if "allow" in main_tools:
        if not strings(main_tools["allow"]):
            fail("domain_prepare_empty_allow_requires_explicit_merge")
        main_tools["allow"] = append_unique(main_tools["allow"], "hardy-household")
    else:
        main_tools["alsoAllow"] = append_unique(main_tools.get("alsoAllow", []), "hardy-household")
    plugins = mapping(native.setdefault("plugins", {}))
    if any(item in strings(plugins.get("deny", [])) for item in ["hardy-household", "memory-wiki", "*"]):
        fail("domain_prepare_explicit_plugin_deny_requires_explicit_merge")
    load = mapping(plugins.setdefault("load", {}))
    load["paths"] = append_unique(load.get("paths", []), str(plugin_path))
    if "allow" in plugins:
        plugins["allow"] = append_unique(plugins["allow"], "hardy-household", "memory-wiki")
    plugin_entries = mapping(plugins.setdefault("entries", {}))
    own_config = {"controlEnvironmentPath": str(home / ".config" / "hardy-home" / "control.env"), "domainConfigurationPath": str(domains_output)}
    own_entry = mapping(plugin_entries.get("hardy-household", {}))
    if own_entry.get("config") not in [None, own_config]:
        fail("domain_prepare_existing_plugin_requires_explicit_merge")
    plugin_entries["hardy-household"] = {**own_entry, "enabled": True, "config": own_config}
    wiki = {"vaultMode": "isolated", "vault": {"scope": "agent", "path": str(wiki_parent), "renderMode": "native"},
        "obsidian": {"enabled": False, "useOfficialCli": False, "openAfterWrites": False},
        "bridge": {"enabled": False, "readMemoryArtifacts": False, "indexDreamReports": False, "indexDailyNotes": False, "indexMemoryRoot": False, "followMemoryEvents": False},
        "unsafeLocal": {"allowPrivateMemoryCoreAccess": False, "paths": []},
        "ingest": {"autoCompile": True, "maxConcurrentJobs": 1, "allowUrlIngest": False},
        "search": {"backend": "local", "corpus": "wiki"}, "context": {"includeCompiledDigestPrompt": False},
        "render": {"preserveHumanBlocks": True, "createBacklinks": True, "createDashboards": True}}
    wiki_entry = mapping(plugin_entries.get("memory-wiki", {}))
    if wiki_entry.get("config") not in [None, wiki]:
        fail("domain_prepare_existing_wiki_requires_explicit_merge")
    plugin_entries["memory-wiki"] = {**wiki_entry, "enabled": True, "config": wiki}
    # Check input has not changed before any output is published. No native activation occurs.
    if config_path.read_bytes() != original_bytes:
        fail("domain_prepare_native_config_changed")
    for directory in managed_directories:
        secure_directory(directory, home)
    write_private(domains_output, domains, home)
    write_private(native_output, native, home)
    print(json.dumps({"prepared": True, "enabledProfiles": ["alex"], "plugin": "hardy-household", "wikiScope": "agent", "sharedKnowledgeScope": "household-knowledge", "nativeActivated": False, "providerCalls": False, "credentialsTouched": False}))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, TypeError, KeyError):
        fail("domain_prepare_failed")
