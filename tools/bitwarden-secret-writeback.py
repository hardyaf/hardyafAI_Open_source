#!/usr/bin/env python3
"""Trusted connector stdin bridge; stdout is a non-secret writeback receipt only."""
import contextlib
import hmac
import importlib.metadata
import io
import json
import os
import sys
from urllib.parse import urlsplit
from uuid import UUID

SDK_VERSION = "2.1.0"


def valid_uuid(value):
    try:
        return isinstance(value, str) and str(UUID(value)).lower() == value.lower()
    except (ValueError, TypeError, AttributeError):
        return False


def writeback(request, environment, client_factory):
    """Factory is injected for provider-free tests; production uses the official pinned SDK."""
    attempted = False
    try:
        if not isinstance(request, dict) or set(request) != {"protocolVersion", "id", "expectedValue", "value"}:
            return {"status": "invalid_request"}
        identifier = request["id"]
        if request["protocolVersion"] != 1 or not valid_uuid(identifier):
            return {"status": "invalid_request"}
        for key in ("expectedValue", "value"):
            if not isinstance(request[key], str) or not request[key] or len(request[key].encode()) > 65536:
                return {"status": "invalid_request"}
        permitted = {value.strip().lower() for value in environment.get("BWS_ALLOWED_WRITE_SECRET_IDS", "").split(",")}
        if identifier.lower() not in permitted:
            return {"status": "not_authorized"}
        endpoints = [environment.get("BWS_SDK_API_URL", ""), environment.get("BWS_SDK_IDENTITY_URL", "")]
        for value in endpoints:
            url = urlsplit(value)
            if url.scheme != "https" or not url.hostname or url.username or url.password or url.query or url.fragment:
                return {"status": "provider_unavailable"}
        if not environment.get("BWS_ACCESS_TOKEN"):
            return {"status": "provider_unavailable"}
        client = client_factory(endpoints[0], endpoints[1])
        # None deliberately disables SDK auth state-file caching.
        login = client.auth().login_access_token(environment["BWS_ACCESS_TOKEN"], None)
        if not login.success:
            return {"status": "provider_unavailable"}
        current = client.secrets().get(identifier).data
        if not current or str(current.id).lower() != identifier.lower():
            return {"status": "provider_unavailable"}
        if not hmac.compare_digest(current.value.encode(), request["expectedValue"].encode()):
            # Reconcile a response-lost write without replaying the provider refresh.
            if hmac.compare_digest(current.value.encode(), request["value"].encode()):
                return {"id": identifier, "status": "committed", "revision": current.revision_date.isoformat()}
            return {"status": "conflict"}
        attempted = True
        client.secrets().update(str(current.organization_id), identifier, current.key, request["value"], current.note,
                                [current.project_id] if current.project_id else [])
        after = client.secrets().get(identifier).data
        if not after or str(after.id).lower() != identifier.lower() or not hmac.compare_digest(after.value.encode(), request["value"].encode()):
            return {"status": "unknown"}
        if (after.key, after.note, after.organization_id, after.project_id) != (current.key, current.note, current.organization_id, current.project_id):
            return {"status": "unknown"}
        return {"id": identifier, "status": "committed", "revision": after.revision_date.isoformat()}
    except Exception:
        return {"status": "unknown" if attempted else "provider_unavailable"}


def check_sdk():
    if importlib.metadata.version("bitwarden-sdk") != SDK_VERSION:
        raise RuntimeError("SDK_VERSION_UNAVAILABLE")
    from bitwarden_sdk import BitwardenClient, DeviceType, client_settings_from_dict
    if not callable(BitwardenClient) or not callable(client_settings_from_dict) or not hasattr(DeviceType, "SDK"):
        raise RuntimeError("SDK_API_UNAVAILABLE")


def sdk_client(api_url, identity_url):
    check_sdk()
    from bitwarden_sdk import BitwardenClient, DeviceType, client_settings_from_dict
    return BitwardenClient(client_settings_from_dict({"apiUrl": api_url, "identityUrl": identity_url,
                                                     "deviceType": DeviceType.SDK, "userAgent": "HardyHome"}))


def main():
    if sys.argv[1:] == ["--check"]:
        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                check_sdk()
            receipt = {"status": "ready", "sdkVersion": SDK_VERSION}
        except Exception:
            receipt = {"status": "provider_unavailable"}
        sys.stdout.write(json.dumps(receipt) + "\n")
        return
    try:
        if sys.argv[1:]:
            raise ValueError()
        data = sys.stdin.buffer.read(160 * 1024 + 1)
        if len(data) > 160 * 1024:
            raise ValueError()
        request = json.loads(data)
        # Never forward SDK debug output, errors, responses or secret values.
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            receipt = writeback(request, os.environ, sdk_client)
    except Exception:
        receipt = {"status": "invalid_request"}
    sys.stdout.write(json.dumps(receipt) + "\n")


if __name__ == "__main__":
    main()
