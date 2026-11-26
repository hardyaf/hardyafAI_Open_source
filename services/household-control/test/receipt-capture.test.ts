import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createReceiptCaptureRoutes, printedSummary } from "../src/client-views/receipt-capture.ts";
import type { DocumentsService } from "../src/domains/documents/index.ts";
import type { ReceiptsBridge } from "../src/domain-runtime/receipts-bridge.ts";
import { ArtifactStore } from "../src/platform/artifacts.ts";
import type { RequestContext } from "../src/server.ts";
import { createServer } from "node:http";

test("household automatic filing requires an unambiguous printed receipt summary", () => {
  const body = "Vendor: Grocery\nDate: 2026-11-13\nTotal USD 12.30";
  assert.deepEqual(printedSummary(body), { vendor: "Grocery", date: "2026-11-13", currency: "USD", totalMinor: 1230 });
  assert.equal(printedSummary(body.replace("2026-11-13", "2026-11-31")), undefined);
  assert.equal(printedSummary(body.replace("USD", "$")), undefined);
  assert.equal(printedSummary(body + "\nAmount paid EUR 12.30"), undefined);
  assert.equal(printedSummary(body.replace("USD", "JPY")), undefined);
  const heading = "## Vendor: Grocery Date: 2026-11-13 Total: USD 12.30";
  assert.deepEqual(printedSummary(heading), printedSummary(body));
  assert.equal(printedSummary(heading.replace("Total", "Sub Total")), undefined);
  assert.equal(printedSummary(heading + "\nAmount paid USD 13.00"), undefined);
});

test("receipt routing survives reopen, preserves scope, and files only once", async () => {
  const root = await mkdtemp(join(tmpdir(), "household-receipt-"));
  const artifacts = new ArtifactStore({ root: join(root, "artifacts") });
  await artifacts.initialize();
  let extractions = 0;
  let failExtraction = false;
  let upliftIntakes = 0;
  let receiptOcr = "Vendor: Grocery\nDate: 2026-11-13\nTotal USD 12.30";
  const options = {
    databasePath: join(root, "finances", "ledger.sqlite"),
    artifacts,
    assertCurrent(context: RequestContext) {
      if (context.device.kind !== "signed") throw Object.assign(new Error("unauthorized"), { statusCode: 403 });
    },
    documents: { async extract() {
      extractions++;
      if (failExtraction) throw Object.assign(new Error("ocr_unavailable"), { statusCode: 503 });
      return { excerpt: receiptOcr, warnings: [], extractionArtifactId: "evidence-fixture" };
    } } as unknown as DocumentsService,
    uplift: { async captureOriginal() { upliftIntakes++; return "receipt-" + "a".repeat(48); } } as unknown as ReceiptsBridge,
  };
  let receipts = createReceiptCaptureRoutes(options);
  const server = createServer(async (req, res) => {
    const id = String(req.headers["x-fixture-profile"] ?? "alex");
    const context = { profile: { id, agentId: id }, device: { kind: "signed", deviceKind: "personal" } } as RequestContext;
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const routed = await receipts.route(req, res, new URL(req.url!, "http://localhost"), Buffer.concat(chunks), context);
      if (!routed) res.writeHead(404).end();
    } catch (error) {
      const typed = error as { statusCode?: number; message: string };
      res.writeHead(typed.statusCode ?? 500, { "content-type": "application/json" }).end(JSON.stringify({ error: typed.message }));
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const base = "http://127.0.0.1:" + address.port + "/v1/receipt-captures";
  const request = (method: string, id: string, payload?: Buffer | object, profile = "alex") =>
    fetch(base + (id ? "/" + id : ""), {
      method, headers: { "x-fixture-profile": profile,
        "content-type": Buffer.isBuffer(payload) ? "image/jpeg" : "application/json" },
      body: Buffer.isBuffer(payload) ? new Uint8Array(payload) : payload ? JSON.stringify(payload) : undefined,
    });
  const photo = Buffer.from([255, 216, 255, 10]);
  const receipt = randomUUID();
  try {
    assert.equal((await request("PUT", receipt, photo, "fred")).status, 403);
    assert.equal((await request("PUT", receipt, photo)).status, 201);
    assert.equal((await request("GET", receipt, undefined, "natasha")).status, 404);
    assert.equal((await request("PUT", receipt, photo)).status, 200);
    receipts.close();
    receipts = createReceiptCaptureRoutes(options);
    const filed = await request("POST", receipt, { destination: "household" });
    assert.equal(filed.status, 200);
    assert.equal((await filed.json()).capture.state, "filed");
    assert.equal((await request("POST", receipt, { destination: "uplift" })).status, 409);
    assert.equal((await request("POST", receipt, { destination: "household" })).status, 200);
    assert.equal(extractions, 1);
    assert.equal((await (await request("GET", "", undefined, "natasha")).json()).captures.length, 1);
    assert.deepEqual(Buffer.from(await (await request("GET", receipt + "/photo", undefined, "natasha")).arrayBuffer()), photo);

    const ambiguous = randomUUID();
    receiptOcr = "Grocery\nTotal $5.00";
    assert.equal((await request("PUT", ambiguous, Buffer.from([255, 216, 255, 12]), "natasha")).status, 201);
    failExtraction = true;
    assert.equal((await request("POST", ambiguous, { destination: "household" }, "natasha")).status, 503);
    assert.equal((await (await request("GET", ambiguous, undefined, "natasha")).json()).capture.state, "processing");
    assert.equal((await request("POST", ambiguous, { destination: "uplift" }, "natasha")).status, 409);
    failExtraction = false;
    const review = await request("POST", ambiguous, { destination: "household" }, "natasha");
    assert.equal((await review.json()).capture.state, "review");
    const summary = { vendor: "Grocery", date: "2026-11-14", currency: "USD", totalMinor: 500 };
    const confirm = await request("POST", ambiguous + "/summary", summary);
    assert.equal((await confirm.json()).capture.totalMinor, 500);
    assert.equal((await request("POST", ambiguous + "/summary", summary)).status, 200);

    const uplift = randomUUID();
    assert.equal((await request("PUT", uplift, Buffer.from([255, 216, 255, 15]), "natasha")).status, 201);
    assert.equal((await (await request("POST", uplift, { destination: "uplift" }, "natasha")).json()).capture.state, "uplift_intake");
    assert.equal((await request("POST", uplift, { destination: "uplift" }, "natasha")).status, 200);
    assert.equal((await request("GET", uplift)).status, 404);
    assert.equal(extractions, 3);
    assert.equal(upliftIntakes, 1);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    receipts.close();
    await rm(root, { recursive: true, force: true });
  }
});
