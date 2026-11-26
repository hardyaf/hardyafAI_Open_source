import base64
import binascii
import json
import re

from .authority import TRUSTED_EVIDENCE
from .errors import bounded_int, require, text
from .store import canonical, digest, identifier, now
from .validation import interpretation_shape, INTERPRETED_FIELDS


def public_receipt(row):
    return {"receiptId": row["id"], "sourceSha256": row["source_sha256"], "artifactId": row["artifact_id"],
            "filename": row["filename"], "mimeType": row["mime_type"], "latestRevision": row["latest_revision"],
            "acceptedRevision": row["accepted_revision"], "disposition": row["disposition"],
            "disputed": bool(row["disputed"]), "createdAt": row["created_at"], "updatedAt": row["updated_at"]}


def intake(store, principal, params, operation_id):
    require(set(params) == {"source"})
    source = params["source"]
    require(isinstance(source, dict) and set(source) == {"artifactId", "contentBase64", "sha256", "filename", "mimeType"})
    require(isinstance(source["artifactId"], str) and re.fullmatch(r"artifact-[a-f0-9]{64}", source["artifactId"]))
    name = text(source["filename"], 180)
    require(not any(part in name for part in ["/", "\\", "\x00"]))
    require(source["mimeType"] in {"image/png", "image/jpeg", "image/webp", "application/pdf"}, "receipt_source_media_unsupported")
    require(isinstance(source["contentBase64"], str) and len(source["contentBase64"]) <= 35_000_000)
    try:
        content = base64.b64decode(source["contentBase64"], validate=True)
    except (ValueError, binascii.Error):
        require(False)
    require(1 <= len(content) <= 25*1024*1024, "receipt_source_size_invalid")
    signatures = {"image/png": content.startswith(b"\x89PNG\r\n\x1a\n"), "image/jpeg": content.startswith(b"\xff\xd8\xff"),
                  "image/webp": content.startswith(b"RIFF") and content[8:12] == b"WEBP", "application/pdf": content.startswith(b"%PDF-")}
    require(signatures[source["mimeType"]], "receipt_source_media_mismatch")
    require(source["sha256"] == digest(content), "receipt_source_hash_mismatch")
    receipt_id = identifier("receipt-", source["sha256"])
    existing = store.connection.execute("SELECT id FROM uplift_receipts WHERE source_sha256=?", (source["sha256"],)).fetchone()
    if existing:
        store.receipt(principal, existing[0])

    def commit():
        existing = store.connection.execute("SELECT * FROM uplift_receipts WHERE source_sha256=?", (source["sha256"],)).fetchone()
        if existing:
            store.receipt(principal, existing["id"])
            return {"receipt": public_receipt(existing), "duplicateIntake": True}
        relative = store.save_original(source["sha256"], content)
        timestamp = now()
        store.connection.execute("INSERT OR IGNORE INTO ingest_documents(sha256,source_path,source_name,size_bytes,stored_path,first_ingested_at_utc) VALUES (?,?,?,?,?,?)",
                                 (source["sha256"], "artifact://"+source["artifactId"], name, len(content), str(store.vault/relative), timestamp))
        store.connection.execute("INSERT INTO uplift_receipts(id,source_sha256,owner_actor_id,artifact_id,filename,mime_type,source_relative_path,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
                                 (receipt_id, source["sha256"], principal.actor_id, source["artifactId"], name, source["mimeType"], relative, timestamp, timestamp))
        return {"receipt": public_receipt(store.receipt(principal, receipt_id)), "duplicateIntake": False}
    # The source is large; hash its immutable content/metadata in the operation fingerprint.
    fingerprint = {"source": {key: value for key, value in source.items() if key != "contentBase64"}}
    return store.mutate(principal, "source.intake", operation_id, fingerprint, commit)


def source_get(store, principal, params):
    require(set(params) == {"receiptId"})
    receipt = store.receipt(principal, text(params["receiptId"], 128))
    store.read_original(receipt["source_relative_path"], receipt["source_sha256"])
    return {"receipt": public_receipt(receipt), "originalVerified": True}


