import importlib.util
import pathlib
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import UUID

SPEC = importlib.util.spec_from_file_location("writeback", pathlib.Path(__file__).resolve().parents[1] / "bitwarden-secret-writeback.py")
bridge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bridge)
IDENTIFIER = "00000000-0000-4000-8000-000000000001"


class FakeClient:
    def __init__(self):
        self.item = SimpleNamespace(id=UUID(IDENTIFIER), organization_id=UUID("00000000-0000-4000-8000-000000000002"),
                                    project_id=UUID("00000000-0000-4000-8000-000000000003"), key="oauth", note="retain metadata",
                                    value="previous-fixture-token", revision_date=datetime.now(timezone.utc))
        self.writes = 0
        self.fail_readback = False

    def auth(self):
        return self

    def login_access_token(self, token, state_file):
        assert token == "fixture-bootstrap"
        assert state_file is None
        return SimpleNamespace(success=True)

    def secrets(self):
        return self

    def get(self, identifier):
        assert identifier == IDENTIFIER
        if self.writes and self.fail_readback:
            raise RuntimeError("private provider error must never escape")
        return SimpleNamespace(data=SimpleNamespace(**vars(self.item)))

    def update(self, organization_id, identifier, key, value, note, projects):
        assert (organization_id, identifier, key, note, projects) == (str(self.item.organization_id), IDENTIFIER, self.item.key, self.item.note, [self.item.project_id])
        self.writes += 1
        self.item.value = value
        return SimpleNamespace(success=True)


class WritebackTests(unittest.TestCase):
    def setUp(self):
        self.client = FakeClient()
        self.environment = {"BWS_ACCESS_TOKEN": "fixture-bootstrap", "BWS_ALLOWED_WRITE_SECRET_IDS": IDENTIFIER,
                            "BWS_SDK_API_URL": "https://api.example.invalid", "BWS_SDK_IDENTITY_URL": "https://identity.example.invalid"}
        self.request = {"protocolVersion": 1, "id": IDENTIFIER, "expectedValue": "previous-fixture-token", "value": "replacement-fixture-token"}

    def run_writeback(self, request=None):
        return bridge.writeback(request or self.request, self.environment, lambda *_: self.client)

    def test_commit_requires_exact_readback_and_preserves_metadata(self):
        receipt = self.run_writeback()
        self.assertEqual(receipt["status"], "committed")
        self.assertEqual(self.client.writes, 1)
        self.assertNotIn("fixture-token", str(receipt))

    def test_conflict_never_overwrites_a_changed_secret(self):
        self.client.item.value = "another-provider-rotation"
        self.assertEqual(self.run_writeback()["status"], "conflict")
        self.assertEqual(self.client.writes, 0)

    def test_lost_readback_is_unknown_and_can_reconcile_without_rewriting(self):
        self.client.fail_readback = True
        self.assertEqual(self.run_writeback(), {"status": "unknown"})
        self.client.fail_readback = False
        self.assertEqual(self.run_writeback()["status"], "committed")
        self.assertEqual(self.client.writes, 1)

    def test_id_and_endpoint_policy_apply_before_sdk_login(self):
        self.environment["BWS_ALLOWED_WRITE_SECRET_IDS"] = ""
        self.assertEqual(self.run_writeback()["status"], "not_authorized")
        self.environment["BWS_ALLOWED_WRITE_SECRET_IDS"] = IDENTIFIER
        self.environment["BWS_SDK_API_URL"] = "http://api.example.invalid"
        self.assertEqual(self.run_writeback()["status"], "provider_unavailable")


if __name__ == "__main__":
    unittest.main()
