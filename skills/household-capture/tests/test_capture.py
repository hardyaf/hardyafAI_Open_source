import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "capture.py"
SPEC = importlib.util.spec_from_file_location("household_capture", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class CaptureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.workspace = Path(self.temp.name) / ".openclaw" / "workspace-natasha"
        self.workspace.mkdir(parents=True)
        self.layout = MODULE.Layout(self.workspace)

    def tearDown(self):
        self.temp.cleanup()

    def test_batch_routes_household_personal_and_note(self):
        payload = {
            "items": [
                {"kind": "shopping", "scope": "household", "text": "milk"},
                {
                    "kind": "task",
                    "scope": "personal",
                    "text": "call dentist",
                    "due": "2026-10-06",
                },
                {
                    "kind": "note",
                    "scope": "personal",
                    "title": "Soup",
                    "text": "Liked low-sodium soup.",
                },
            ]
        }
        result = MODULE.capture(self.layout, json.dumps(payload))
        self.assertTrue(result["ok"])
        self.assertTrue(result["verified"])
        self.assertIn("milk", self.layout.list_path("household").read_text())
        self.assertIn("call dentist", self.layout.list_path("personal").read_text())
        note = next(self.layout.notes_dir("personal").glob("*.md")).read_text()
        self.assertIn("Liked low-sodium soup.", note)

    def test_read_projection_separates_owner_metadata_and_preserves_literal_text(self):
        literal = "milk _(added: 2020-01-01; by: someone)_"
        result = MODULE.capture(self.layout, json.dumps({"items": [
            {"kind": "task", "scope": "household", "text": literal, "due": "2026-11-05"}
        ]}))
        item_id = result["saved"][0]["id"]
        before = self.layout.list_path("household").read_text()
        item = MODULE.show(self.layout, "household")["lists"][0]["items"][0]
        self.assertEqual(literal + " (due: 2026-11-05)", item["text"])
        self.assertEqual(self.layout.actor, item["addedBy"])
        self.assertEqual(before, self.layout.list_path("household").read_text())
        MODULE.move_item(self.layout, "household", item_id, "complete", None)
        completed = MODULE.show(self.layout, "household")["lists"][0]["items"][0]
        self.assertEqual(literal + " (due: 2026-11-05)", completed["text"])
        self.assertIn("completedAt", completed)
        MODULE.move_item(self.layout, "household", item_id, "restore", None)
        repeated = MODULE.capture(self.layout, json.dumps({"items": [{"kind": "task", "scope": "household", "text": literal}]}))
        self.assertEqual(1, len(repeated["existing"]))
        self.assertEqual(0, len(repeated["saved"]))

    def test_read_note_uses_exact_id_and_scope(self):
        body = "- 2 teaspoons paprika\n\nStir together."
        result = MODULE.capture(self.layout, json.dumps({"items": [
            {"kind": "note", "scope": "household", "title": "Spice mix", "text": body},
        ]}))
        note_id = result["saved"][0]["id"]
        self.assertEqual(body, MODULE.read_note(self.layout, "household", note_id)["note"]["text"])
        self.assertIsNone(MODULE.read_note(self.layout, "personal", note_id)["note"])

    def test_duplicate_open_item_is_not_added_twice(self):
        payload = {"items": [{"kind": "shopping", "scope": "household", "text": "Milk"}]}
        first = MODULE.capture(self.layout, json.dumps(payload))
        second = MODULE.capture(self.layout, json.dumps(payload))
        self.assertEqual(1, len(first["saved"]))
        self.assertEqual(0, len(second["saved"]))
        self.assertEqual(1, len(second["existing"]))

    def test_complete_remove_and_restore_are_exact_and_recoverable(self):
        payload = {
            "items": [{"kind": "task", "scope": "household", "text": "test furnace"}]
        }
        item_id = MODULE.capture(self.layout, json.dumps(payload))["saved"][0]["id"]
        completed = MODULE.move_item(
            self.layout, "household", item_id, "complete", None
        )
        self.assertTrue(completed["verified"])
        self.assertEqual("Completed", completed["section"])
        restored = MODULE.move_item(self.layout, "household", item_id, "restore", None)
        self.assertTrue(restored["verified"])
        self.assertEqual("Tasks", restored["section"])
        with self.assertRaises(MODULE.CaptureError):
            MODULE.move_item(self.layout, "household", item_id, "remove", "wrong")
        removed = MODULE.move_item(
            self.layout, "household", item_id, "remove", item_id
        )
        self.assertTrue(removed["verified"])
        self.assertEqual("Removed", removed["section"])

    def test_invalid_batch_writes_nothing(self):
        payload = {
            "items": [
                {"kind": "shopping", "scope": "household", "text": "milk"},
                {"kind": "calendar", "scope": "household", "text": "bad"},
            ]
        }
        result = MODULE.capture(self.layout, json.dumps(payload))
        self.assertFalse(result["ok"])
        self.assertFalse(self.layout.list_path("household").exists())

    def test_dashboard_excludes_personal_scope(self):
        payload = {
            "items": [
                {"kind": "shopping", "scope": "household", "text": "shared milk"},
                {"kind": "task", "scope": "personal", "text": "private task"},
            ]
        }
        MODULE.capture(self.layout, json.dumps(payload))
        report = json.dumps(MODULE.dashboard(self.layout, "household"))
        self.assertIn("shared milk", report)
        self.assertNotIn("private task", report)

    def test_note_search_returns_exact_saved_body_and_respects_scope(self):
        payload = {
            "items": [
                {
                    "kind": "note",
                    "scope": "household",
                    "title": "Furnace filter model",
                    "text": "The exact replacement is ABC-123.",
                },
                {
                    "kind": "note",
                    "scope": "personal",
                    "title": "Private reminder",
                    "text": "Do not expose this note.",
                },
            ]
        }
        MODULE.capture(self.layout, json.dumps(payload))
        result = MODULE.search_notes(
            self.layout, "household", "Furnace filter model", 10
        )
        self.assertEqual(1, len(result["notes"]))
        self.assertEqual("The exact replacement is ABC-123.", result["notes"][0]["text"])
        self.assertNotIn("Private reminder", json.dumps(result))


if __name__ == "__main__":
    unittest.main()
