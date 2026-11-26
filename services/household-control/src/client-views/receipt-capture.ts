import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { artifactResponseHeaders, type ArtifactStore } from "../platform/artifacts.ts";
import type { DocumentPrincipal, DocumentsService } from "../domains/documents/index.ts";
import type { ReceiptsBridge } from "../domain-runtime/receipts-bridge.ts";
import type { RequestContext } from "../server.ts";
import { parseJson, sendJson } from "../http-codec.ts";

export const receiptCapturePath = "/v1/receipt-captures";
export const maximumReceiptPhotoBytes = 25 * 1024 * 1024;
const captureId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Summary = { vendor: string; date: string; currency: string; totalMinor: number };
type Capture = {
  id: string; owner: string; source: string; hash: string; created: string;
  destination: "household" | "uplift" | null;
  state: "uploaded" | "processing" | "review" | "filed" | "uplift_intake";
  receipt: string | null; evidence: string | null; ocr: string | null;
  vendor: string | null; date: string | null; currency: string | null; total_minor: number | null;
};
function failure(code: string, statusCode: number): never {
  throw Object.assign(new Error(code), { statusCode });
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  return new Date(value).toISOString().slice(0, 10) === value;
}

function validSummary(value: Record<string, unknown>): Summary {
  const { vendor, date, currency, totalMinor } = value;
  if (Object.keys(value).length !== 4 || typeof vendor !== "string" || !vendor.trim() || vendor.length > 180 ||
      typeof date !== "string" || !validDate(date) || typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency) ||
      !Number.isSafeInteger(totalMinor) || Math.abs(Number(totalMinor)) > 99_999_999_999) failure("receipt_summary_invalid", 400);
  try {
    const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
    if (digits !== 2 || !Intl.supportedValuesOf("currency").includes(currency)) failure("receipt_currency_unsupported", 400);
  } catch { failure("receipt_currency_unsupported", 400); }
  return { vendor: vendor.trim(), date, currency, totalMinor: Number(totalMinor) };
}

