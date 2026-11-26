#!/usr/bin/env python3
"""Provider-free regressions for the model/credential activation boundary."""
import copy
import importlib.util
import pathlib
import unittest
import tempfile
import json
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("credential_audit", pathlib.Path(__file__).with_name("credential-audit.py"))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

def config():
    return {
        "tools": {"elevated": {"enabled": False}},
        "agents": {"entries": {
            "main": {
                "tools": {
                    "allow": ["sessions_spawn", "household_lists_read"],
                    "deny": sorted(audit.RAW), "elevated": {"enabled": False}},
                "subagents": {"allowAgents": ["main", "analysis"]}},
            "analysis": {
                "tools": {
                    "allow": ["exec", "read", "write"],
                    "exec": {"host": "sandbox"}, "fs": {"workspaceOnly": True},
                    "elevated": {"enabled": False}},
                "sandbox": {
                    "mode": "all", "backend": "docker", "workspaceAccess": "none",
                    "docker": {"network": "none", "readOnlyRoot": True,
                               "binds": [], "capDrop": ["ALL"]}}}}}}

class IsolationPolicyTests(unittest.TestCase):
    def ready(self, value):
        checks = audit.policy_checks(value)
        return bool(checks) and all(checks.values())

    def test_typed_parent_and_offline_analysis(self):
        self.assertTrue(self.ready(config()))

    def test_host_exec_exposure_is_rejected(self):
        value = config()
        value["agents"]["entries"]["analysis"]["tools"]["exec"]["host"] = "gateway"
        self.assertFalse(self.ready(value))

    def test_child_bind_to_host_is_rejected(self):
        value = config()
        value["agents"]["entries"]["analysis"]["sandbox"]["docker"]["binds"] = ["/:/host"]
        self.assertFalse(self.ready(value))

    def test_implicit_parent_tool_profile_is_rejected(self):
        value = config()
        del value["agents"]["entries"]["main"]["tools"]["allow"]
        self.assertFalse(self.ready(value))

    def test_unknown_or_wildcard_dispatch_is_rejected(self):
        for tool in ["*", "group:runtime", "unreviewed_provider_tool"]:
            value = config()
            value["agents"]["entries"]["main"]["tools"]["allow"].append(tool)
            self.assertFalse(self.ready(value))

    def test_unreviewed_spawn_destination_is_rejected(self):
        value = config()
        value["agents"]["entries"]["main"]["subagents"]["allowAgents"].append("*")
        self.assertFalse(self.ready(value))

    def test_acp_bypass_is_rejected(self):
        value = config()
        value["acp"] = {"enabled": True}
        self.assertFalse(self.ready(value))

    def test_elevated_escape_is_rejected(self):
        value = config()
        value["agents"]["entries"]["analysis"]["tools"]["elevated"]["enabled"] = True
        self.assertFalse(self.ready(value))

class NativePatchIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="native-patch-audit-")
        self.addCleanup(self.directory.cleanup)
        self.root = pathlib.Path(self.directory.name)
        self.sdk = self.root / "sdk"
        (self.sdk / "dist").mkdir(parents=True)
        (self.sdk / "package.json").write_text(json.dumps({"name": "openclaw", "version": "2026.9.8"}))
        self.target = self.sdk / "dist/core.mjs"
        self.target.write_text("export const fixed = true;")
        self.diff = self.root / "reviewed.patch"
        self.diff.write_text("reviewed public patch bytes")
        self.manifest = {"patchId": "context-budget-v1", "upstreamVersion": "2026.9.8",
                         "patchFile": self.diff.name, "patchSha256": audit.config_digest(self.diff),
                         "files": [{"path": "dist/core.mjs", "beforeSha256": None,
                                    "afterSha256": audit.config_digest(self.target)}]}
        self.filename = self.root / "native-context-budget.json"
        self.save()
        def temporary_protected(path, private=False):
            value = pathlib.Path(path)
            return value.exists() and not any(item.is_symlink() for item in [value, *value.parents])
        self.guard = patch.object(audit, "protected", side_effect=temporary_protected)
        self.guard.start()
        self.addCleanup(self.guard.stop)
    def save(self):
        self.filename.write_text(json.dumps(self.manifest))
    def ready(self):
        return all(audit.native_patch_checks(self.sdk, self.filename).values())
    def test_actual_entry_must_be_in_the_protected_package(self):
        node = self.root / "node"
        config = self.root / "openclaw.json"
        self.assertTrue(audit.runtime_entry_matches(
            [str(node).encode(), str(self.target).encode(), b"gateway"],
            {b"OPENCLAW_CONFIG_PATH": str(config).encode()}, node, config, self.sdk))
        operator = self.root / "operator.mjs"
        operator.write_text("stock operator entry")
        self.assertFalse(audit.runtime_entry_matches(
            [str(node).encode(), str(operator).encode(), str(self.target).encode()],
            {b"OPENCLAW_CONFIG_PATH": str(config).encode()}, node, config, self.sdk))
    def test_inline_execution_is_not_a_gateway_entry(self):
        node = self.root / "node"
        config = self.root / "openclaw.json"
        self.assertFalse(audit.runtime_entry_matches(
            [str(node).encode(), b"--eval", b"code", str(self.target).encode()],
            {b"OPENCLAW_CONFIG_PATH": str(config).encode()}, node, config, self.sdk))
    def test_entry_with_another_config_is_refused(self):
        node = self.root / "node"
        config = self.root / "openclaw.json"
        self.assertFalse(audit.runtime_entry_matches(
            [str(node).encode(), str(self.target).encode(), b"gateway"],
            {b"OPENCLAW_CONFIG_PATH": b"/other/config"}, node, config, self.sdk))
    def test_exact_package_passes(self):
        self.assertTrue(self.ready())
    def test_missing_manifest_fails(self):
        self.filename.unlink()
        self.assertFalse(self.ready())
    def test_missing_or_changed_patch_file_fails(self):
        self.diff.write_text("different")
        self.assertFalse(self.ready())
    def test_changed_core_bytes_fail(self):
        self.target.write_text("changed")
        self.assertFalse(self.ready())
    def test_missing_core_file_fails(self):
        self.target.unlink()
        self.assertFalse(self.ready())
    def test_wrong_upstream_version_fails(self):
        (self.sdk / "package.json").write_text(json.dumps({"name": "openclaw", "version": "2026.11.9"}))
        self.assertFalse(self.ready())
    def test_outside_manifest_path_fails(self):
        self.manifest["files"][0]["path"] = "../outside.mjs"
        self.save()
        self.assertFalse(self.ready())
    def test_symlink_target_fails_without_reading_target(self):
        self.target.unlink()
        self.target.symlink_to(self.root / "missing-outside")
        self.assertFalse(self.ready())
    def test_empty_or_duplicate_files_fail(self):
        self.manifest["files"] *= 2
        self.save()
        self.assertFalse(self.ready())
        self.manifest["files"] = []
        self.save()
        self.assertFalse(self.ready())
    def test_unprotected_manifest_fails(self):
        self.guard.stop()
        with patch.object(audit, "protected", return_value=False):
            self.assertFalse(self.ready())

if __name__ == "__main__":
    unittest.main()
