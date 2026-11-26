"""Structural evidence and exact monetary gates, independent of vendor parsing."""
from datetime import datetime
from decimal import Decimal, InvalidOperation
import re

from . import POLICY_VERSION
from .errors import bounded_int, require, text

PRECISIONS = {code: 2 for code in ["USD", "CAD", "EUR", "GBP", "AUD", "NZD", "CHF", "SEK", "NOK", "DKK", "CNY", "HKD", "SGD", "INR", "MXN", "BRL", "ZAR"]}
PRECISIONS.update({"JPY": 0, "KRW": 0, "BHD": 3, "KWD": 3})
SOURCE_KINDS = {"local_ocr", "user_statement", "standing_rule"}
EVIDENCE_ID = re.compile(r"^evidence-[a-f0-9]{48}$")
MINIMUM = -9_000_000_000_000
# Interpretations are source-linked semantic judgments, not new evidence kinds
# or a replacement for numeric monetary validation.
INTERPRETED_FIELDS = {"vendor", "date", "currency", "transactionRef"}


def refs(value):
    require(isinstance(value, list) and len(value) <= 20)
    for ref in value:
        require(isinstance(ref, dict) and set(ref) <= {"evidenceId", "quote", "interpretation"} and {"evidenceId", "quote"} <= set(ref))
        require(isinstance(ref["evidenceId"], str) and EVIDENCE_ID.fullmatch(ref["evidenceId"]))
        text(ref["quote"], 500)
        if "interpretation" in ref:
            interpretation_shape(ref["interpretation"])
    return value


def interpretation_shape(value):
    require(isinstance(value, dict) and set(value) == {"value", "rationale", "ambiguity"})
    text(value["value"], 250)
    text(value["rationale"], 2000)
    require(value["ambiguity"] in {"clear", "uncertain"})
    return value


def amount(value):
    return None if value is None else bounded_int(value, MINIMUM)


def candidate_shape(value):
    require(isinstance(value, dict) and set(value) <= {"documentType", "profile", "vendor", "date", "currency", "totalMinor", "subtotalMinor", "fieldEvidence", "adjustments", "items", "allocations", "unresolved", "transactionRef", "duplicateResolution"})
    require(value.get("documentType") in {"receipt", "invoice", "refund", "credit"})
    require(value.get("profile") in {"summary", "itemized"})
    for key in ["vendor", "date", "currency", "transactionRef"]:
        if value.get(key) is not None:
            text(value[key], 250)
    if value.get("date"):
        require(re.fullmatch(r"\d{4}-\d{2}-\d{2}", value["date"]) is not None)
        try:
            datetime.strptime(value["date"], "%Y-%m-%d")
        except ValueError:
            require(False)
    amount(value.get("totalMinor")); amount(value.get("subtotalMinor"))
    fields = value.get("fieldEvidence", {})
    require(isinstance(fields, dict) and set(fields) <= {"vendor", "date", "currency", "totalMinor", "subtotalMinor", "transactionRef"})
    for field_refs in fields.values():
        refs(field_refs)
    adjustments = value.get("adjustments", [])
    require(isinstance(adjustments, list) and len(adjustments) <= 30)
    for item in adjustments:
        require(isinstance(item, dict) and set(item) <= {"kind", "amountMinor", "evidence", "calculation"})
        require(item.get("kind") in {"tax", "fee", "tip", "shipping", "discount", "rounding"})
        require(item.get("amountMinor") is not None); amount(item["amountMinor"])
        refs(item.get("evidence", []))
        calculation_shape(item.get("calculation"))
    items = value.get("items", [])
    require(isinstance(items, list) and len(items) <= 500)
    for item in items:
        require(isinstance(item, dict) and set(item) <= {"description", "amountMinor", "quantity", "unitMinor", "evidence", "calculation", "synthetic"})
        text(item.get("description"), 500)
        amount(item.get("amountMinor")); amount(item.get("unitMinor"))
        if item.get("quantity") is not None:
            require(isinstance(item["quantity"], str) and re.fullmatch(r"[0-9]{1,8}(\.[0-9]{1,6})?", item["quantity"]) is not None)
        require(type(item.get("synthetic", False)) is bool)
        refs(item.get("evidence", [])); calculation_shape(item.get("calculation"))
    allocations = value.get("allocations", [])
    require(isinstance(allocations, list) and len(allocations) <= 50)
    for item in allocations:
        require(isinstance(item, dict) and set(item) == {"projectCode", "amountMinor", "rationale", "evidence"})
        text(item["projectCode"], 64); amount(item["amountMinor"])
        require(item["amountMinor"] is not None)
        text(item["rationale"], 2000); refs(item["evidence"])
    unresolved = value.get("unresolved", [])
    require(isinstance(unresolved, list) and len(unresolved) <= 50)
    for issue in unresolved:
        text(issue, 160)
    resolution = value.get("duplicateResolution")
    if resolution is not None:
        require(isinstance(resolution, dict) and set(resolution) <= {"decision", "rationale", "evidence"})
        require(resolution.get("decision") in {"unknown", "distinct"})
        text(resolution.get("rationale", ""), 2000, empty=True)
        refs(resolution.get("evidence", []))
    return value


