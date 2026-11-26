import importlib.util
import pathlib
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import UUID

SPEC = importlib.util.spec_from_file_location("connections", pathlib.Path(__file__).resolve().parents[1] / "bitwarden-connections.py")
bridge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bridge)
ORG = "00000000-0000-4000-8000-000000000001"
PROJECT = "00000000-0000-4000-8000-000000000002"
SECRET = "00000000-0000-4000-8000-000000000003"


class FakeClient:
    def __init__(self):
        self.items = []
        self.creates = 0
        self.fail_readback = False

    def auth(self):
        return self

    def login_access_token(self, token, state):
        assert token == "fixture-machine-token" and state is None
        return SimpleNamespace(success=True)

    def projects(self):
        return SimpleNamespace(get=lambda _: SimpleNamespace(data=SimpleNamespace(id=UUID(PROJECT), organization_id=UUID(ORG))))

    def secrets(self):
        return self

    def list(self, organization):
        assert organization == ORG
        return SimpleNamespace(data=SimpleNamespace(data=self.items))

    def get(self, identifier):
        if self.fail_readback:
            raise RuntimeError("private fixture provider error")
        return SimpleNamespace(data=next(item for item in self.items if str(item.id) == identifier))

    def create(self, organization, key, value, note, projects):
        assert str(organization) == ORG and [str(value) for value in projects] == [PROJECT]
        self.creates += 1
        item = SimpleNamespace(id=UUID(SECRET), organization_id=organization, project_id=projects[0], key=key, value=value, note=note,
                               revision_date=datetime.now(timezone.utc))
        self.items.append(item)
        return SimpleNamespace(data=item)

    def update(self, organization, identifier, key, value, note, projects):
        item = self.items[0]
        assert str(item.id) == identifier and item.key == key and item.note == note
        assert organization == ORG and [str(value) for value in projects] == [PROJECT]
        item.value = value
        return SimpleNamespace(success=True)


class ConnectionsTests(unittest.TestCase):
    def setUp(self):
        self.client = FakeClient()
        self.environment = {"BWS_ACCESS_TOKEN": "fixture-machine-token", "BWS_SDK_API_URL": "https://api.example.invalid", "BWS_SDK_IDENTITY_URL": "https://identity.example.invalid"}
        self.request = {"action": "put", "organizationId": ORG, "projectId": PROJECT, "key": "connection-" + "0" * 32, "value": "fixture-password-secret", "allowCreate": True}

    def execute(self, request=None):
        return bridge.execute(request or self.request, self.environment, lambda *_: self.client)

    def test_initial_creation_requires_readback_and_is_retryable_without_duplicates(self):
        first = self.execute()
        self.assertEqual(first["status"], "committed")
        self.assertEqual(self.execute(), first)
        self.assertEqual(self.client.creates, 1)
        self.assertNotIn("password-secret", str(first))

    def test_response_lost_creation_reconciles_by_exact_key(self):
        self.client.fail_readback = True
        self.assertEqual(self.execute(), {"status": "unknown"})
        self.client.fail_readback = False
        self.assertEqual(self.execute()["status"], "committed")
        self.assertEqual(self.client.creates, 1)

    def test_changed_value_never_overwrites_and_cross_project_read_is_rejected(self):
        self.execute()
        self.assertEqual(self.execute({**self.request, "value": "changed"}), {"status": "conflict"})
        self.client.items[0].project_id = UUID(ORG)
        self.assertEqual(self.execute({"action": "read", "organizationId": ORG, "projectId": PROJECT, "secretId": SECRET}), {"status": "not_authorized"})
        self.assertEqual(self.client.creates, 1)

    def test_rotation_checks_expected_value_and_preserves_project_metadata(self):
        self.execute()
        request = {"action": "replace", "organizationId": ORG, "projectId": PROJECT, "secretId": SECRET,
                   "expectedValue": "fixture-password-secret", "value": "rotated-fixture-secret"}
        self.assertEqual(self.execute({**request, "expectedValue": "conflicting-value"})["status"], "conflict")
        self.assertEqual(self.execute(request)["status"], "committed")
        self.assertEqual(self.execute(request)["status"], "committed")
        self.assertEqual(self.client.items[0].value, "rotated-fixture-secret")

    def test_uncertain_retry_does_not_create_if_the_prior_key_is_not_visible(self):
        self.assertEqual(self.execute({**self.request, "allowCreate": False}), {"status": "unknown"})
        self.assertEqual(self.client.creates, 0)
        self.execute()
        self.assertEqual(self.execute({**self.request, "allowCreate": False})["status"], "committed")
        self.assertEqual(self.client.creates, 1)


if __name__ == "__main__":
    unittest.main()
