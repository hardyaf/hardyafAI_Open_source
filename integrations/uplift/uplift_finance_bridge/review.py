import json
import re

from .candidates import update_review
from .errors import bounded_int, require, text
from .sources import public_receipt
from .store import canonical, identifier, now
from .validation import resolved_refs, refs
from .authority import VISIBLE_RECEIPTS, visibility_parameters


def receipt_exclude(store, principal, params, operation_id):
    require(principal.can_review, "receipt_review_not_authorized", 403)
    require(set(params) <= {"receiptId", "expectedRevision", "reason", "duplicateOf"} and {"receiptId", "expectedRevision", "reason"} <= set(params))
    receipt_id = text(params["receiptId"], 128)
    expected = bounded_int(params["expectedRevision"])
    reason = text(params["reason"], 2000)
    duplicate = params.get("duplicateOf")
    if duplicate is not None:
        text(duplicate, 128); require(duplicate != receipt_id)
        store.receipt(principal, duplicate)
    def commit():
        receipt = store.receipt(principal, receipt_id)
        require(receipt["latest_revision"] == expected, "receipt_revision_conflict", 409)
        # Remove only the current projection; source, revisions and acceptances remain.
        store.connection.execute("DELETE FROM uplift_financial_entries WHERE receipt_id=?", (receipt_id,))
        store.connection.execute("UPDATE uplift_receipts SET disposition='excluded',accepted_revision=NULL,disputed=0,updated_at=? WHERE id=?", (now(), receipt_id))
        store.connection.execute("UPDATE uplift_reviews SET status='excluded',updated_at=? WHERE receipt_id=? AND status='open'", (now(), receipt_id))
        return {"receiptId": receipt_id, "disposition": "excluded", "reason": reason, "duplicateOf": duplicate, "originalAndHistoryRetained": True}
    return store.mutate(principal, "receipt.exclude", operation_id, params, commit, receipt_id=receipt_id)


def receipt_dispute(store, principal, params, operation_id):
    require(principal.can_review, "receipt_review_not_authorized", 403)
    require(set(params) == {"receiptId", "acceptedRevision", "reason", "evidence"})
    receipt_id = text(params["receiptId"], 128)
    accepted = bounded_int(params["acceptedRevision"], 1)
    reason = text(params["reason"], 2000)
    references = refs(params["evidence"])
    def commit():
        receipt = store.receipt(principal, receipt_id)
        require(receipt["accepted_revision"] == accepted, "receipt_revision_conflict", 409)
        grounded = resolved_refs(references, store.evidence(receipt_id))
        require(any(item["kind"] in {"local_ocr", "user_statement", "standing_rule"} for item, _ in grounded), "receipt_dispute_evidence_required")
        store.connection.execute("UPDATE uplift_receipts SET disputed=1,updated_at=? WHERE id=?", (now(), receipt_id))
        review_id = update_review(store, receipt_id, accepted, ["accepted_revision_disputed", reason])
        return {"receiptId": receipt_id, "acceptedRevision": accepted, "disputed": True, "reviewId": review_id, "finalReportRequiresReview": True}
    return store.mutate(principal, "receipt.dispute", operation_id, params, commit, receipt_id=receipt_id)


