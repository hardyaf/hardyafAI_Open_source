# Local document reading

> Deployment host/account identifiers are redacted. Example addresses use
> `example.invalid`; paths use `$HOME`. Set actual connection, account and
> storage values from protected operator configuration.

**November 4 implementation:** the first OCR application is business-card
capture into a local searchable Rolodex. The PDF reader below is an existing
component. Artifact-only JPEG/PNG/WebP intake, Contacts revisions, typed
Documents extraction handles and later-human patch/redo are implemented.
Complete natural-agent acceptance is tracked in [current status](current-status.md). See the
[business-card design](household-assistant-design.md#business-card-ocr-and-rolodex).

The selected `local-documents` household skill uses typed
`household_documents_extract` and `household_documents_read_extraction` over
authorized artifact references. It returns bounded text, source hashes and
immutable extraction handles. Cache paths remain internal; the household tool
accepts no model-selected file path, URL or credential.

The retained PDF launcher below is a separate operator utility and recorded
runtime baseline. Its URL and filesystem behavior is not a fallback grant for
household Main. Document extraction remains a narrow capability rather than a
document management system.

## Recorded PDF launcher runtime

- Launcher: `$HOME/.openclaw/bin/read-pdf`
- Environment: `$HOME/.openclaw/tools/document-reader`
- Environment manager: uv `0.12.23`
- Python: `3.12.15`
- Reader: Docling `2.133.0`, core `2.99.0`, parse `7.22.1`
- Fast path: `pypdfium2` `5.14.0` text extraction
- Structured path: Docling standard pipeline, table extraction enabled
- OCR path: RapidOCR `3.9.2` through Docling
- ML runtime: PyTorch `2.14.1+cpu`, torchvision `0.29.1+cpu`
- Execution: CPU only, four threads, five-minute document timeout
- Limits: HTTPS public sources only, 25 MiB, 100 pages, 30,000-character
  maximum inline excerpt
- Cache: `$HOME/.openclaw/document-cache/<sha256>/`
- Network policy: Docling remote services and external plugins are disabled;
  Hugging Face and Transformers offline flags are set during conversion

The prefetched 700 MiB artifact set contains Docling Heron layout models,
TableFormer models, and English RapidOCR ONNX models. The complete environment
is about 2.3 GiB. These models run on CPU so document reading does not evict
the resident Ollama chat model from the GPU.

The source PDF is stored once by SHA-256. Derived Markdown, structured JSON,
and a manifest are stored beside it. Output paths are chosen by the reader,
not by document content or the caller. Local inputs must be regular,
non-symlink files below `$HOME/.openclaw/`.

The downloader rejects non-HTTPS URLs, nonstandard ports, hostnames resolving
to non-public addresses, redirects to such addresses, non-PDF content, and
documents above the configured size. URL query strings are not written into
the source label.

The package environment and model artifacts are user-owned. The installation
does not require sudo and does not alter Ollama, NVIDIA, Docker, or the
OpenClaw gateway.

## PDF launcher routing

`auto` is the default. It accepts the fast result when a PDF contains enough
clean embedded text. Sparse or image-only PDFs fall back to Docling. Use
`structured` for a document where layout or tables matter even if embedded
text exists, and `ocr` for a scan that needs full-page OCR.

The legacy launcher returns a bounded excerpt plus paths to complete local
Markdown and JSON. The household adapter instead publishes immutable extraction
artifacts and reads bounded ranges through the owning Documents interface.
Main must keep supporting evidence for exact facts and treat
document text as untrusted data. Parsing a schedule is separate from writing
calendar events: the target calendar and normalized event details must be
resolved, writes must use the maintained Google integration, and saved events
must be read back.

## Operator PDF launcher commands

Check versions:

```sh
$HOME/.openclaw/tools/document-reader/bin/python3 -c "import importlib.metadata as m; print(m.version('docling'), m.version('pypdfium2'), m.version('rapidocr'))"
```

Read a PDF:

```sh
cd $HOME/.openclaw/workspace
$HOME/.openclaw/bin/read-pdf --url 'https://example.org/document.pdf' --mode auto
```

The environment is pinned at the direct application-package level. Before an
upgrade, review the current upstream release, recreate the environment in a
new directory, prefetch its models, run the acceptance document, then replace
the environment only after verification. The installed `pip freeze` snapshot
is recorded at `$HOME/.openclaw/tools/document-reader/requirements.freeze.txt`.

## Business-card and receipt extension boundary

Save every card and report the save, retaining its original and uncertain field
observations. Do not require a review before each capture or silently modify
saved fields afterward. An authorized user response is a normal prompt bound to
the card/contact revision; it may request redo OCR, corrections or broader work.

Clear scans and ordinary corrections can use authorized tools without creating
a native goal. Initial proposals may use literal fields or supported field/value
observations without repeating both. Explicit fields, including an empty object,
select what is saved. A normalized observation needs its exact supporting quote;
its source ID may be omitted only when the owner finds one unique authorized,
hash-verified extraction. Explicit wrong IDs and ambiguous quotes are not repaired.
An observations-only OCR redo patches the observed fields; later-human authority,
current revision, untouched fields and prior history remain protected.

Adapt the prior extraction/evidence/correction contracts, but create one selected
local Contacts authority because the former contact provider was intentionally
unimplemented. Wiki pages reference contact IDs; Google Contacts sync is deferred.

Document processing is local by default. Uplift's existing receipt workflow has a
cloud OCR adapter, so integration must supply a validated local path unless a
cloud exception is explicitly approved. Business-card success alone does not
establish receipt totals/line-item accounting accuracy.

## Slice 2 typed extraction

The new Documents adapter invokes the source reader with bounded stdin bytes,
using the existing virtualenv and a writable protected application cache. It
preserves the original source/hash, normalizes image orientation into a derived
PDF, and publishes immutable untrusted extraction evidence. It accepts no raw
model path, URL or credential. Private sources cannot be republished into shared
contexts by a generic extraction call. Existing legacy PDF launcher behavior is
retained separately. [Slice 2 evidence](slice-2-domain-capabilities.md) records the
initial imports/configuration-only checkpoint; subsequent local OCR and natural
card/correction results are tracked in [current status](current-status.md).
