"""Private document projections of the canonical financial report, never a parser.

No arithmetic/acceptance decisions occur here. All monetary values retain exact
integer minor units and their currency. Spreadsheet cells are literal strings.
"""
import base64
import io
import json
from xml.sax.saxutils import escape

from .errors import ReceiptError, require

MAX_DOCUMENT_BYTES = 2 * 1024 * 1024
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _tables(result):
    yield "Summary", [["Uplift internal expenses", result["mode"], result["status"], result["profile"]],
                      ["Amounts are exact integer minor units; currencies are never combined."],
                      ["Accepted currency", "Total minor units"],
                      *[[code, str(total)] for code, total in sorted(result["acceptedTotalsMinor"].items())],
                      ["Provisional currency", "Total minor units (unverified)"],
                      *[[code, str(total)] for code, total in sorted(result["provisionalTotalsMinor"].items())],
                      ["Disposition/count", "Count"],
                      *[[key, str(value)] for key, value in result["counts"].items()]]
    columns = ["receiptId", "revision", "date", "vendor", "currency", "amountMinor", "verificationLevel", "acceptanceId"]
    yield "Accepted", [columns + ["allocated projects/minor units", "warnings"], *[
        [row.get(key) for key in columns] + ["; ".join(part["projectCode"] + ": " + str(part["amountMinor"]) for part in row["allocations"]), ", ".join(row.get("warnings", []))]
        for row in result["rows"]]]
    yield "Allocations", [["receiptId", "revision", "currency", "projectCode", "amountMinor", "rationale", "evidence"], *[
        [row["receiptId"], row["revision"], row["currency"], part["projectCode"], part["amountMinor"], part.get("rationale"), json.dumps(part.get("evidence", []), ensure_ascii=False)]
        for row in result["rows"] for part in row["allocations"]]]
    yield "Provisional", [["receiptId", "revision", "currency", "amountMinor", "state"], *[
        [row.get(key) for key in ["receiptId", "revision", "currency", "amountMinor", "state"]] for row in result["provisionalRows"]]]
    yield "Withheld", [["receiptId", "revision", "reason"], *[
        [row.get(key) for key in ["receiptId", "revision", "reason"]] for row in result["withheld"]]]
    if result["profile"] == "itemized":
        yield "Items", [["receiptId", "revision", "currency", "description", "amountMinor", "quantity", "unitMinor"], *[
            [row["receiptId"], row["revision"], row["currency"], item["description"], item.get("amountMinor"), item.get("quantity"), item.get("unitMinor")]
            for row in result["rows"] for item in row.get("items", [])]]


def _literal(value):
    # None stays visibly empty; never substitute zero or formulas.
    value = "" if value is None else str(value)
    require(len(value) <= 30_000, "receipt_report_document_cell_too_large", 413)
    return value


def _xlsx(result):
    try:
        from openpyxl import Workbook
        from openpyxl.cell import WriteOnlyCell
        from openpyxl.styles import Font, PatternFill
    except ImportError as error:
        raise ReceiptError("receipt_report_renderer_unavailable", 503) from error
    workbook = Workbook(write_only=True)
    for title, rows in _tables(result):
        sheet = workbook.create_sheet(title)
        sheet.freeze_panes = "A2"
        for index, values in enumerate(rows):
            cells = []
            for value in values:
                cell = WriteOnlyCell(sheet, value=_literal(value))
                cell.data_type = "s"  # Source text beginning '=' is data, never an executable formula.
                if index == 0:
                    cell.font = Font(bold=True, color="FFFFFF")
                    cell.fill = PatternFill("solid", fgColor="234E52")
                cells.append(cell)
            sheet.append(cells)
    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()


def _pdf(result):
    try:
        import reportlab
        from pathlib import Path
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, LongTable, TableStyle, PageBreak
    except ImportError as error:
        raise ReceiptError("receipt_report_renderer_unavailable", 503) from error
    # Pinned renderer includes this font: no external URL, arbitrary path or font download.
    font_path = Path(reportlab.__file__).resolve().parent / "fonts" / "Vera.ttf"
    pdfmetrics.registerFont(TTFont("UpliftVera", str(font_path)))
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="ReceiptCell", fontName="UpliftVera", fontSize=6, leading=8, wordWrap="CJK"))
    styles.add(ParagraphStyle(name="ReceiptHeading", fontName="UpliftVera", fontSize=13, leading=16, spaceAfter=8))
    output = io.BytesIO()
    document = SimpleDocTemplate(output, pagesize=landscape(A4), leftMargin=24, rightMargin=24, topMargin=30, bottomMargin=30,
                                 title="Uplift " + result["mode"] + " expenses", author="Uplift")
    story = []
    for number, (title, rows) in enumerate(_tables(result)):
        if number:
            story.append(PageBreak())
        story.extend([Paragraph(escape("Uplift " + result["status"] + " — " + title), styles["ReceiptHeading"]),
                      Paragraph("Internal expenses. Exact minor units with currency; blank means unavailable. Provisional rows are unverified.", styles["ReceiptCell"]), Spacer(1, 10)])
        width = max(len(row) for row in rows)
        data = [[Paragraph(escape(_literal(value)).replace("\n", "<br/>"), styles["ReceiptCell"]) for value in row] + [""] * (width-len(row)) for row in rows]
        table = LongTable(data, colWidths=[document.width / width] * width, repeatRows=1, splitByRow=1, splitInRow=1)
        table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E2F0ED")),
                                   ("VALIGN", (0, 0), (-1, -1), "TOP"), ("GRID", (0, 0), (-1, -1), .2, colors.lightgrey),
                                   ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4)]))
        story.append(table)
    def footer(canvas, doc):
        canvas.setFont("UpliftVera", 7)
        canvas.drawString(24, 15, "Uplift internal expenses | " + result["status"] + " | Page " + str(doc.page))
    document.build(story, onFirstPage=footer, onLaterPages=footer)
    return output.getvalue()


def render_document(result, fmt):
    require(fmt in {"pdf", "xlsx"})
    require(len(json.dumps(result, ensure_ascii=False).encode("utf-8")) <= 1_000_000, "receipt_report_document_too_large", 413)
    content = _pdf(result) if fmt == "pdf" else _xlsx(result)
    require(len(content) <= MAX_DOCUMENT_BYTES, "receipt_report_document_too_large", 413)
    return {"mimeType": "application/pdf" if fmt == "pdf" else XLSX_MIME,
            "filename": "uplift-" + result["mode"] + "." + fmt, "encoding": "base64",
            "content": base64.b64encode(content).decode("ascii"), "sizeBytes": len(content)}