def attempt_record(store, principal, params, operation_id):
    require(set(params) <= {"receiptId", "nativeTaskRef", "phaseRef", "state", "errorCode", "candidateRevision"} and {"receiptId", "nativeTaskRef", "phaseRef", "state"} <= set(params))
    receipt_id = text(params["receiptId"], 128)
    task_ref = text(params["nativeTaskRef"], 200)
    phase_ref = text(params["phaseRef"], 200)
    state = params["state"]
    require(state in {"processing", "processed", "failed"})
    error = params.get("errorCode")
    require(error is None or isinstance(error, str) and re.fullmatch(r"[a-z][a-z0-9_]{1,79}", error))
    require(state != "failed" or error is not None)
    revision = params.get("candidateRevision")
    if revision is not None:
        bounded_int(revision, 1)
    def commit():
        receipt = store.receipt(principal, receipt_id)
        if revision is not None:
            store.revision(receipt_id, revision)
        event_id = identifier("attempt-", [principal.actor_id, operation_id])
        store.connection.execute("INSERT INTO uplift_attempt_events(id,receipt_id,native_task_ref,phase_ref,state,error_code,candidate_revision,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                                 (event_id, receipt_id, task_ref, phase_ref, state, error, revision, principal.actor_id, now()))
        return {"attemptEventId": event_id, "receiptId": receipt_id, "processingState": state, "acceptedRevisionPreserved": receipt["accepted_revision"], "ownsExecution": False}
    return store.mutate(principal, "attempt.record", operation_id, params, commit, receipt_id=receipt_id)


def review_list(store, principal, params):
    require(set(params) <= {"limit", "receiptId"})
    limit = bounded_int(params.get("limit", 100), 1, 200)
    if params.get("receiptId") is not None:
        receipt_id = text(params["receiptId"], 128)
        store.receipt(principal, receipt_id)
        rows = store.connection.execute("SELECT * FROM uplift_reviews WHERE status='open' AND receipt_id=? ORDER BY updated_at,id LIMIT ?", (receipt_id, limit)).fetchall()
    else:
        query = "SELECT rv.* FROM uplift_reviews rv JOIN ("+VISIBLE_RECEIPTS+") authorized ON authorized.id=rv.receipt_id WHERE rv.status='open' ORDER BY rv.updated_at,rv.id LIMIT 2001"
        rows = store.connection.execute(query, visibility_parameters(principal)).fetchall()
        require(len(rows) <= 2000, "receipt_review_query_limit", 413)
    visible = []
    from .errors import ReceiptError
    for row in rows:
        try:
            receipt = store.receipt(principal, row["receipt_id"])
            store.revision(row["receipt_id"], row["revision"], principal)
        except ReceiptError:
            continue
        visible.append({"reviewId": row["id"], "receiptId": row["receipt_id"], "revision": row["revision"], "reasons": json.loads(row["reasons_json"]),
                        "source": public_receipt(receipt), "updatedAt": row["updated_at"]})
    return {"items": visible[:limit], "hasMore": len(visible) > limit, "queueKind": "view_of_uplift_exceptions"}


def review_respond(store, principal, params, operation_id):
    require(principal.can_review, "receipt_review_not_authorized", 403)
    require(set(params) == {"reviewId", "revision", "text"})
    review_id = text(params["reviewId"], 128)
    revision = bounded_int(params["revision"], 1)
    body = text(params["text"], 16000)
    review = store.connection.execute("SELECT * FROM uplift_reviews WHERE id=?", (review_id,)).fetchone()
    require(review is not None, "receipt_review_not_found", 404)
    receipt_id = review["receipt_id"]
    def commit():
        current = store.connection.execute("SELECT * FROM uplift_reviews WHERE id=?", (review_id,)).fetchone()
        require(current["revision"] == revision and current["status"] == "open", "receipt_review_revision_conflict", 409)
        receipt = store.receipt(principal, receipt_id)
        require(revision == receipt["latest_revision"] or receipt["disputed"] and revision == receipt["accepted_revision"], "receipt_review_revision_conflict", 409)
        store.revision(receipt_id, revision, principal)
        response_id = identifier("response-", [principal.actor_id, operation_id])
        store.connection.execute("INSERT INTO uplift_review_responses(id,review_id,actor_id,response_text,created_at) VALUES (?,?,?,?,?)", (response_id, review_id, principal.actor_id, body, now()))
        return {"reviewId": review_id, "revision": revision, "responseId": response_id, "status": "open", "requiresReasoning": True, "accepted": False}
    return store.mutate(principal, "review.respond", operation_id, params, commit, receipt_id=receipt_id)


def review_get(store, principal, params):
    require(set(params) == {"reviewId"})
    row = store.connection.execute("SELECT * FROM uplift_reviews WHERE id=?", (text(params["reviewId"], 128),)).fetchone()
    require(row is not None, "receipt_review_not_found", 404)
    receipt = store.receipt(principal, row["receipt_id"])
    store.revision(row["receipt_id"], row["revision"], principal)
    responses = store.connection.execute("SELECT id,actor_id,response_text,created_at FROM uplift_review_responses WHERE review_id=? ORDER BY created_at,id LIMIT 100", (row["id"],)).fetchall()
    return {"reviewId": row["id"], "receipt": public_receipt(receipt), "revision": row["revision"], "status": row["status"],
            "reasons": json.loads(row["reasons_json"]), "responses": [dict(response) for response in responses]}
