"""Run only in the consolidated post-assembly functionality campaign."""
import base64
import io
import unittest

from uplift_finance_bridge.report_documents import render_document


class ReportDocumentTests(unittest.TestCase):
    def report(self):
        return {"mode": "draft", "status": "review_required", "profile": "itemized",
                "rows": [{"receiptId": "receipt-one", "revision": 2, "date": "2026-11-03", "vendor": "=HYPERLINK(\"https://example.test\")",
                          "currency": "USD", "amountMinor": 9007199254740, "verificationLevel": "itemized_verified", "acceptanceId": "acceptance-one",
                          "allocations": [{"projectCode": "P1", "amountMinor": 9007199254740}], "items": [{"description": "CafÃ© materials", "amountMinor": 9007199254740}]}],
                "provisionalRows": [{"receiptId": "receipt-two", "revision": 1, "currency": "CAD", "amountMinor": None, "state": "provisional"}],
                "acceptedTotalsMinor": {"USD": 9007199254740, "JPY": -19}, "provisionalTotalsMinor": {},
                "counts": {"accepted": 1, "provisional": 1, "disputed": 1},
                "withheld": [{"receiptId": "receipt-three", "revision": 1, "reason": "accepted_revision_disputed"}]}

    def test_xlsx_literal_fields_exact_minor_units_and_separate_states(self):
        from openpyxl import load_workbook
        document = render_document(self.report(), "xlsx")
        workbook = load_workbook(io.BytesIO(base64.b64decode(document["content"])))
        self.assertEqual(workbook.sheetnames, ["Summary", "Accepted", "Allocations", "Provisional", "Withheld", "Items"])
        self.assertEqual(workbook["Accepted"]["D2"].data_type, "s")
        self.assertTrue(workbook["Accepted"]["D2"].value.startswith("=HYPERLINK"))
        self.assertEqual(workbook["Accepted"]["F2"].value, "9007199254740")
        self.assertIsNone(workbook["Provisional"]["D2"].value)
        self.assertEqual(workbook["Withheld"]["C2"].value, "accepted_revision_disputed")
        summary = list(workbook["Summary"].values)
        self.assertIn(("JPY", "-19", None, None), summary)
        self.assertEqual(document["sizeBytes"], len(base64.b64decode(document["content"])))

    def test_pdf_valid_document_contains_summary_and_distinct_sections(self):
        import pypdfium2 as pdfium
        document = render_document(self.report(), "pdf")
        content = base64.b64decode(document["content"])
        self.assertTrue(content.startswith(b"%PDF-"))
        reader = pdfium.PdfDocument(content)
        try:
            self.assertGreaterEqual(len(reader), 5)
            pages = []
            for index in range(len(reader)):
                page = reader[index]
                text = page.get_textpage()
                try:
                    pages.append(text.get_text_range())
                finally:
                    text.close()
                    page.close()
            extracted = "\n".join(pages)
        finally:
            reader.close()
        for value in ["review_required", "9007199254740", "accepted_revision_disputed", "Provisional", "Items"]:
            self.assertIn(value, extracted)
        self.assertNotIn("90071992547.40", extracted)


if __name__ == "__main__":
    unittest.main()