def evidence_add(store, principal, params, operation_id, trusted=False):
    require(set(params) <= {"receiptId", "text", "sourceRef"} and {"receiptId", "text"} <= set(params))
    receipt_id = text(params["receiptId"], 128)
    receipt = store.receipt(principal, receipt_id)
    body = text(params["text"], 200_000)
    kind = "reasoning"
    facts = {}
    source_sha = None
    source_ref = text(params.get("sourceRef", "agent-observation"), 300)
    if trusted:
        origin = principal.evidence_origin
        require(origin is not None and origin["kind"] in TRUSTED_EVIDENCE, "receipt_evidence_origin_required", 403)
        kind, source_ref = origin["kind"], origin["sourceRef"]
        source_sha = origin.get("sourceSha256")
        facts = origin.get("facts", {})
        require(len(canonical(facts)) <= 16_000)
        if kind == "local_ocr":
            require(source_sha == receipt["source_sha256"], "receipt_evidence_source_mismatch", 403)
            require(not facts, "receipt_ocr_facts_not_authorized", 403)
        if kind == "project_context":
            require(set(facts) <= {"projectCode", "projectRevision"} and "projectCode" in facts)
            principal.project(facts["projectCode"])
            project = store.connection.execute("SELECT * FROM uplift_projects WHERE code=?", (facts["projectCode"],)).fetchone()
            require(project and project["active"] and facts.get("projectRevision") == project["revision"], "receipt_project_context_stale", 409)
            require(body == project["context_text"], "receipt_project_context_mismatch", 403)
    clarification = facts.get("clarification")
    if clarification is not None:
        require(kind == "user_statement" and principal.can_review, "receipt_review_not_authorized", 403)
        require(isinstance(clarification, dict) and set(clarification) == {"receiptId", "revision", "rationale", "ambiguity"})
        require(clarification["receiptId"] == receipt_id, "receipt_review_binding_mismatch", 403)
        bounded_int(clarification["revision"], 1); text(clarification["rationale"], 2000)
        require(clarification["ambiguity"] in {"clear", "uncertain"})
        fields = facts.get("interpretedFields", [])
        require(isinstance(fields, list) and len(fields) <= 5)
        for part in fields:
            require(isinstance(part, dict) and set(part) == {"field", "value", "rationale", "ambiguity"})
            require(part["field"] in INTERPRETED_FIELDS | {"projectCode"})
            interpretation_shape({key: value for key, value in part.items() if key != "field"})
            require(clarification["ambiguity"] != "uncertain" or part["ambiguity"] == "uncertain")
            if part["field"] == "projectCode":
                principal.project(part["value"])
        require(len({part["field"] for part in fields}) == len(fields))
        distinct = facts.get("distinctReceiptIds")
        if distinct is not None:
            require(clarification["ambiguity"] == "clear" and isinstance(distinct, list) and 2 <= len(distinct) <= 20)
            require(all(isinstance(value, str) and re.fullmatch(r"receipt-[a-f0-9]{48}", value) for value in distinct))
            require(distinct == sorted(set(distinct)) and receipt_id in distinct)
            for other in distinct:
                store.receipt(principal, other)
    else:
        require("interpretedFields" not in facts, "receipt_clarification_binding_required", 403)
    record = {"receiptId": receipt_id, "kind": kind, "sourceRef": source_ref, "sourceSha256": source_sha, "text": body, "facts": facts}
    evidence_id = identifier("evidence-", record)
    def commit():
        if clarification is not None:
            current_receipt = store.receipt(principal, receipt_id)
            require(clarification["revision"] == current_receipt["latest_revision"] or current_receipt["disputed"] and clarification["revision"] == current_receipt["accepted_revision"], "receipt_review_revision_conflict", 409)
            for other in facts.get("distinctReceiptIds", []):
                store.receipt(principal, other)
        if kind == "project_context":
            current = store.connection.execute("SELECT * FROM uplift_projects WHERE code=?", (facts["projectCode"],)).fetchone()
            require(current and current["active"] and current["revision"] == facts["projectRevision"] and current["context_text"] == body, "receipt_project_context_stale", 409)
        store.connection.execute("INSERT OR IGNORE INTO uplift_evidence(id,receipt_id,kind,source_ref,source_sha256,text_content,facts_json,content_hash,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                                 (evidence_id, receipt_id, kind, source_ref, source_sha, body, canonical(facts), digest(record), principal.actor_id, now()))
        return {"evidenceId": evidence_id, "kind": kind, "receiptId": receipt_id, "sourceRef": source_ref}
    return store.mutate(principal, "evidence.record" if trusted else "evidence.add", operation_id, record, commit, receipt_id=receipt_id)


def evidence_list(store, principal, params):
    require(set(params) <= {"receiptId", "limit"} and "receiptId" in params)
    receipt_id = text(params["receiptId"], 128)
    store.receipt(principal, receipt_id)
    limit = bounded_int(params.get("limit", 100), 1, 200)
    records = store.connection.execute("SELECT id,kind,source_ref,source_sha256,text_content,created_at FROM uplift_evidence WHERE receipt_id=? ORDER BY created_at,id LIMIT ?", (receipt_id, limit)).fetchall()
    return {"receiptId": receipt_id, "evidence": [{"evidenceId": row["id"], "kind": row["kind"], "sourceRef": row["source_ref"],
            "sourceSha256": row["source_sha256"], "excerpt": row["text_content"][:280], "characters": len(row["text_content"]), "createdAt": row["created_at"]} for row in records],
            "truncated": len(records) == limit}


def evidence_read(store, principal, params):
    require(set(params) <= {"receiptId", "evidenceId", "offset", "length"} and {"receiptId", "evidenceId"} <= set(params))
    receipt_id = text(params["receiptId"], 128)
    store.receipt(principal, receipt_id)
    offset = bounded_int(params.get("offset", 0), 0, 200_000)
    length = bounded_int(params.get("length", 8000), 1, 16000)
    row = store.connection.execute("SELECT * FROM uplift_evidence WHERE id=? AND receipt_id=?", (text(params["evidenceId"], 128), receipt_id)).fetchone()
    require(row is not None, "receipt_evidence_not_found", 404)
    return {"evidenceId": row["id"], "kind": row["kind"], "sourceRef": row["source_ref"], "facts": json.loads(row["facts_json"]),
            "offset": offset, "text": row["text_content"][offset:offset+length], "characters": len(row["text_content"]), "hasMore": offset+length < len(row["text_content"])}
