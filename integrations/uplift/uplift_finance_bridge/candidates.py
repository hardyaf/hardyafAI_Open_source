import json

from . import POLICY_VERSION
from .authority import receipt_access
from .errors import ReceiptError, bounded_int, require, text
from .sources import public_receipt
from .store import canonical, digest, identifier, now
from .validation import candidate_shape, field_grounded, PRECISIONS, resolved_refs, validate


def projects(store):
    return {row["code"]: dict(row) for row in store.connection.execute("SELECT * FROM uplift_projects")}


def duplicate_candidates(store, principal, receipt_id, candidate):
    matches = []
    if any(candidate.get(key) is None for key in ["vendor", "date", "currency", "totalMinor"]):
        return matches
    rows = store.connection.execute("SELECT r.id,v.candidate_json FROM uplift_receipts r JOIN uplift_revisions v ON v.receipt_id=r.id AND v.revision=r.latest_revision WHERE r.id<>? AND r.disposition<>'excluded' AND json_extract(v.candidate_json,'$.date')=? AND json_extract(v.candidate_json,'$.currency')=? AND json_extract(v.candidate_json,'$.totalMinor')=? ORDER BY r.id LIMIT 1001", (receipt_id, candidate["date"], candidate["currency"], candidate["totalMinor"])).fetchall()
    require(len(rows) <= 1000, "receipt_duplicate_query_limit", 413)
    for row in rows:
        other = json.loads(row["candidate_json"])
        same = all(other.get(key) == candidate.get(key) for key in ["date", "currency", "totalMinor"]) and str(other.get("vendor", "")).casefold().strip() == candidate["vendor"].casefold().strip()
        if same:
            try:
                receipt_access(store.connection, principal, row["id"])
                visible = True
            except ReceiptError:
                visible = False
            matches.append({"receiptId": row["id"], "visible": visible, "candidate": other})
    return matches


def duplicate_reasons(store, principal, receipt_id, candidate, evidence):
    matches = duplicate_candidates(store, principal, receipt_id, candidate)
    if not matches:
        return []
    resolution = candidate.get("duplicateResolution", {})
    if resolution.get("decision") != "distinct" or not resolution.get("rationale"):
        return ["possible_duplicate"]
    refs = resolved_refs(resolution.get("evidence", []), evidence)
    if any(item["kind"] == "user_statement" and item.get("facts", {}).get("distinctReceiptIds") == sorted([receipt_id] + [match["receiptId"] for match in matches]) for item, _ in refs):
        return []
    transaction_ref = candidate.get("transactionRef")
    if not transaction_ref or not field_grounded("transactionRef", transaction_ref, candidate.get("fieldEvidence", {}).get("transactionRef", []), evidence, PRECISIONS.get(candidate.get("currency"))):
        return ["possible_duplicate"]
    for match in matches:
        other = match["candidate"]
        other_ref = other.get("transactionRef")
        other_evidence = store.evidence(match["receiptId"])
        if not match["visible"] or not other_ref or other_ref == transaction_ref or not field_grounded("transactionRef", other_ref, other.get("fieldEvidence", {}).get("transactionRef", []), other_evidence, PRECISIONS.get(other.get("currency"))):
            return ["possible_duplicate"]
    return []


def validation(store, principal, receipt_id, body):
    evidence = store.evidence(receipt_id)
    return validate(body, evidence, projects(store), principal.project_codes, duplicate_reasons(store, principal, receipt_id, body, evidence))


def update_review(store, receipt_id, revision, reasons):
    review_id = identifier("review-", [receipt_id, revision])
    timestamp = now()
    store.connection.execute("INSERT INTO uplift_reviews(id,receipt_id,revision,reasons_json,status,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(receipt_id,revision) DO UPDATE SET reasons_json=excluded.reasons_json,status=excluded.status,updated_at=excluded.updated_at",
                             (review_id, receipt_id, revision, canonical(reasons), "open" if reasons else "resolved", timestamp))
    return review_id if reasons else None


