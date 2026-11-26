"""Receipt financial authority and source-evidence contract regressions."""
import base64
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import sqlite3

from uplift_finance_bridge.__main__ import invoke
from uplift_finance_bridge.errors import ReceiptError
from uplift_finance_bridge.store import Store


class ReceiptAuthorityTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        self.store = Store(root/"ledger.sqlite", root/"vault")
        self.store.initialize()
        self.counter = 0
        self.context = {"actorId": "alex", "projectCodes": ["P1"], "canManageProjects": True, "canReview": True}
        self.call("project.upsert", {"projectCode": "P1", "name": "House renovation", "context": "P1 House renovation materials", "active": True, "expectedRevision": 0})

    def tearDown(self):
        self.store.close()
        self.temporary.cleanup()

    def call(self, operation, params, context=None, operation_id=None):
        self.counter += 1
        packet = {"version": 1, "operation": operation, "params": params, "context": context or self.context}
        from uplift_finance_bridge.__main__ import WRITE
        if operation in WRITE:
            packet["operationId"] = operation_id or "operation-"+str(self.counter)
        return invoke(self.store, packet)

    def intake(self, suffix="one"):
        content = b"%PDF-1.7\nfixture-"+suffix.encode()
        sha = hashlib.sha256(content).hexdigest()
        source = {"artifactId": "artifact-"+sha, "contentBase64": base64.b64encode(content).decode(), "sha256": sha, "filename": "receipt.pdf", "mimeType": "application/pdf"}
        return self.call("source.intake", {"source": source})["receipt"]["receiptId"]

    def evidence(self, receipt, kind="user_statement", facts=None, body="Acme 2026-11-03 USD 12.00 for P1"):
        context = {**self.context, "evidenceOrigin": {"kind": kind, "sourceRef": "user-message:1", "facts": facts or {"projectCode": "P1"}}}
        return self.call("evidence.record", {"receiptId": receipt, "text": body}, context)["evidenceId"]

    def body(self, evidence):
        ref = [{"evidenceId": evidence, "quote": "Acme 2026-11-03 USD 12.00 for P1"}]
        return {"documentType": "receipt", "profile": "summary", "vendor": "Acme", "date": "2026-11-03", "currency": "USD", "totalMinor": 1200,
                "fieldEvidence": {key: ref for key in ["vendor", "date", "currency", "totalMinor"]},
                "allocations": [{"projectCode": "P1", "amountMinor": 1200, "rationale": "Explicit user project assignment", "evidence": ref}]}

    def accept(self, receipt):
        evidence = self.evidence(receipt)
        body = self.body(evidence)
        self.call("candidate.save", {"receiptId": receipt, "expectedRevision": 0, "candidate": body})
        result = self.call("candidate.accept", {"receiptId": receipt, "revision": 1})
        self.assertTrue(result["accepted"])
        return body

    def test_atomic_accept_replay_report_and_revision_cas(self):
        receipt = self.intake()
        body = self.body(self.evidence(receipt))
        self.call("candidate.save", {"receiptId": receipt, "expectedRevision": 0, "candidate": body})
        first = self.call("candidate.accept", {"receiptId": receipt, "revision": 1}, operation_id="accept-exact-1")
        replay = self.call("candidate.accept", {"receiptId": receipt, "revision": 1}, operation_id="accept-exact-1")
        self.assertTrue(first["readbackVerified"])
        self.assertTrue(replay["replayed"])
        report = self.call("report.generate", {})
        self.assertEqual(report["acceptedTotalsMinor"], {"USD": 1200})
        self.assertEqual(self.store.connection.execute("SELECT COUNT(*) FROM uplift_acceptances").fetchone()[0], 1)
        with self.assertRaisesRegex(ReceiptError, "receipt_revision_conflict"):
            self.call("candidate.save", {"receiptId": receipt, "expectedRevision": 0, "candidate": body})

    def test_reasoning_cannot_promote_itself_to_source_truth(self):
        receipt = self.intake()
        note = self.call("evidence.add", {"receiptId": receipt, "text": "Acme 2026-11-03 USD 12.00 for P1"})
        self.call("candidate.save", {"receiptId": receipt, "expectedRevision": 0, "candidate": self.body(note["evidenceId"])})
        result = self.call("candidate.accept", {"receiptId": receipt, "revision": 1})
        self.assertFalse(result["accepted"])
        self.assertIn("unsupported_totalMinor", result["validation"]["reasons"])
        self.assertEqual(self.call("report.generate", {})["acceptedTotalsMinor"], {})

    def test_synthetic_balanced_item_is_not_accepted(self):
        receipt = self.intake()
        body = self.body(self.evidence(receipt))
        body["profile"] = "itemized"
        body["items"] = [{"description": "Unclassified Balance", "amountMinor": 1200, "evidence": body["fieldEvidence"]["totalMinor"], "synthetic": True}]
        self.call("candidate.save", {"receiptId": receipt, "expectedRevision": 0, "candidate": body})
        result = self.call("candidate.accept", {"receiptId": receipt, "revision": 1})
        self.assertFalse(result["accepted"])
        self.assertIn("synthetic_balance", result["validation"]["reasons"])

    def test_failed_optional_redo_preserves_accepted_revision(self):
        receipt = self.intake()
        self.accept(receipt)
        self.call("attempt.record", {"receiptId": receipt, "nativeTaskRef": "task-1", "phaseRef": "redo-1", "state": "failed", "errorCode": "local_ocr_unavailable"})
        report = self.call("report.generate", {})
        self.assertEqual(report["acceptedTotalsMinor"], {"USD": 1200})
        self.assertEqual(report["counts"]["processingFailed"], 1)
        self.assertEqual(self.call("receipt.get", {"receiptId": receipt})["receipt"]["acceptedRevision"], 1)

    def test_dispute_is_visible_and_does_not_claim_final_totals(self):
        receipt = self.intake()
        body = self.accept(receipt)
        self.call("receipt.dispute", {"receiptId": receipt, "acceptedRevision": 1, "reason": "Owner disputes amount", "evidence": body["fieldEvidence"]["totalMinor"]})
        report = self.call("report.generate", {})
        self.assertEqual(report["status"], "review_required")
        self.assertEqual(report["acceptedTotalsMinor"], {})
        self.assertEqual(len(report["withheld"]), 1)

    def test_project_revocation_applies_to_read_and_replay(self):
        receipt = self.intake()
        self.accept(receipt)
        revoked = {**self.context, "projectCodes": []}
        with self.assertRaisesRegex(ReceiptError, "receipt_not_found"):
            self.call("receipt.get", {"receiptId": receipt}, revoked)
        self.assertEqual(self.call("report.generate", {}, revoked)["acceptedTotalsMinor"], {})

    def test_source_identity_and_operation_fingerprint_conflicts(self):
        receipt = self.intake()
        self.assertEqual(self.intake(), receipt)
        self.call("evidence.add", {"receiptId": receipt, "text": "first"}, operation_id="stable-evidence-key")
        with self.assertRaisesRegex(ReceiptError, "receipt_operation_conflict"):
            self.call("evidence.add", {"receiptId": receipt, "text": "changed"}, operation_id="stable-evidence-key")

    def test_alternate_scan_stays_provisional_without_identity_resolution(self):
        first = self.intake("first")
        self.accept(first)
        second = self.intake("second")
        body = self.body(self.evidence(second))
        saved = self.call("candidate.save", {"receiptId": second, "expectedRevision": 0, "candidate": body})
        self.assertIn("possible_duplicate", saved["validation"]["reasons"])
        result = self.call("candidate.accept", {"receiptId": second, "revision": 1})
        self.assertFalse(result["accepted"])
        self.assertEqual(self.call("report.generate", {})["acceptedTotalsMinor"], {"USD": 1200})

    def test_null_item_cost_is_not_zero_or_verified_itemized_detail(self):
        receipt = self.intake()
        body = self.body(self.evidence(receipt))
        body["profile"] = "itemized"
        body["items"] = [{"description": "Missing price", "amountMinor": None}]
        saved = self.call("candidate.save", {"receiptId": receipt, "expectedRevision": 0, "candidate": body})
        self.assertIn("missing_item_amount", saved["validation"]["reasons"])
        self.assertFalse(self.call("candidate.accept", {"receiptId": receipt, "revision": 1})["accepted"])
        self.assertEqual(self.call("report.generate", {})["acceptedTotalsMinor"], {})

    def test_new_candidate_preserves_prior_acceptance_and_stale_review_reply_fails(self):
        receipt = self.intake()
        body = self.accept(receipt)
        body["unresolved"] = ["need_project_clarification"]
        saved = self.call("candidate.save", {"receiptId": receipt, "expectedRevision": 1, "candidate": body})
        self.assertEqual(saved["acceptedRevisionPreserved"], 1)
        response = self.call("review.respond", {"reviewId": saved["reviewId"], "revision": 2, "text": "Please redo the OCR first"})
        self.assertFalse(response["accepted"])
        self.assertTrue(response["requiresReasoning"])
        with self.assertRaisesRegex(ReceiptError, "receipt_review_revision_conflict"):
            self.call("review.respond", {"reviewId": saved["reviewId"], "revision": 1, "text": "Old reply"})

    def test_projection_failure_rolls_back_acceptance_and_operation(self):
        receipt = self.intake()
        self.call("candidate.save", {"receiptId": receipt, "expectedRevision": 0, "candidate": self.body(self.evidence(receipt))})
        self.store.connection.execute("CREATE TRIGGER reject_projection BEFORE INSERT ON uplift_financial_entries BEGIN SELECT RAISE(ABORT,'forced'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.call("candidate.accept", {"receiptId": receipt, "revision": 1}, operation_id="transactional-accept")
        self.assertEqual(self.store.connection.execute("SELECT COUNT(*) FROM uplift_acceptances").fetchone()[0], 0)
        self.assertEqual(self.store.connection.execute("SELECT COUNT(*) FROM uplift_api_operations WHERE operation_id='transactional-accept'").fetchone()[0], 0)
        self.assertIsNone(self.call("receipt.get", {"receiptId": receipt})["receipt"]["acceptedRevision"])
        self.store.connection.execute("DROP TRIGGER reject_projection")
        self.assertTrue(self.call("candidate.accept", {"receiptId": receipt, "revision": 1}, operation_id="transactional-accept")["accepted"])

    def test_explicit_exception_stays_unverified_and_cannot_forge_user_evidence(self):
        receipt = self.intake()
        first = self.evidence(receipt)
        body = self.body(first)
        second = self.evidence(receipt, body="Subtotal USD 10.00 tax USD 1.00")
        ref = [{"evidenceId": second, "quote": "Subtotal USD 10.00 tax USD 1.00"}]
        body.update(subtotalMinor=1000, adjustments=[{"kind": "tax", "amountMinor": 100, "evidence": ref}])
        body["fieldEvidence"]["subtotalMinor"] = ref
        self.call("candidate.save", {"receiptId": receipt, "expectedRevision": 0, "candidate": body})
        exception = {"waiveReasons": ["unexplained_total_difference"], "reason": "Owner accepts this internal expense as unverified", "evidenceId": first}
        with self.assertRaisesRegex(ReceiptError, "receipt_exception_explicit_user_evidence_required"):
            self.call("candidate.accept", {"receiptId": receipt, "revision": 1, "exception": exception})
        approved = {"receiptId": receipt, "revision": 1, "waivedReasons": ["unexplained_total_difference"], "reason": exception["reason"]}
        exception["evidenceId"] = self.evidence(receipt, facts={"approvedException": approved}, body="Owner explicitly approves the named exception")
        result = self.call("candidate.accept", {"receiptId": receipt, "revision": 1, "exception": exception})
        self.assertTrue(result["accepted"])
        self.assertEqual(result["validation"]["verificationLevel"], "unverified_exception")
        report = self.call("report.generate", {})
        self.assertEqual(report["counts"]["unverifiedExceptions"], 1)
        self.assertIn("unexplained_total_difference", report["rows"][0]["warnings"])
        self.assertEqual(self.call("report.generate", {"profile": "itemized"})["acceptedTotalsMinor"], {})

    def test_refund_is_signed_and_currency_totals_remain_separate(self):
        receipt = self.intake("refund")
        phrase = "Acme 2026-11-03 USD -12.00 for P1"
        evidence = self.evidence(receipt, body=phrase)
        body = self.body(evidence)
        ref = [{"evidenceId": evidence, "quote": phrase}]
        body.update(documentType="refund", totalMinor=-1200)
        body["fieldEvidence"] = {key: ref for key in ["vendor", "date", "currency", "totalMinor"]}
        body["allocations"][0].update(amountMinor=-1200, evidence=ref)
        self.call("candidate.save", {"receiptId": receipt, "expectedRevision": 0, "candidate": body})
        self.assertTrue(self.call("candidate.accept", {"receiptId": receipt, "revision": 1})["accepted"])
        euro = self.intake("euro")
        phrase = "Acme 2026-11-03 EUR 5.00 for P1"
        evidence = self.evidence(euro, body=phrase)
        other = self.body(evidence)
        ref = [{"evidenceId": evidence, "quote": phrase}]
        other.update(currency="EUR", totalMinor=500)
        other["fieldEvidence"] = {key: ref for key in ["vendor", "date", "currency", "totalMinor"]}
        other["allocations"][0].update(amountMinor=500, evidence=ref)
        self.call("candidate.save", {"receiptId": euro, "expectedRevision": 0, "candidate": other})
        self.assertTrue(self.call("candidate.accept", {"receiptId": euro, "revision": 1})["accepted"])
        report = self.call("report.generate", {})
        self.assertEqual(report["acceptedTotalsMinor"], {"USD": -1200, "EUR": 500})
        self.assertFalse(report["currenciesCombined"])


    def test_semantic_date_interpretation_accepts_spelled_source_without_format_branch(self):
        receipt = self.intake("spelled-date")
        phrase = "Acme November 3, 2026 USD 12.00 for P1"
        evidence = self.evidence(receipt, body=phrase)
        body = self.body(evidence)
        reference = {"evidenceId": evidence, "quote": phrase}
        body["fieldEvidence"] = {field: [copy.deepcopy(reference)] for field in ["vendor", "date", "currency", "totalMinor"]}
        body["fieldEvidence"]["date"][0]["interpretation"] = {"value": "2026-11-03", "rationale": "The source explicitly spells November 3, 2026.", "ambiguity": "clear"}
        body["allocations"][0]["evidence"] = [reference]
        saved = self.call("candidate.save", {"receiptId": receipt, "expectedRevision": 0, "candidate": body})
        self.assertTrue(saved["validation"]["valid"], saved["validation"])
        self.assertEqual(saved["validation"]["interpretedFields"], ["date"])
        self.assertTrue(self.call("candidate.accept", {"receiptId": receipt, "revision": 1})["accepted"])

    def test_interpretation_requires_actual_source_and_cannot_ground_money(self):
        receipt = self.intake("unreadable-amount")
        phrase = "Acme 2026-11-03 USD unreadable total for P1"
        evidence = self.evidence(receipt, body=phrase)
        body = self.body(evidence)
        reference = {"evidenceId": evidence, "quote": phrase}
        body["fieldEvidence"] = {field: [copy.deepcopy(reference)] for field in ["vendor", "date", "currency", "totalMinor"]}
        body["fieldEvidence"]["totalMinor"][0]["interpretation"] = {"value": "1200", "rationale": "A guess must not become numeric evidence.", "ambiguity": "clear"}
        body["allocations"][0]["evidence"] = [reference]
        saved = self.call("candidate.save", {"receiptId": receipt, "expectedRevision": 0, "candidate": body})
        self.assertIn("unsupported_totalMinor", saved["validation"]["reasons"])
        self.assertFalse(self.call("candidate.accept", {"receiptId": receipt, "revision": 1})["accepted"])
        other = self.intake("reasoning-interpretation")
        phrase = "Acme November 3, 2026 USD 12.00 for P1"
        note = self.call("evidence.add", {"receiptId": other, "text": phrase})["evidenceId"]
        candidate = self.body(note)
        ref = {"evidenceId": note, "quote": phrase, "interpretation": {"value": "2026-11-03", "rationale": "Source kind is still reasoning.", "ambiguity": "clear"}}
        candidate["fieldEvidence"]["date"] = [ref]
        saved = self.call("candidate.save", {"receiptId": other, "expectedRevision": 0, "candidate": candidate})
        self.assertIn("unsupported_date", saved["validation"]["reasons"])

    def test_uncertain_conflicting_and_fabricated_interpretations_stay_provisional(self):
        for suffix, field, quote, interpretation, value in [
            ("uncertain", "date", "Acme 2026-11-03 USD 12.00 for P1", {"value": "2026-11-03", "rationale": "Date remains disputed.", "ambiguity": "uncertain"}, "2026-11-03"),
            ("currency-conflict", "currency", "Acme 2026-11-03 USD 12.00 for P1", {"value": "EUR", "rationale": "Cannot override printed USD.", "ambiguity": "clear"}, "EUR"),
            ("fabricated", "date", "November 3, 2026 invented quote", {"value": "2026-11-03", "rationale": "Quote is absent from source.", "ambiguity": "clear"}, "2026-11-03"),
        ]:
            with self.subTest(suffix=suffix):
                receipt = self.intake(suffix)
                evidence = self.evidence(receipt)
                body = self.body(evidence)
                body[field] = value
                body["fieldEvidence"][field] = [{"evidenceId": evidence, "quote": quote, "interpretation": interpretation}]
                saved = self.call("candidate.save", {"receiptId": receipt, "expectedRevision": 0, "candidate": body})
                self.assertIn("unsupported_"+field, saved["validation"]["reasons"])
                self.assertFalse(self.call("candidate.accept", {"receiptId": receipt, "revision": 1})["accepted"])

    def test_current_human_clarification_is_revision_bound_and_normalized(self):
        receipt = self.intake("clarified")
        body = self.body(self.evidence(receipt))
        body["date"] = None
        self.call("candidate.save", {"receiptId": receipt, "expectedRevision": 0, "candidate": body})
        facts = {"clarification": {"receiptId": receipt, "revision": 1, "rationale": "Current owner answers the date question.", "ambiguity": "clear"},
                 "interpretedFields": [{"field": "date", "value": "2026-11-03", "rationale": "The human says November third this year.", "ambiguity": "clear"}]}
        phrase = "It was November third this year."
        evidence = self.evidence(receipt, facts=facts, body=phrase)
        body["date"] = "2026-11-03"
        body["fieldEvidence"]["date"] = [{"evidenceId": evidence, "quote": phrase}]
        saved = self.call("candidate.save", {"receiptId": receipt, "expectedRevision": 1, "candidate": body})
        self.assertTrue(saved["validation"]["valid"], saved["validation"])
        self.assertTrue(self.call("candidate.accept", {"receiptId": receipt, "revision": 2})["accepted"])
        with self.assertRaisesRegex(ReceiptError, "receipt_review_revision_conflict"):
            self.evidence(receipt, facts=facts, body="Stale answer cannot attach new clarification.")
        with self.assertRaisesRegex(ReceiptError, "receipt_clarification_binding_required"):
            self.evidence(receipt, facts={"interpretedFields": facts["interpretedFields"]}, body=phrase)

    def test_explicit_distinct_receipt_clarification_resolves_duplicate_without_merge(self):
        first = self.intake("distinct-first")
        self.accept(first)
        second = self.intake("distinct-second")
        body = self.body(self.evidence(second))
        self.call("candidate.save", {"receiptId": second, "expectedRevision": 0, "candidate": body})
        phrase = "These were two separate purchases, not two scans of the same purchase."
        facts = {"clarification": {"receiptId": second, "revision": 1, "rationale": "Current human explicitly distinguishes these two purchases.", "ambiguity": "clear"},
                 "distinctReceiptIds": sorted([first, second])}
        evidence = self.evidence(second, facts=facts, body=phrase)
        body["duplicateResolution"] = {"decision": "distinct", "rationale": "Human clarified separate purchases.", "evidence": [{"evidenceId": evidence, "quote": phrase}]}
        saved = self.call("candidate.save", {"receiptId": second, "expectedRevision": 1, "candidate": body})
        self.assertNotIn("possible_duplicate", saved["validation"]["reasons"])
        self.assertTrue(self.call("candidate.accept", {"receiptId": second, "revision": 2})["accepted"])
        self.assertEqual(self.call("report.generate", {})["acceptedTotalsMinor"], {"USD": 2400})


    def test_uncertain_human_clarification_cannot_become_literal_date_proof(self):
        receipt = self.intake("uncertain-human-date")
        body = self.body(self.evidence(receipt))
        body["date"] = None
        self.call("candidate.save", {"receiptId": receipt, "expectedRevision": 0, "candidate": body})
        facts = {"clarification": {"receiptId": receipt, "revision": 1, "rationale": "Human is unsure.", "ambiguity": "uncertain"},
                 "interpretedFields": [{"field": "date", "value": "2026-11-03", "rationale": "Only a possible date.", "ambiguity": "uncertain"}]}
        phrase = "It might have been 2026-11-03."
        evidence = self.evidence(receipt, facts=facts, body=phrase)
        body["date"] = "2026-11-03"
        body["fieldEvidence"]["date"] = [{"evidenceId": evidence, "quote": phrase}]
        saved = self.call("candidate.save", {"receiptId": receipt, "expectedRevision": 1, "candidate": body})
        self.assertIn("unsupported_date", saved["validation"]["reasons"])
        self.assertFalse(self.call("candidate.accept", {"receiptId": receipt, "revision": 2})["accepted"])


if __name__ == "__main__":
    unittest.main()
