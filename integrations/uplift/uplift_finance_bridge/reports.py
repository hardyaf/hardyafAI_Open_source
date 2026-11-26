import csv
import io
import json

from .authority import receipt_access, VISIBLE_RECEIPTS, visibility_parameters
from .errors import ReceiptError, bounded_int, require, text
from .sources import public_receipt
from .validation import PRECISIONS


def receipt_list(store, principal, params):
    require(set(params) <= {"limit", "afterReceiptId", "disposition"})
    limit = bounded_int(params.get("limit", 100), 1, 200)
    after = text(params.get("afterReceiptId", ""), 128, empty=True)
    disposition = params.get("disposition")
    require(disposition is None or disposition in {"received", "provisional", "accepted", "excluded"})
    query = "SELECT * FROM ("+VISIBLE_RECEIPTS+") WHERE id>:after AND (:disposition IS NULL OR disposition=:disposition) ORDER BY id LIMIT :limit"
    rows = store.connection.execute(query, {**visibility_parameters(principal), "after": after, "disposition": disposition, "limit": limit+1}).fetchall()
    result = [public_receipt(row) for row in rows[:limit]]
    return {"receipts": result, "nextAfterReceiptId": result[-1]["receiptId"] if len(rows)>limit else None}


def report_generate(store, principal, params):
    require(set(params) <= {"projectCode", "mode", "profile", "format", "startDate", "endDate"})
    mode, profile, fmt = params.get("mode", "final"), params.get("profile", "summary"), params.get("format", "json")
    require(mode in {"final", "draft"} and profile in {"summary", "itemized"} and fmt in {"json", "csv", "pdf", "xlsx"})
    code = params.get("projectCode")
    if code is not None:
        text(code, 64); principal.project(code)
    for key in ["startDate", "endDate"]:
        if params.get(key) is not None:
            from datetime import datetime
            try:
                require(datetime.strptime(text(params[key], 10), "%Y-%m-%d").date().isoformat() == params[key])
            except ValueError:
                require(False)
    if params.get("startDate") and params.get("endDate"):
        require(params["startDate"] <= params["endDate"])
    receipts = store.connection.execute("SELECT * FROM ("+VISIBLE_RECEIPTS+") ORDER BY id LIMIT 5001", visibility_parameters(principal)).fetchall()
    require(len(receipts) <= 5000, "receipt_report_query_limit", 413)
    accepted_rows, provisional_rows, withheld = [], [], []
    counts = {"received": 0, "provisional": 0, "accepted": 0, "excluded": 0, "processingFailed": 0, "disputed": 0, "unsupportedProfile": 0, "unverifiedExceptions": 0}
    accepted_totals, provisional_totals = {}, {}
    report_bytes = 0
    for receipt in receipts:
        try:
            receipt_access(store.connection, principal, receipt["id"])
        except ReceiptError:
            continue
        entry = store.connection.execute("SELECT * FROM uplift_financial_entries WHERE receipt_id=? AND revision=?", (receipt["id"], receipt["accepted_revision"])).fetchone()
        candidate_row = store.connection.execute("SELECT * FROM uplift_revisions WHERE receipt_id=? AND revision=?", (receipt["id"], receipt["latest_revision"])).fetchone()
        body = json.loads(candidate_row["candidate_json"]) if candidate_row else None
        allocations = json.loads(entry["allocations_json"]) if entry else body.get("allocations", []) if body else []
        if code is not None and not any(part["projectCode"] == code for part in allocations):
            continue
        date = entry["purchase_date"] if entry else body.get("date") if body else None
        if params.get("startDate") and (not date or date < params["startDate"]):
            continue
        if params.get("endDate") and (not date or date > params["endDate"]):
            continue
        counts[receipt["disposition"]] += 1
        latest_attempt = store.connection.execute("SELECT state FROM uplift_attempt_events WHERE receipt_id=? ORDER BY created_at DESC,id DESC LIMIT 1", (receipt["id"],)).fetchone()
        if latest_attempt and latest_attempt[0] == "failed":
            counts["processingFailed"] += 1
        if entry:
            if receipt["disputed"]:
                counts["disputed"] += 1
                withheld.append({"receiptId": receipt["id"], "revision": entry["revision"], "reason": "accepted_revision_disputed"})
                continue
            if profile == "itemized" and entry["verification_level"] != "itemized_verified":
                counts["unsupportedProfile"] += 1
                withheld.append({"receiptId": receipt["id"], "revision": entry["revision"], "reason": "itemized_verification_unavailable"})
                continue
            amount = sum(part["amountMinor"] for part in allocations if code is None or part["projectCode"] == code)
            row = {"receiptId": receipt["id"], "revision": entry["revision"], "date": entry["purchase_date"], "vendor": entry["vendor"],
                   "currency": entry["currency"], "amountMinor": amount, "verificationLevel": entry["verification_level"], "allocations": allocations,
                   "acceptanceId": entry["acceptance_id"]}
            if entry["verification_level"] == "unverified_exception":
                counts["unverifiedExceptions"] += 1
                acceptance = store.connection.execute("SELECT evidence_json FROM uplift_acceptances WHERE id=?", (entry["acceptance_id"],)).fetchone()
                row["warnings"] = json.loads(acceptance[0])["validation"].get("waivedReasons", ["explicit_business_exception"])
            if profile == "itemized":
                accepted = store.revision(receipt["id"], entry["revision"])
                row["items"] = json.loads(accepted["candidate_json"])["items"]
            report_bytes += len(json.dumps(row, ensure_ascii=False).encode("utf-8"))
            require(report_bytes <= 1_000_000, "receipt_report_query_limit", 413)
            accepted_rows.append(row)
            accepted_totals[entry["currency"]] = accepted_totals.get(entry["currency"], 0) + amount
        elif mode == "draft" and body and receipt["disposition"] == "provisional":
            currency = body.get("currency")
            amount = body.get("totalMinor") if code is None else sum(part["amountMinor"] for part in allocations if part["projectCode"] == code) if allocations else None
            provisional_rows.append({"receiptId": receipt["id"], "revision": receipt["latest_revision"], "currency": currency, "amountMinor": amount, "state": "provisional"})
            if currency in PRECISIONS and amount is not None:
                provisional_totals[currency] = provisional_totals.get(currency, 0) + amount
    status = "review_required" if counts["disputed"] else "draft" if mode == "draft" else "final"
    result = {"mode": mode, "status": status, "profile": profile, "rows": accepted_rows, "provisionalRows": provisional_rows,
              "acceptedTotalsMinor": accepted_totals, "provisionalTotalsMinor": provisional_totals, "counts": counts, "withheld": withheld,
              "currenciesCombined": False, "missingAmountsSubstituted": False, "financialMeaning": "internal_uplift_expenses_only"}
    if fmt == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["record_state", "receipt_id", "revision", "purchase_date", "vendor", "currency", "amount_minor", "verification_level"])
        def safe_cell(value):
            value = "" if value is None else str(value)
            return "'"+value if value.lstrip().startswith(("=", "+", "-", "@")) else value
        for row in accepted_rows:
            writer.writerow([safe_cell(value) for value in ["accepted", row["receiptId"], row["revision"], row["date"], row["vendor"], row["currency"], row["amountMinor"], row["verificationLevel"]]])
        for row in provisional_rows:
            writer.writerow([safe_cell(value) for value in ["provisional", row["receiptId"], row["revision"], "", "", row["currency"], row["amountMinor"], "unverified"]])
        result["document"] = {"mimeType": "text/csv", "filename": "uplift-"+mode+".csv", "content": output.getvalue()}
    if fmt in {"pdf", "xlsx"}:
        from .report_documents import render_document
        result["document"] = render_document(result, fmt)
    return result


def operation_get(store, principal, params):
    require(set(params) == {"operationId"})
    operation_id = text(params["operationId"], 128)
    row = store.connection.execute("SELECT * FROM uplift_api_operations WHERE actor_id=? AND operation_id=?", (principal.actor_id, operation_id)).fetchone()
    require(row is not None, "receipt_operation_not_found", 404)
    result = json.loads(row["result_json"])
    receipt_id = row["receipt_id"] or result.get("receipt", {}).get("receiptId")
    if receipt_id:
        store.receipt(principal, receipt_id)
        if type(result.get("revision")) is int:
            store.revision(receipt_id, result["revision"], principal)
    if row["project_code"]:
        principal.project(row["project_code"])
    return {"operationId": operation_id, "operation": row["operation"], "result": result, "committedAt": row["committed_at"]}
