import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]

class PublicIgnoreRules(unittest.TestCase):
    def test_private_operator_inputs_are_ignored(self):
        self.assert_ignore({
            "AGENTS.md", ".env", ".env.production", "operator.env",
            "config/operator.local.json", "config/operator.local.json5",
            "config/household.private.json", "config/operator.local.yaml"
        }, ignored=True)

    def test_public_templates_and_ordinary_json_are_trackable(self):
        self.assert_ignore({
            ".env.example", ".env.template", "deploy/hardybot/control.env.example",
            "config/openclaw.redacted.json5", "config/workspace/AGENTS.md",
            "package-lock.json", "docs/index.html", "contracts/household-api/openapi.json"
        }, ignored=False)

    def assert_ignore(self, paths, ignored):
        with tempfile.TemporaryDirectory(prefix="public-ignore-") as directory:
            root = pathlib.Path(directory)
            subprocess.run(["git", "init", "-q", str(root)], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            (root / ".gitignore").write_bytes((ROOT / ".gitignore").read_bytes())
            result = subprocess.run(
                ["git", "-C", str(root), "check-ignore", "--no-index", "--stdin"],
                input="\n".join(sorted(paths)) + "\n", text=True,
                capture_output=True, check=False)
            self.assertIn(result.returncode, (0, 1))
            observed = set(result.stdout.splitlines())
            self.assertEqual(observed, set(paths) if ignored else set())

if __name__ == "__main__":
    unittest.main()
