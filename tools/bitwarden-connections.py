#!/usr/bin/env python3
"""Isolated Connections service SDK helper. Values use stdin and trusted stdout only."""
import contextlib
import hmac
import importlib.metadata
import io
import json
import os
import re
import sys
from uuid import UUID


def valid_uuid(value):
    try:
        return isinstance(value, str) and str(UUID(value)).lower() == value.lower()
    except (ValueError, TypeError, AttributeError):
        return False


def item_matches(item, organization, project, key=None):
    return (item and str(item.organization_id).lower() == organization.lower()
            and str(item.project_id).lower() == project.lower()
            and (key is None or item.key == key))


def execute(request, environment, client_factory):
    attempted = False
    try:
        action = request.get("action")
        expected = {"probe": {"action", "organizationId", "projectId"},
                    "put": {"action", "organizationId", "projectId", "key", "value", "allowCreate"},
                    "read": {"action", "organizationId", "projectId", "secretId"},
                    "replace": {"action", "organizationId", "projectId", "secretId", "expectedValue", "value"}}
        if action not in expected or set(request) != expected[action]:
            return {"status": "invalid_request"}
        organization, project = request["organizationId"], request["projectId"]
        if not valid_uuid(organization) or not valid_uuid(project):
            return {"status": "invalid_request"}
        if action == "put" and (not isinstance(request["allowCreate"], bool) or not isinstance(request["key"], str) or not re.fullmatch(r"connection-[a-f0-9]{32}", request["key"])
                                or not isinstance(request["value"], str) or not request["value"] or len(request["value"].encode()) > 65536):
            return {"status": "invalid_request"}
        if action in {"read", "replace"} and not valid_uuid(request["secretId"]):
            return {"status": "invalid_request"}
        if action == "replace" and any(not isinstance(request[key], str) or not request[key] or len(request[key].encode()) > 65536 for key in ("value", "expectedValue")):
            return {"status": "invalid_request"}
        client = client_factory(environment["BWS_SDK_API_URL"], environment["BWS_SDK_IDENTITY_URL"])
        if not client.auth().login_access_token(environment["BWS_ACCESS_TOKEN"], None).success:
            return {"status": "provider_unavailable"}
        configured_project = client.projects().get(project).data
        if not configured_project or str(configured_project.id).lower() != project.lower() or str(configured_project.organization_id).lower() != organization.lower():
            return {"status": "not_authorized"}
        if action == "probe":
            return {"status": "ready"}
        if action in {"read", "replace"}:
            item = client.secrets().get(request["secretId"]).data
            if not item_matches(item, organization, project) or not re.fullmatch(r"connection-[a-f0-9]{32}", item.key):
                return {"status": "not_authorized"}
            if action == "read":
                return {"status": "read", "value": item.value}
            if not hmac.compare_digest(item.value.encode(), request["value"].encode()):
                if not hmac.compare_digest(item.value.encode(), request["expectedValue"].encode()):
                    return {"status": "conflict"}
                attempted = True
                client.secrets().update(organization, request["secretId"], item.key, request["value"], item.note, [UUID(project)])
            after = client.secrets().get(request["secretId"]).data
            if not item_matches(after, organization, project, item.key) or after.note != item.note or not hmac.compare_digest(after.value.encode(), request["value"].encode()):
                return {"status": "unknown"}
            return {"status": "committed", "secretId": request["secretId"], "revision": after.revision_date.isoformat()}
        key = request["key"]
        identifiers = client.secrets().list(organization).data
        matching = [item for item in identifiers.data if item.key == key]
        if len(matching) > 1:
            return {"status": "conflict"}
        if matching:
            item = client.secrets().get(str(matching[0].id)).data
            if not item_matches(item, organization, project, key) or not hmac.compare_digest(item.value.encode(), request["value"].encode()):
                return {"status": "conflict"}
        else:
            if not request["allowCreate"]:
                return {"status": "unknown"}
            attempted = True
            created = client.secrets().create(UUID(organization), key, request["value"], "Hardy Home delegated connection", [UUID(project)]).data
            if not created or not valid_uuid(str(created.id)):
                return {"status": "unknown"}
            item = client.secrets().get(str(created.id)).data
        if not item_matches(item, organization, project, key) or not hmac.compare_digest(item.value.encode(), request["value"].encode()):
            return {"status": "unknown"}
        return {"status": "committed", "secretId": str(item.id), "revision": item.revision_date.isoformat()}
    except Exception:
        return {"status": "unknown" if attempted else "provider_unavailable"}


def sdk_client(api_url, identity_url):
    if importlib.metadata.version("bitwarden-sdk") != "2.1.0":
        raise RuntimeError("sdk_unavailable")
    from bitwarden_sdk import BitwardenClient, DeviceType, client_settings_from_dict
    return BitwardenClient(client_settings_from_dict({"apiUrl": api_url, "identityUrl": identity_url,
                                                     "deviceType": DeviceType.SDK, "userAgent": "HardyHomeConnections"}))


def main():
    try:
        if sys.argv[1:]:
            raise ValueError()
        data = sys.stdin.buffer.read(128 * 1024 + 1)
        if len(data) > 128 * 1024:
            raise ValueError()
        request = json.loads(data)
        if not isinstance(request, dict):
            raise ValueError()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            receipt = execute(request, os.environ, sdk_client)
    except Exception:
        receipt = {"status": "invalid_request"}
    sys.stdout.write(json.dumps(receipt) + "\n")


if __name__ == "__main__":
    main()