def candidate_save(store, principal, params, operation_id):
    require(set(params) == {"receiptId", "expectedRevision", "candidate"})
    receipt_id = text(params["receiptId"], 128)
    expected = bounded_int(params["expectedRevision"])
    body = candidate_shape(params["candidate"])
    # A candidate may be provisional, but cannot claim an unauthorized project.
    for allocation in body.get("allocations", []):
        principal.project(allocation["projectCode"])
    def commit():
        receipt = store.receipt(principal, receipt_id)
        require(receipt["latest_revision"] == expected, "receipt_revision_conflict", 409)
        require(receipt["disposition"] != "excluded", "receipt_excluded", 409)
        result = validation(store, principal, receipt_id, body)
        revision = expected + 1
        store.connection.execute("INSERT INTO uplift_revisions(receipt_id,revision,parent_revision,state,candidate_json,candidate_hash,validation_json,created_by,created_at) VALUES (?,?,?,'provisional',?,?,?,?,?)",
                                 (receipt_id, revision, expected, canonical(body), digest(body), canonical(result), principal.actor_id, now()))
        # Candidate staging never destroys a previously accepted revision.
        disposition = "accepted" if receipt["accepted_revision"] is not None else "provisional"
        store.connection.execute("UPDATE uplift_receipts SET latest_revision=?,disposition=?,updated_at=? WHERE id=?", (revision, disposition, now(), receipt_id))
        store.connection.execute("UPDATE uplift_reviews SET status='superseded',updated_at=? WHERE receipt_id=? AND status='open' AND revision<? AND NOT (?=1 AND revision=?)",
                                 (now(), receipt_id, revision, receipt["disputed"], receipt["accepted_revision"] or -1))
        review_id = update_review(store, receipt_id, revision, result["reasons"])
        return {"receiptId": receipt_id, "revision": revision, "state": "provisional", "validation": result, "reviewId": review_id, "acceptedRevisionPreserved": receipt["accepted_revision"]}
    return store.mutate(principal, "candidate.save", operation_id, params, commit, receipt_id=receipt_id)


def candidate_get(store, principal, params):
    require(set(params) <= {"receiptId", "revision"} and "receiptId" in params)
    receipt_id = text(params["receiptId"], 128)
    receipt = store.receipt(principal, receipt_id)
    revision = bounded_int(params.get("revision", receipt["latest_revision"]), 1)
    row = store.revision(receipt_id, revision, principal)
    body = json.loads(row["candidate_json"])
    for allocation in body.get("allocations", []):
        principal.project(allocation["projectCode"])
    return {"receiptId": receipt_id, "revision": revision, "state": row["state"], "candidate": body, "savedValidation": json.loads(row["validation_json"])}


def candidate_validate(store, principal, params):
    require(set(params) == {"receiptId", "revision"})
    receipt_id = text(params["receiptId"], 128)
    store.receipt(principal, receipt_id)
    revision = bounded_int(params["revision"], 1)
    row = store.revision(receipt_id, revision, principal)
    return {"receiptId": receipt_id, "revision": revision, "validation": validation(store, principal, receipt_id, json.loads(row["candidate_json"]))}