// Commit clear labelled values only. Every other receipt keeps its original and OCR for review.
export function printedSummary(ocr: string): Summary | undefined {
  // OCR can merge consecutive labelled fields into one Markdown heading.
  const joined = /^((?:merchant|vendor|store)\s*:\s*[^:]+?)\s+((?:transaction date|date)\s*:\s*\d{4}-\d{2}-\d{2})\s+((?:grand total|total|amount paid)\s*:\s*[A-Z]{3} -?\d{1,9}\.\d{2})$/i;
  const lines = ocr.split(/\r?\n/).flatMap(line => {
    const plain = line.replaceAll("**", "").trim().replace(/^#{1,6}\s+/, "");
    const cells = plain.startsWith("|") && plain.endsWith("|") ? plain.slice(1, -1).split("|") : [];
    if (cells.length === 2) return [cells.map(cell => cell.trim()).join(": ")];
    const match = joined.exec(plain);
    return match ? match.slice(1) : [plain];
  });
  const unique = (pattern: RegExp) => {
    const values = [...new Set(lines.flatMap(line => {
      const match = pattern.exec(line);
      return match ? [match[1]] : [];
    }))];
    return values.length === 1 ? values[0] : undefined;
  };
  const vendor = unique(/^(?:merchant|vendor|store)\s*:\s*(.{1,180})$/i);
  const date = unique(/^(?:date|transaction date)\s*:\s*(\d{4}-\d{2}-\d{2})$/i);
  const total = unique(/^(?:grand total|total|amount paid)\s*:?[ \t]+([A-Z]{3} -?\d{1,9}\.\d{2})$/i);
  if (!vendor || !date || !total) return;
  const [currency, decimal] = total.toUpperCase().split(" ");
  try { return validSummary({ vendor, date, currency, totalMinor: Number(decimal.replace(".", "")) }); }
  catch { return undefined; }
}

export function createReceiptCaptureRoutes(options: {
  databasePath: string;
  artifacts: ArtifactStore;
  documents: DocumentsService;
  uplift: ReceiptsBridge;
  assertCurrent: (context: RequestContext) => void;
}) {
  const { artifacts, documents, uplift } = options;
  mkdirSync(dirname(options.databasePath), { recursive: true, mode: 0o700 });
  const ledger = new DatabaseSync(options.databasePath);
  ledger.exec(`PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS receipt_captures (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, source TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, created TEXT NOT NULL,
      destination TEXT CHECK(destination IN ('household','uplift')),
      state TEXT NOT NULL CHECK(state IN ('uploaded','processing','review','filed','uplift_intake')),
      receipt TEXT, evidence TEXT, ocr TEXT, vendor TEXT, date TEXT, currency TEXT, total_minor INTEGER,
      filed_at TEXT, filed_by TEXT, filing_method TEXT CHECK(filing_method IN ('ocr','manual'))
    );`);
  const inFlight = new Set<string>();
  const get = (id: string) => ledger.prepare("SELECT * FROM receipt_captures WHERE id=?").get(id) as Capture | undefined;

  function projection(row: Capture, profileId: string, includeOcr = false) {
    return {
      id: row.id, createdAt: row.created, mine: row.owner === profileId, destination: row.destination,
      state: row.state, upliftReceiptId: row.receipt, vendor: row.vendor, date: row.date, currency: row.currency,
      totalMinor: row.total_minor, ...(includeOcr ? { ocr: row.ocr } : {}),
    };
  }

  function commitSummary(row: Capture, summary: Summary, expectedState: "processing" | "review", profileId: string) {
    const method = expectedState === "processing" ? "ocr" : "manual";
    const changed = ledger.prepare(`UPDATE receipt_captures SET state='filed',vendor=?,date=?,currency=?,total_minor=?,
      filed_at=?,filed_by=?,filing_method=? WHERE id=? AND destination='household' AND state=?`)
      .run(summary.vendor, summary.date, summary.currency, summary.totalMinor, new Date().toISOString(),
        profileId, method, row.id, expectedState);
    if (!changed.changes) failure("receipt_capture_changed", 409);
  }

  async function route(request: IncomingMessage, response: ServerResponse, url: URL, bytes: Buffer, context: RequestContext) {
    const parts = url.pathname.split("/");
    if (parts[1] !== "v1" || parts[2] !== "receipt-captures") return false;
    const current = () => {
      options.assertCurrent(context);
      if (context.device.kind !== "signed" || context.device.deviceKind !== "personal" ||
          !["alex", "natasha"].includes(context.profile.id)) failure("receipt_capture_forbidden", 403);
    };
    current();
    const id = parts[3];
    const profileId = context.profile.id;
    if (parts.length === 3 && request.method === "GET") {
      const rows = ledger.prepare(`SELECT id,owner,created,destination,state,receipt,vendor,date,currency,total_minor FROM receipt_captures WHERE owner=? OR state='filed'
        OR (destination='household' AND state='review') ORDER BY created DESC LIMIT 100`).all(profileId) as Capture[];
      sendJson(response, 200, { captures: rows.map(row => projection(row, profileId)) });
      return true;
    }
    const summaryRequest = parts.length === 5 && parts[4] === "summary" && request.method === "POST";
    const photoRequest = parts.length === 5 && parts[4] === "photo" && request.method === "GET";
    if ((!summaryRequest && !photoRequest && parts.length !== 4) || !captureId.test(id) || url.search) failure("receipt_capture_not_found", 404);
    const principal = { profileId, canReadHousehold: false };
    const scopeId = "receipt-capture:" + id;

    if (request.method === "PUT") {
      if (request.headers["content-type"]?.split(";")[0] !== "image/jpeg" || bytes.length < 3 ||
          bytes.length > maximumReceiptPhotoBytes || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255)
        failure("receipt_photo_invalid", 400);
      const hash = createHash("sha256").update(bytes).digest("hex");
      const prior = ledger.prepare("SELECT * FROM receipt_captures WHERE id=? OR hash=?").all(id, hash) as Capture[];
      if (prior.length) {
        const existing = prior[0];
        if (prior.length === 1 && existing.owner === profileId && existing.hash === hash) {
          sendJson(response, 200, { capture: projection(existing, profileId) });
          return true;
        }
        failure("receipt_photo_already_uploaded", 409);
      }
      const source = await artifacts.put({ ownerProfileId: profileId, conversationId: scopeId, taskId: scopeId, audience: "private" },
        principal, { bytes, filename: "receipt.jpg", mimeType: "image/jpeg", kind: "input", idempotencyKey: id });
      current();
      ledger.prepare("INSERT OR IGNORE INTO receipt_captures(id,owner,source,hash,created,state) VALUES (?,?,?,?,?,'uploaded')")
        .run(id, profileId, source.id, hash, source.createdAt);
      const stored = ledger.prepare("SELECT * FROM receipt_captures WHERE hash=?").get(hash) as Capture | undefined;
      if (!stored || stored.owner !== profileId) failure("receipt_photo_already_uploaded", 409);
      sendJson(response, 201, { capture: projection(stored, profileId) });
      return true;
    }

    const row = get(id);
    if (!row || row.owner !== profileId && !["review", "filed"].includes(row.state)) failure("receipt_capture_not_found", 404);
    if (photoRequest) {
      const original = await artifacts.read(row.source, { profileId: row.owner, canReadHousehold: false });
      current();
      response.writeHead(200, artifactResponseHeaders(original.metadata));
      response.end(original.bytes);
      return true;
    }
    if (request.method === "GET") {
      sendJson(response, 200, { capture: projection(row, profileId, true) });
      return true;
    }
    if (summaryRequest) {
      if (row.destination !== "household") failure("receipt_capture_not_found", 404);
      const summary = validSummary(parseJson(bytes));
      if (row.state === "filed" && row.vendor === summary.vendor && row.date === summary.date &&
          row.currency === summary.currency && row.total_minor === summary.totalMinor) {
        sendJson(response, 200, { capture: projection(row, profileId) });
        return true;
      }
      commitSummary(row, summary, "review", profileId);
      sendJson(response, 200, { capture: projection(get(id)!, profileId) });
      return true;
    }
    if (request.method !== "POST" || row.owner !== profileId) failure("receipt_capture_not_found", 404);
    const input = parseJson(bytes);
    const destination = input.destination;
    if (Object.keys(input).length !== 1 || destination !== "household" && destination !== "uplift")
      failure("receipt_destination_invalid", 400);
    if (row.destination && row.destination !== destination) failure("receipt_already_routed", 409);
    if (["filed", "review", "uplift_intake"].includes(row.state)) {
      sendJson(response, 200, { capture: projection(row, profileId) });
      return true;
    }
    if (inFlight.has(id)) failure("receipt_processing", 409);
    inFlight.add(id);
    ledger.prepare("UPDATE receipt_captures SET destination=?,state='processing' WHERE id=?").run(destination, id);
    const abort = new AbortController();
    const disconnect = () => abort.abort();
    response.once("close", disconnect);
    const document: DocumentPrincipal = {
      ...principal, agentId: context.profile.agentId, conversationId: scopeId, taskId: scopeId,
      audience: "private", canProcessDocuments: true, assertCurrent: current, signal: abort.signal,
    };
    try {
      if (destination === "uplift") {
        const receiptId = await uplift.captureOriginal(document, row.source, "capture-" + id);
        current();
        ledger.prepare("UPDATE receipt_captures SET state='uplift_intake',receipt=? WHERE id=?").run(receiptId, id);
      } else {
        const extraction = await documents.extract(document, { operationId: "capture-" + id, artifactId: row.source, mode: "ocr" });
        const ocr = extraction.excerpt;
        current();
        ledger.prepare("UPDATE receipt_captures SET evidence=?,ocr=? WHERE id=?").run(extraction.extractionArtifactId, ocr, id);
        const summary = extraction.truncated || extraction.warnings.length ? undefined : printedSummary(ocr);
        const similar = summary && ledger.prepare(`SELECT 1 FROM receipt_captures WHERE id<>? AND state='filed'
          AND lower(vendor)=lower(?) AND date=? AND currency=? AND total_minor=? LIMIT 1`)
          .get(id, summary.vendor, summary.date, summary.currency, summary.totalMinor);
        if (summary && !similar) commitSummary(row, summary, "processing", profileId);
        else ledger.prepare("UPDATE receipt_captures SET state='review' WHERE id=?").run(id);
      }
      sendJson(response, 200, { capture: projection(get(id)!, profileId, true) });
    } finally {
      response.off("close", disconnect);
      inFlight.delete(id);
    }
    return true;
  }
  return { route, close: () => ledger.close() };
}