def calculation_shape(value):
    if value is None:
        return
    require(isinstance(value, dict) and set(value) <= {"operator", "inputs", "quantity"})
    require(value.get("operator") in {"sum", "difference", "quantity_product"})
    inputs = value.get("inputs")
    require(isinstance(inputs, list) and 1 <= len(inputs) <= 30)
    for item in inputs:
        require(isinstance(item, dict) and set(item) == {"minor", "evidence"})
        bounded_int(item["minor"], MINIMUM); refs(item["evidence"])
    if value["operator"] == "difference":
        require(len(inputs) == 2)
    if value["operator"] == "quantity_product":
        require(len(inputs) == 1 and isinstance(value.get("quantity"), str) and re.fullmatch(r"[0-9]{1,8}(\.[0-9]{1,6})?", value["quantity"]) is not None)


def resolved_refs(references, evidence):
    result = []
    for ref in references:
        item = evidence.get(ref["evidenceId"])
        if item and ref["quote"] in item["text_content"]:
            result.append((item, ref["quote"]))
    return result


def quoted_amount(quote, minor, precision):
    for token in re.findall(r"(?<![\w.])[-+]?\d[\d,]*(?:\.\d{1,3})?(?![\w.])", quote):
        try:
            value = Decimal(token.replace(",", "")) * (10 ** precision)
            if value == minor:
                return True
            if "(" in quote and ")" in quote and -value == minor:
                return True
        except InvalidOperation:
            pass
    return False


def interpreted_field(field, value, references, evidence):
    """Verify interpretation custody, leaving semantic meaning to Main.

    A rationale/clear flag alone has no value: the referenced source must be
    trusted for this receipt and the exact quote must exist in it. Currency
    interpretations cannot contradict an explicit supported ISO currency code.
    Monetary inputs never use this path.
    """
    if field not in INTERPRETED_FIELDS or not isinstance(value, str):
        return False
    for ref in references:
        interpretation = ref.get("interpretation")
        item = evidence.get(ref["evidenceId"])
        if not interpretation or interpretation["value"] != value or interpretation["ambiguity"] != "clear":
            continue
        if not item or item["kind"] not in SOURCE_KINDS or ref["quote"] not in item["text_content"]:
            continue
        if field == "currency":
            explicit = set(re.findall(r"\b(?:" + "|".join(PRECISIONS) + r")\b", ref["quote"], re.I))
            if explicit and {code.upper() for code in explicit} != {value}:
                continue
        return True
    return False