def candidate_accept(store, principal, params, operation_id):
    require(set(params) <= {"receiptId", "revision", "exception"} and {"receiptId", "revision"} <= set(params))
    receipt_id = text(params["receiptId"], 128)
    revision = bounded_int(params["revision"], 1)
    def commit():
        receipt = store.receipt(principal, receipt_id)
        require(receipt["latest_revision"] == revision, "receipt_revision_conflict", 409)
        require(receipt["disposition"] != "excluded", "receipt_excluded", 409)
        row = store.revision(receipt_id, revision)
        body = json.loads(row["candidate_json"])
        for allocation in body.get("allocations", []):
            principal.project(allocation["projectCode"])
        store.read_original(receipt["source_relative_path"], receipt["source_sha256"])
        result = validation(store, principal, receipt_id, body)
        if params.get("exception") is not None:
            result = apply_exception(principal, params["exception"], receipt_id, revision, result, store.evidence(receipt_id))
        if not result["valid"]:
            review_id = update_review(store, receipt_id, revision, result["reasons"])
            return {"receiptId": receipt_id, "revision": revision, "accepted": False, "validation": result, "reviewId": review_id}
        prior = receipt["accepted_revision"]
        if prior == revision:
            return {"receiptId": receipt_id, "revision": revision, "accepted": True, "validation": result, "alreadyAccepted": True}
        acceptance_id = identifier("acceptance-", [receipt_id, revision, POLICY_VERSION])
        timestamp = now()
        if prior is not None:
            store.connection.execute("UPDATE uplift_revisions SET state='superseded' WHERE receipt_id=? AND revision=?", (receipt_id, prior))
        store.connection.execute("UPDATE uplift_revisions SET state='accepted' WHERE receipt_id=? AND revision=?", (receipt_id, revision))
        store.connection.execute("INSERT INTO uplift_acceptances(id,receipt_id,revision,policy_version,profile,verification_level,actor_id,operation_id,evidence_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                                 (acceptance_id, receipt_id, revision, POLICY_VERSION, body["profile"], result["verificationLevel"], principal.actor_id, operation_id, canonical({"validation": result, "candidateHash": row["candidate_hash"], "evidenceIds": sorted(store.evidence(receipt_id))}), timestamp))
        store.connection.execute("INSERT INTO uplift_financial_entries(receipt_id,revision,acceptance_id,currency,total_minor,profile,purchase_date,vendor,allocations_json,verification_level) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(receipt_id) DO UPDATE SET revision=excluded.revision,acceptance_id=excluded.acceptance_id,currency=excluded.currency,total_minor=excluded.total_minor,profile=excluded.profile,purchase_date=excluded.purchase_date,vendor=excluded.vendor,allocations_json=excluded.allocations_json,verification_level=excluded.verification_level",
                                 (receipt_id, revision, acceptance_id, body["currency"], body["totalMinor"], body["profile"], body["date"], body["vendor"], canonical(body["allocations"]), result["verificationLevel"]))
        store.connection.execute("UPDATE uplift_receipts SET accepted_revision=?,disposition='accepted',disputed=0,updated_at=? WHERE id=?", (revision, timestamp, receipt_id))
        store.connection.execute("UPDATE uplift_reviews SET status='superseded',updated_at=? WHERE receipt_id=? AND status='open' AND revision<>?", (timestamp, receipt_id, revision))
        update_review(store, receipt_id, revision, [])
        projection = store.connection.execute("SELECT revision,total_minor FROM uplift_financial_entries WHERE receipt_id=?", (receipt_id,)).fetchone()
        require(projection["revision"] == revision and projection["total_minor"] == body["totalMinor"], "receipt_acceptance_readback_failed", 503)
        return {"receiptId": receipt_id, "revision": revision, "accepted": True, "acceptanceId": acceptance_id, "validation": result, "readbackVerified": True}
    return store.mutate(principal, "candidate.accept", operation_id, params, commit, receipt_id=receipt_id)


def apply_exception(principal, exception, receipt_id, revision, result, evidence):
    require(principal.can_review, "receipt_exception_not_authorized", 403)
    require(isinstance(exception, dict) and set(exception) == {"waiveReasons", "reason", "evidenceId"})
    waived = exception["waiveReasons"]
    allowed = {"unexplained_total_difference", "missing_itemized_detail", "missing_item_amount", "unsupported_item_amount", "unsupported_adjustment", "unsupported_subtotal", "item_subtotal_mismatch", "missing_reconciliation_base"}
    require(isinstance(waived, list) and waived and all(isinstance(code, str) and code in allowed for code in waived), "receipt_exception_structural_bypass_forbidden", 403)
    require(len(set(waived)) == len(waived) and set(waived) <= set(result["reasons"]), "receipt_exception_reasons_mismatch", 409)
    reason = text(exception["reason"], 2000)
    approved = evidence.get(exception["evidenceId"])
    expected = {"receiptId": receipt_id, "revision": revision, "waivedReasons": sorted(waived), "reason": reason}
    require(approved and approved["kind"] == "user_statement" and approved.get("facts", {}).get("approvedException") == expected,
            "receipt_exception_explicit_user_evidence_required", 403)
    remaining = sorted(set(result["reasons"])-set(waived))
    return {**result, "valid": not remaining, "reasons": remaining, "waiversApplied": True,
            "waivedReasons": sorted(waived), "exceptionReason": reason, "exceptionEvidenceId": approved["id"],
            "verificationLevel": "unverified_exception"}


def duplicates(store, principal, params):
    require(set(params) == {"receiptId", "revision"})
    receipt_id = text(params["receiptId"], 128)
    store.receipt(principal, receipt_id)
    row = store.revision(receipt_id, bounded_int(params["revision"], 1), principal)
    matches = duplicate_candidates(store, principal, receipt_id, json.loads(row["candidate_json"]))
    return {"receiptId": receipt_id, "matches": [{"receiptId": match["receiptId"], "reason": "same_vendor_date_currency_total"} for match in matches if match["visible"]],
            "restrictedMatchRequiresReview": any(not match["visible"] for match in matches), "automaticMerge": False}


def receipt_get(store, principal, params):
    require(set(params) == {"receiptId"})
    receipt_id = text(params["receiptId"], 128)
    receipt = store.receipt(principal, receipt_id)
    rows = store.connection.execute("SELECT id,revision,reasons_json FROM uplift_reviews WHERE receipt_id=? AND status='open' ORDER BY revision DESC LIMIT 100", (receipt_id,)).fetchall()
    open_reviews = []
    for row in rows:
        try:
            store.revision(receipt_id, row["revision"], principal)
            open_reviews.append(row)
        except ReceiptError:
            pass
    open_reviews = open_reviews[:20]
    attempts = store.connection.execute("SELECT native_task_ref,phase_ref,state,error_code,candidate_revision,created_at FROM uplift_attempt_events WHERE receipt_id=? ORDER BY created_at DESC LIMIT 20", (receipt_id,)).fetchall()
    return {"receipt": public_receipt(receipt), "openReviews": [{"reviewId": row["id"], "revision": row["revision"], "reasons": json.loads(row["reasons_json"])} for row in open_reviews], "attempts": [dict(row) for row in attempts]}
