# Local document primitives

Documents owns extraction behavior, not contacts, financial acceptance or a
new document database. `DocumentsService(artifactPort, extractor)` accepts
only authorized artifact IDs, creates immutable extraction evidence and offers
bounded text reads. It returns original source ID/hash plus extraction IDs,
not local paths or private origin conversation metadata. Extracted content is
explicitly untrusted data and cannot authorize another tool.

`ArtifactDocumentAccess` reuses the existing ArtifactStore. Inputs must belong
to the current conversation/task or an explicit trusted artifact grant from
the owning domain. On every read and replay, both extraction and source
authorization are checked. Stable operation fingerprints return existing
extractions rather than rerunning OCR. The service is not a job scheduler.
Private sources/extractions cannot be read or republished in a household
conversation, even when the caller owns them. An explicit artifact grant does
not declassify its audience. Shared input may be analyzed privately; the
result keeps that private output audience.

`LocalDocumentExtractor({pythonPath, readerScriptPath, cacheRoot}, runner)`
uses the shared bounded process runner with a narrow structural port. The
existing pinned local reader accepts source bytes through stdin, never a
model-chosen filesystem path. PNG/JPEG/WebP use bounded single-frame Pillow
decoding, EXIF orientation and a derived PDF before the existing CPU
Docling/RapidOCR pipeline. Original bytes/hash remain distinct from the derived
PDF. PDFs retain the previous fast-text/structured/OCR modes. The 25 MiB input,
100-page PDF, 20-million-pixel image and existing five-minute Docling limits
remain explicit provider bounds; no cloud fallback or runtime model download
is enabled. Raw provider stderr/errors are not surfaced by this adapter.

The trusted cache root is under writable protected application state via
`HARDY_HOME_DOCUMENT_CACHE`, allowing the existing household service's
read-only home policy to remain intact. Cached files are supporting extraction
evidence, not canonical memory, a contact directory or a financial ledger.
The adapter verifies exact output cache paths, regular files and original
source identity before publishing bounded extraction artifacts.

Task cancellation, current grants and device revocation are checked through
trusted `assertCurrent`/signal injection before process launch and publication.
The shared runner kills process descendants and joins lifecycle shutdown.
Contacts and receipts compose these operations through their owning interfaces;
this module never writes their tables. Tests are deferred until the complete
three-slice build; import/configuration readiness is not OCR accuracy evidence.