def field_grounded(field, value, references, evidence, precision):
    # Known ambiguity must stay visible even if the same quote also happens to
    # contain a literal normalized value.
    if any(ref.get("interpretation", {}).get("ambiguity") == "uncertain" or
           field in INTERPRETED_FIELDS and ref.get("interpretation", {}).get("value", value) != value or
           any(part.get("field") == field and part.get("ambiguity") == "uncertain"
               for part in evidence.get(ref["evidenceId"], {}).get("facts", {}).get("interpretedFields", []))
           for ref in references):
        return False
    if interpreted_field(field, value, references, evidence):
        return True
    for item, quote in resolved_refs(references, evidence):
        if item["kind"] not in SOURCE_KINDS:
            continue
        facts = item.get("facts", {})
        if item["kind"] in {"user_statement", "standing_rule"} and facts.get(field) == value:
            return True
        if field in INTERPRETED_FIELDS and item["kind"] == "user_statement" and facts.get("clarification", {}).get("ambiguity") == "clear":
            if any(part.get("field") == field and part.get("value") == value and part.get("ambiguity") == "clear" for part in facts.get("interpretedFields", [])):
                return True
        if field.endswith("Minor"):
            if precision is not None and quoted_amount(quote, value, precision):
                return True
        elif field == "date":
            possible = set()
            for token in re.findall(r"\b\d{1,4}[-/]\d{1,2}[-/]\d{1,4}\b", quote):
                for fmt in ["%Y-%m-%d", "%Y/%m/%d", "%m/%d/%Y", "%d/%m/%Y", "%m/%d/%y", "%d/%m/%y"]:
                    try:
                        possible.add(datetime.strptime(token, fmt).date().isoformat())
                    except ValueError:
                        pass
            if possible == {value}:
                return True
        elif field == "currency":
            if re.search(r"\b" + re.escape(value) + r"\b", quote, re.I):
                return True
        elif str(value).casefold() in quote.casefold():
            return True
    return False


def computed_amount(value, calculation, evidence, precision, item=False):
    if not calculation or item and calculation["operator"] != "quantity_product":
        return False
    inputs = calculation["inputs"]
    if not all(field_grounded("amountMinor", part["minor"], part["evidence"], evidence, precision) for part in inputs):
        return False
    values = [part["minor"] for part in inputs]
    if calculation["operator"] == "quantity_product":
        quantity = calculation["quantity"]
        if not any(quantity in quote for part in inputs for _, quote in resolved_refs(part["evidence"], evidence)):
            return False
        result = Decimal(values[0]) * Decimal(quantity)
        return result == result.to_integral_value() and result == value
    result = sum(values) if calculation["operator"] == "sum" else values[0]-values[1]
    return result == value


