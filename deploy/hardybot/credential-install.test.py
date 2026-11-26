#!/usr/bin/env python3
"""Provider-free checks for credential deployment and scoped recovery."""
import importlib.util
import json
import pathlib
import pwd
import subprocess
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("credential_install", pathlib.Path(__file__).with_name("credential-install.py"))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)

class DeploymentTests(unittest.TestCase):
    def test_existing_environment_values_are_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = pathlib.Path(temporary) / "control.env"
            original = 'EXISTING="alpha\\beta\\"gamma"\nUNRELATED=value=with=equals\nHARDY_HOME_TLS_PORT=8443\n'
            target.write_text(original)
            installer.update_environment(target, {"OPENCLAW_CONFIG_PATH": "/etc/hardy-home-credentials/openclaw.json"}, {"HARDY_HOME_TLS_PORT"})
            current = target.read_text()
            self.assertIn('EXISTING="alpha\\beta\\"gamma"\n', current)
            self.assertIn("UNRELATED=value=with=equals\n", current)
            self.assertNotIn("HARDY_HOME_TLS_PORT", current)
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)

    def test_existing_private_control_listener_is_preserved(self):
        self.assertEqual(installer.control_url({"BIND_ADDRESS": "10.20.30.40", "PORT": "4317"}), "http://10.20.30.40:4317")
        self.assertEqual(installer.control_url({"BIND_ADDRESS": "0.0.0.0"}), "http://127.0.0.1:4317")
        self.assertEqual(installer.control_url({"BIND_ADDRESS": "::1"}), "http://[::1]:4317")
        with self.assertRaises(RuntimeError):
            installer.control_url({"BIND_ADDRESS": "8.8.8.8"})

    def fixture(self, root):
        config = root / "etc"
        config.mkdir()
        backup = root / "backup"
        backup.mkdir()
        control = root / "control.env"
        control.write_text("UNRELATED=newer-setting\nHARDY_HOME_DOMAINS_CONFIG=/etc/hardy-home-credentials/domains.json\n")
        domains = root / "original-domains.json"
        domains.write_text(json.dumps({"execution": {}}))
        database = root / "business.sqlite"
        database.write_bytes(b"newer-business-state")
        record = {"controlEnvironment": str(control), "backup": str(backup),
                  "domains": str(domains), "database": str(database)}
        (config / "deployment.json").write_text(json.dumps(record))
        (backup / "control.env").write_text("UNRELATED=older-setting\nHARDY_HOME_TLS_PORT=8443\n")
        return config, control, database

    def test_rollback_restores_only_owned_settings(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            config, control, database = self.fixture(root)
            owner = pwd.getpwuid(installer.os.getuid()).pw_name
            with mock.patch.object(installer, "CONF", config), \
                    mock.patch.object(installer, "OWNER", owner), \
                    mock.patch.object(installer, "owner_command"), \
                    mock.patch.object(installer.subprocess, "run"), \
                    mock.patch.object(installer.os, "chown"):
                installer.rollback()
            self.assertIn("UNRELATED=newer-setting\n", control.read_text())
            self.assertIn("HARDY_HOME_TLS_PORT=8443\n", control.read_text())
            self.assertNotIn("HARDY_HOME_DOMAINS_CONFIG", control.read_text())
            self.assertEqual(database.read_bytes(), b"newer-business-state")

    def test_activation_failure_invokes_rollback(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            config, _, database = self.fixture(root)
            owner = pwd.getpwuid(installer.os.getuid()).pw_name
            with mock.patch.object(installer, "CONF", config), \
                    mock.patch.object(installer, "ROOT", root / "artifact"), \
                    mock.patch.object(installer, "OWNER", owner), \
                    mock.patch.object(installer, "owner_command"), \
                    mock.patch.object(installer, "run", side_effect=subprocess.CalledProcessError(1, ["systemctl"])), \
                    mock.patch.object(installer, "rollback") as restore, \
                    mock.patch.object(installer.os, "chown"):
                with self.assertRaisesRegex(RuntimeError, "previous_services_restored"):
                    installer.activate()
                restore.assert_called_once()
            self.assertEqual(database.read_bytes(), b"newer-business-state")


    def test_runtime_promotion_links_only_installed_program_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            source = root / "source"
            home = root / "home"
            artifact = root / "artifact"
            for relative in ("services/household-control", "tools", "apps/hardy-home-web/src",
                             "plugins/household-domains", "skills", "deploy/hardybot"):
                (source / relative).mkdir(parents=True)
            for relative in ("apps/hardy-home-web/build.mjs", "apps/kitchen-display/src/signing.mjs", "integrations/uplift/operations.json"):
                target = source / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("reviewed static source")
            application = source / "services/household-control/source.txt"
            application.write_text("editable application source")
            runtime = home / ".openclaw/tools/node"
            (runtime / "bin").mkdir(parents=True)
            program = runtime / "bin/node"
            program.write_text("installed program")
            runtime_package = runtime / "lib/node_modules/openclaw"
            runtime_package.mkdir(parents=True)
            library = runtime_package / "index.js"
            library.write_text("installed static library")
            dependency = source / "plugins/household-domains/node_modules/openclaw"
            dependency.parent.mkdir()
            dependency.symlink_to(runtime_package, target_is_directory=True)
            sdk = home / ".openclaw/tools/bitwarden-connector"
            sdk.mkdir(parents=True)
            sdk_file = sdk / "module.py"
            sdk_file.write_text("sdk module")
            with mock.patch.object(installer, "ROOT", artifact), \
                    mock.patch.object(installer, "OPERATOR_HOME", home), \
                    mock.patch.object(installer, "REUSE_RUNTIME_INODES", True), \
                    mock.patch.object(installer, "run"), \
                    mock.patch.object(installer.os, "chown"), \
                    mock.patch.object(installer, "apply_context_patch") as apply_patch, \
                    mock.patch.object(installer, "protect_tree", wraps=installer.protect_tree) as protect:
                installer.snapshot(source)
            apply_patch.assert_called_once_with(artifact)
            self.assertNotEqual(program.stat().st_ino, (artifact / "runtime/bin/node").stat().st_ino)
            self.assertEqual(library.stat().st_ino, (artifact / "runtime/lib/node_modules/openclaw/index.js").stat().st_ino)
            self.assertNotEqual(application.stat().st_ino, (artifact / "source/services/household-control/source.txt").stat().st_ino)
            self.assertNotEqual(sdk_file.stat().st_ino, (artifact / "sdk/module.py").stat().st_ino)
            self.assertTrue((artifact / "source/integrations/uplift/operations.json").is_file())
            copied_dependency = artifact / "source/plugins/household-domains/node_modules/openclaw"
            self.assertEqual(copied_dependency.resolve(), artifact / "runtime/lib/node_modules/openclaw")
            self.assertEqual(dependency.resolve(), runtime_package)
            protect.assert_called_once_with(artifact)
            second_dependency = artifact / "plugin-load/1/node_modules/openclaw"
            second_dependency.parent.mkdir(parents=True)
            second_dependency.symlink_to(runtime_package, target_is_directory=True)
            with mock.patch.object(installer, "ROOT", artifact), \
                    mock.patch.object(installer, "OPERATOR_HOME", home), \
                    mock.patch.object(installer.os, "chown"):
                installer.protect_tree(artifact)
            self.assertEqual(second_dependency.resolve(), artifact / "runtime/lib/node_modules/openclaw")

    def test_runtime_promotion_requires_explicit_flag(self):
        with tempfile.TemporaryDirectory() as temporary:
            owner = pwd.getpwuid(installer.os.getuid()).pw_name
            arguments = ["credential-install.py", "check", "--source", temporary,
                         "--owner", owner, "--bind", "127.0.0.1",
                         "--public-origin", "https://household.invalid:8443",
                         "--reuse-runtime-inodes"]
            with mock.patch.object(installer.sys, "argv", arguments), \
                    mock.patch.object(installer, "check_readiness", return_value=0):
                self.assertEqual(installer.main(), 0)
                self.assertTrue(installer.REUSE_RUNTIME_INODES)
            with mock.patch.object(installer.sys, "argv", arguments[:-1]), \
                    mock.patch.object(installer, "check_readiness", return_value=0):
                self.assertEqual(installer.main(), 0)
                self.assertFalse(installer.REUSE_RUNTIME_INODES)

    def test_stock_skill_cache_does_not_change_configuration_parent(self):
        with tempfile.TemporaryDirectory() as temporary:
            config = pathlib.Path(temporary)
            config.chmod(0o750)
            owner = pwd.getpwuid(installer.os.getuid()).pw_name
            with mock.patch.object(installer, "CONF", config), mock.patch.object(installer.os, "chown") as change_owner:
                installer.prepare_skill_cache(owner)
            self.assertEqual(config.stat().st_mode & 0o777, 0o750)
            self.assertEqual((config / "plugin-skills").stat().st_mode & 0o777, 0o700)
            change_owner.assert_called_once_with(config / "plugin-skills", installer.os.getuid(), pwd.getpwnam(owner).pw_gid)

    def test_stock_skill_cache_rejects_symlink(self):
        with tempfile.TemporaryDirectory() as temporary:
            config = pathlib.Path(temporary)
            target = config / "unrelated"
            target.mkdir()
            (config / "plugin-skills").symlink_to(target, target_is_directory=True)
            owner = pwd.getpwuid(installer.os.getuid()).pw_name
            with mock.patch.object(installer, "CONF", config), mock.patch.object(installer.os, "chown") as change_owner:
                with self.assertRaisesRegex(RuntimeError, "plugin_skill_cache_unsafe"):
                    installer.prepare_skill_cache(owner)
            change_owner.assert_not_called()
class ProtectedPatchInstallationTests(unittest.TestCase):
    def bundle(self, root):
        deployment = root / "source/deploy/hardybot"
        (deployment / "patches").mkdir(parents=True)
        applier = deployment / "apply-native-context-patch.py"
        manifest = deployment / "patches/native-context-budget.json"
        applier.write_text("# synthetic reviewed applier")
        manifest.write_text("{}")
        return applier, manifest
    def test_only_protected_snapshot_is_targeted(self):
        with tempfile.TemporaryDirectory(prefix="protected-patch-install-") as temporary:
            root = pathlib.Path(temporary)
            applier, manifest = self.bundle(root)
            with mock.patch.object(installer, "run") as execute:
                installer.apply_context_patch(root)
            execute.assert_called_once_with([
                "/usr/bin/python3", "-I", str(applier),
                "--package-root", str(root / "runtime/lib/node_modules/openclaw"),
                "--manifest", str(manifest), "--apply"])
            self.assertFalse((root / "runtime").exists())
    def test_missing_bundle_refuses_before_execution(self):
        with tempfile.TemporaryDirectory(prefix="protected-patch-install-") as temporary:
            root = pathlib.Path(temporary)
            _, manifest = self.bundle(root)
            manifest.unlink()
            with mock.patch.object(installer, "run") as execute:
                with self.assertRaisesRegex(RuntimeError, "native_context_patch_bundle_missing"):
                    installer.apply_context_patch(root)
            execute.assert_not_called()
    def test_symlinked_bundle_refuses_before_execution(self):
        with tempfile.TemporaryDirectory(prefix="protected-patch-install-") as temporary:
            root = pathlib.Path(temporary)
            _, manifest = self.bundle(root)
            external = root / "external.json"
            external.write_text("{}")
            manifest.unlink()
            manifest.symlink_to(external)
            with mock.patch.object(installer, "run") as execute:
                with self.assertRaisesRegex(RuntimeError, "native_context_patch_bundle_missing"):
                    installer.apply_context_patch(root)
            execute.assert_not_called()

if __name__ == "__main__":
    unittest.main()