def validate(candidate, evidence, projects, authorized_codes, duplicate_reasons=()):
    reasons = list(candidate.get("unresolved", [])) + list(duplicate_reasons)
    precision = PRECISIONS.get(candidate.get("currency"))
    if precision is None:
        reasons.append("unsupported_or_uncertain_currency")
    total = candidate.get("totalMinor")
    for key in ["vendor", "date", "currency", "totalMinor"]:
        value = candidate.get(key)
        if value is None or value == "":
            reasons.append("missing_" + key)
        elif not field_grounded(key, value, candidate.get("fieldEvidence", {}).get(key, []), evidence, precision):
            reasons.append("unsupported_" + key)
    if total is not None:
        if candidate["documentType"] in {"refund", "credit"} and total > 0:
            reasons.append("refund_sign_uncertain")
        if candidate["documentType"] in {"receipt", "invoice"} and total < 0:
            reasons.append("document_sign_uncertain")
    subtotal = candidate.get("subtotalMinor")
    if subtotal is not None and not field_grounded("subtotalMinor", subtotal, candidate.get("fieldEvidence", {}).get("subtotalMinor", []), evidence, precision):
        reasons.append("unsupported_subtotal")
    adjustments = candidate.get("adjustments", [])
    for part in adjustments:
        if not field_grounded("amountMinor", part["amountMinor"], part.get("evidence", []), evidence, precision) and not computed_amount(part["amountMinor"], part.get("calculation"), evidence, precision):
            reasons.append("unsupported_adjustment")
        if part["kind"] == "discount" and total is not None and total >= 0 and part["amountMinor"] > 0:
            reasons.append("discount_sign_uncertain")
    items = candidate.get("items", [])
    for item in items:
        if item.get("synthetic") or re.search(r"\b(unclassified balance|balancing line|unexplained residual)\b", item["description"], re.I):
            reasons.append("synthetic_balance")
        value = item.get("amountMinor")
        if value is None and candidate["profile"] == "itemized":
            reasons.append("missing_item_amount")
        elif candidate["profile"] == "itemized" and not field_grounded("amountMinor", value, item.get("evidence", []), evidence, precision) and not computed_amount(value, item.get("calculation"), evidence, precision, item=True):
            reasons.append("unsupported_item_amount")
    base = subtotal
    verification = "source_total_only"
    rule = "source-total/1"
    if candidate["profile"] == "itemized":
        rule = "itemized-minor-unit/1"
        verification = "itemized_verified"
        if not items or any(item.get("amountMinor") is None for item in items):
            reasons.append("missing_itemized_detail")
        else:
            item_sum = sum(item["amountMinor"] for item in items)
            if subtotal is not None and subtotal != item_sum:
                reasons.append("item_subtotal_mismatch")
            base = item_sum
    if base is not None:
        rule = "itemized-minor-unit/1" if candidate["profile"] == "itemized" else "summary-minor-unit/1"
        verification = "itemized_verified" if candidate["profile"] == "itemized" else "summary_reconciled"
        if total is None or base + sum(part["amountMinor"] for part in adjustments) != total:
            reasons.append("unexplained_total_difference")
    elif adjustments:
        reasons.append("missing_reconciliation_base")
    allocations = candidate.get("allocations", [])
    if not allocations or total is None or sum(part["amountMinor"] for part in allocations) != total:
        reasons.append("project_allocation_unresolved")
    if len({part["projectCode"] for part in allocations}) != len(allocations):
        reasons.append("duplicate_project_allocation")
    for allocation in allocations:
        code = allocation["projectCode"]
        project = projects.get(code)
        if code not in authorized_codes or not project or not project["active"]:
            reasons.append("project_not_available")
            continue
        references = resolved_refs(allocation["evidence"], evidence)
        direct = any(item["kind"] in {"user_statement", "standing_rule"} and
                     (item.get("facts", {}).get("projectCode") == code or code.casefold() in quote.casefold() or project["name"].casefold() in quote.casefold() or
                      item["kind"] == "user_statement" and item.get("facts", {}).get("clarification", {}).get("ambiguity") == "clear" and
                      any(part.get("field") == "projectCode" and part.get("value") == code and part.get("ambiguity") == "clear" for part in item.get("facts", {}).get("interpretedFields", [])))
                     for item, quote in references)
        contextual = any(item["kind"] == "project_context" and item.get("facts", {}).get("projectCode") == code and item.get("facts", {}).get("projectRevision") == project["revision"] for item, quote in references)
        sourced = any(item["kind"] in SOURCE_KINDS for item, _ in references)
        if any(any(part.get("field") == "projectCode" and part.get("value") == code and part.get("ambiguity") == "uncertain" for part in item.get("facts", {}).get("interpretedFields", [])) for item, _ in references):
            reasons.append("project_allocation_uncertain")
        if not direct and not (contextual and sourced):
            reasons.append("project_reasoning_unsupported")
    return {"policyVersion": POLICY_VERSION, "profile": candidate["profile"], "valid": not reasons,
            "reasons": sorted(set(reasons)), "monetaryRule": rule, "verificationLevel": verification,
            "precision": precision, "waiversApplied": False,
            "interpretedFields": sorted(key for key in INTERPRETED_FIELDS if interpreted_field(key, candidate.get(key), candidate.get("fieldEvidence", {}).get(key, []), evidence))}
