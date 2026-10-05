#!/home/operator/.openclaw/tools/document-reader/bin/python3
"""Bounded, local-only PDF extraction for the OpenClaw household agents."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import ipaddress
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


MAX_BYTES = 25 * 1024 * 1024
MAX_PAGES = 100
DEFAULT_EXCERPT = 12_000
MAX_EXCERPT = 30_000
DOCLING_TIMEOUT_SECONDS = 300
CACHE_ROOT = Path.home() / ".openclaw" / "document-cache"
ALLOWED_LOCAL_ROOT = Path.home() / ".openclaw"
ARTIFACTS_ROOT = Path.home() / ".openclaw" / "tools" / "document-reader" / "models"


class DocumentError(RuntimeError):
    pass


def package_version(name: str) -> str:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return "not-installed"


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def ensure_cache_root() -> Path:
    CACHE_ROOT.mkdir(parents=True, exist_ok=True)
    if CACHE_ROOT.is_symlink():
        raise DocumentError("document cache root may not be a symbolic link")
    os.chmod(CACHE_ROOT, 0o700)
    return CACHE_ROOT.resolve()


def validate_public_https(url: str) -> urllib.parse.SplitResult:
    if any(character in url for character in ("\x00", "\r", "\n", "'")):
        raise DocumentError("URL contains a forbidden character")
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme.lower() != "https":
        raise DocumentError("only HTTPS document URLs are allowed")
    if not parsed.hostname or parsed.username or parsed.password:
        raise DocumentError("URL must contain a normal public hostname")
    try:
        port = parsed.port or 443
    except ValueError as exc:
        raise DocumentError("URL has an invalid port") from exc
    if port != 443:
        raise DocumentError("only the standard HTTPS port is allowed")
    try:
        addresses = socket.getaddrinfo(parsed.hostname, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise DocumentError(f"document hostname could not be resolved: {exc}") from exc
    if not addresses:
        raise DocumentError("document hostname did not resolve")
    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if not ip.is_global:
            raise DocumentError("document URL resolves to a non-public address")
    return parsed


class SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    def __init__(self) -> None:
        super().__init__()
        self.redirects = 0

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        self.redirects += 1
        if self.redirects > 5:
            raise DocumentError("document URL exceeded five redirects")
        validate_public_https(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def bounded_copy(source, destination: Path) -> None:
    total = 0
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            while True:
                chunk = source.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_BYTES:
                    raise DocumentError("document exceeds the 25 MiB limit")
                handle.write(chunk)
            handle.flush()
            os.fsync(handle.fileno())
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    if total == 0:
        destination.unlink(missing_ok=True)
        raise DocumentError("document is empty")


def download(url: str, destination: Path) -> str:
    parsed = validate_public_https(url)
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "OpenClawLocalDocuments/1.0",
            "Accept": "application/pdf,application/octet-stream;q=0.8",
        },
    )
    opener = urllib.request.build_opener(SafeRedirectHandler())
    try:
        with opener.open(request, timeout=45) as response:
            validate_public_https(response.geturl())
            length = response.headers.get("Content-Length")
            if length and int(length) > MAX_BYTES:
                raise DocumentError("document exceeds the 25 MiB limit")
            bounded_copy(response, destination)
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        raise DocumentError(f"document download failed: {exc}") from exc
    filename = Path(urllib.parse.unquote(parsed.path)).name or "document.pdf"
    return f"{parsed.hostname}/{filename}"


def copy_local(source_text: str, destination: Path) -> str:
    if any(character in source_text for character in ("\x00", "\r", "\n", "'")):
        raise DocumentError("local path contains a forbidden character")
    source = Path(source_text).expanduser()
    if source.is_symlink():
        raise DocumentError("symbolic-link document inputs are not allowed")
    try:
        resolved = source.resolve(strict=True)
    except FileNotFoundError as exc:
        raise DocumentError("local document does not exist") from exc
    allowed = ALLOWED_LOCAL_ROOT.resolve(strict=True)
    if not resolved.is_relative_to(allowed):
        raise DocumentError("local documents must be under /home/operator/.openclaw")
    if not resolved.is_file():
        raise DocumentError("local document is not a regular file")
    if resolved.stat().st_size > MAX_BYTES:
        raise DocumentError("document exceeds the 25 MiB limit")
    with resolved.open("rb") as handle:
        bounded_copy(handle, destination)
    return resolved.name


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def assert_pdf(path: Path) -> None:
    with path.open("rb") as handle:
        prefix = handle.read(1024)
    if not prefix.startswith(b"%PDF-"):
        raise DocumentError("downloaded content is not a PDF")


def stage_source(url: str | None, local_file: str | None) -> tuple[Path, str, str]:
    cache = ensure_cache_root()
    scratch = Path(tempfile.mkdtemp(prefix="fetch-", dir=cache))
    os.chmod(scratch, 0o700)
    temporary = scratch / "source.pdf"
    try:
        label = download(url, temporary) if url else copy_local(local_file or "", temporary)
        assert_pdf(temporary)
        digest = sha256_file(temporary)
        destination_dir = cache / digest
        destination_dir.mkdir(mode=0o700, exist_ok=True)
        if destination_dir.is_symlink():
            raise DocumentError("document cache entry may not be a symbolic link")
        destination = destination_dir / "source.pdf"
        if destination.exists():
            if destination.is_symlink() or sha256_file(destination) != digest:
                raise DocumentError("existing cache entry failed integrity verification")
        else:
            os.replace(temporary, destination)
            os.chmod(destination, 0o600)
        return destination, digest, label
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


def extract_fast(path: Path, source_hash: str, label: str) -> dict[str, Any]:
    try:
        import pypdfium2 as pdfium
    except ImportError as exc:
        raise DocumentError("pypdfium2 is not installed in the document-reader environment") from exc

    try:
        document = pdfium.PdfDocument(path)
    except Exception as exc:
        raise DocumentError(f"PDF could not be opened: {exc}") from exc
    try:
        page_count = len(document)
        if page_count < 1:
            raise DocumentError("PDF contains no pages")
        if page_count > MAX_PAGES:
            raise DocumentError(f"PDF has {page_count} pages; the limit is {MAX_PAGES}")
        pages: list[dict[str, Any]] = []
        for number in range(page_count):
            page = document[number]
            text_page = page.get_textpage()
            try:
                text = text_page.get_text_range().replace("\x00", "").strip()
            finally:
                text_page.close()
                page.close()
            pages.append({"page": number + 1, "text": text})
    finally:
        document.close()

    alphanumeric = sum(character.isalnum() for page in pages for character in page["text"])
    replacement = sum(page["text"].count("�") for page in pages)
    threshold = max(120, 40 * page_count)
    adequate = alphanumeric >= threshold and replacement <= max(2, alphanumeric // 100)
    header = [
        "# Extracted PDF",
        "",
        f"- Source: {label}",
        f"- SHA-256: {source_hash}",
        f"- Pages: {page_count}",
        "- Engine: pypdfium2 fast text extraction",
        "",
    ]
    body: list[str] = []
    for page in pages:
        body.extend((f"## Page {page['page']}", "", page["text"] or "[No extractable text]", ""))
    return {
        "page_count": page_count,
        "pages": pages,
        "markdown": "\n".join(header + body).rstrip() + "\n",
        "adequate": adequate,
        "alphanumeric_characters": alphanumeric,
    }


def save_fast(result: dict[str, Any], document_dir: Path, source_hash: str, label: str) -> tuple[Path, Path]:
    markdown_path = document_dir / "fast.md"
    json_path = document_dir / "fast.json"
    payload = {
        "source": label,
        "source_sha256": source_hash,
        "engine": "pypdfium2",
        "page_count": result["page_count"],
        "pages": result["pages"],
    }
    atomic_write(markdown_path, result["markdown"].encode("utf-8"))
    atomic_write(json_path, (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    return markdown_path, json_path


def extract_docling(path: Path, mode: str, document_dir: Path) -> tuple[Path, Path, str]:
    executable = Path(sys.executable).with_name("docling")
    if not executable.is_file():
        raise DocumentError("Docling CLI is not installed in the document-reader environment")
    if not ARTIFACTS_ROOT.is_dir():
        raise DocumentError("prefetched Docling model artifacts are missing")
    output_dir = Path(tempfile.mkdtemp(prefix="docling-", dir=document_dir))
    os.chmod(output_dir, 0o700)
    command = [
        str(executable),
        str(path),
        "--from", "pdf",
        "--to", "md",
        "--to", "json",
        "--pipeline", "standard",
        "--ocr",
        "--ocr-engine", "rapidocr",
        "--ocr-lang", "iso:en",
        "--tables",
        "--table-mode", "accurate",
        "--image-export-mode", "placeholder",
        "--no-enable-remote-services",
        "--no-allow-external-plugins",
        "--abort-on-error",
        "--artifacts-path", str(ARTIFACTS_ROOT),
        "--document-timeout", "240",
        "--num-threads", "4",
        "--device", "cpu",
        "--output", str(output_dir),
        "--quiet",
    ]
    if mode == "ocr":
        command.extend(("--ocr-mode", "full_page"))
    environment = os.environ.copy()
    environment.update(
        {
            "HF_HUB_OFFLINE": "1",
            "TRANSFORMERS_OFFLINE": "1",
            "DOCLING_ARTIFACTS_PATH": str(ARTIFACTS_ROOT),
            "TOKENIZERS_PARALLELISM": "false",
        }
    )
    try:
        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=DOCLING_TIMEOUT_SECONDS,
            env=environment,
        )
    except subprocess.TimeoutExpired as exc:
        raise DocumentError("Docling exceeded the five-minute conversion limit") from exc
    log = (completed.stdout + "\n" + completed.stderr).strip()[-4000:]
    if completed.returncode != 0:
        atomic_write(document_dir / "last-error.log", (log + "\n").encode("utf-8", errors="replace"))
        raise DocumentError(f"Docling conversion failed (exit {completed.returncode}): {log[-800:]}")
    markdown_files = sorted(output_dir.glob("*.md"))
    json_files = sorted(output_dir.glob("*.json"))
    if len(markdown_files) != 1 or len(json_files) != 1:
        raise DocumentError("Docling did not produce exactly one Markdown and one JSON result")
    markdown_path = document_dir / "structured.md"
    json_path = document_dir / "structured.json"
    atomic_write(markdown_path, markdown_files[0].read_bytes())
    atomic_write(json_path, json_files[0].read_bytes())
    shutil.rmtree(output_dir, ignore_errors=True)
    if not markdown_path.read_text(encoding="utf-8", errors="replace").strip():
        raise DocumentError("Docling produced an empty Markdown result")
    return markdown_path, json_path, log


def emit_result(
    *,
    source_hash: str,
    label: str,
    engine: str,
    page_count: int,
    markdown_path: Path,
    json_path: Path,
    max_output_chars: int,
    warnings: list[str],
) -> None:
    markdown = markdown_path.read_text(encoding="utf-8", errors="replace")
    truncated = len(markdown) > max_output_chars
    excerpt = markdown[:max_output_chars]
    manifest = {
        "ok": True,
        "engine": engine,
        "source": label,
        "source_sha256": source_hash,
        "page_count": page_count,
        "markdown_path": str(markdown_path),
        "json_path": str(json_path),
        "excerpt": excerpt,
        "truncated": truncated,
        "warnings": warnings,
        "versions": {
            "docling": package_version("docling"),
            "pypdfium2": package_version("pypdfium2"),
        },
    }
    atomic_write(
        markdown_path.parent / "manifest.json",
        (json.dumps({key: value for key, value in manifest.items() if key != "excerpt"}, indent=2) + "\n").encode("utf-8"),
    )
    print(json.dumps(manifest, ensure_ascii=False))


def main() -> int:
    parser = argparse.ArgumentParser(description="Read a bounded PDF locally")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--url")
    source.add_argument("--file")
    parser.add_argument("--mode", choices=("auto", "fast", "structured", "ocr"), default="auto")
    parser.add_argument("--max-output-chars", type=int, default=DEFAULT_EXCERPT)
    args = parser.parse_args()
    if not 1000 <= args.max_output_chars <= MAX_EXCERPT:
        raise DocumentError(f"max-output-chars must be between 1000 and {MAX_EXCERPT}")

    path, source_hash, label = stage_source(args.url, args.file)
    document_dir = path.parent
    fast = extract_fast(path, source_hash, label)
    warnings: list[str] = []

    if args.mode == "fast" or (args.mode == "auto" and fast["adequate"]):
        markdown_path, json_path = save_fast(fast, document_dir, source_hash, label)
        if not fast["adequate"]:
            warnings.append("Fast extraction quality was below the automatic acceptance threshold.")
        emit_result(
            source_hash=source_hash,
            label=label,
            engine="pypdfium2-fast",
            page_count=fast["page_count"],
            markdown_path=markdown_path,
            json_path=json_path,
            max_output_chars=args.max_output_chars,
            warnings=warnings,
        )
        return 0

    if args.mode == "auto":
        warnings.append("Fast extraction was sparse; Docling fallback was used.")
    markdown_path, json_path, _ = extract_docling(path, args.mode, document_dir)
    emit_result(
        source_hash=source_hash,
        label=label,
        engine="docling-rapidocr" if args.mode == "ocr" else "docling-structured",
        page_count=fast["page_count"],
        markdown_path=markdown_path,
        json_path=json_path,
        max_output_chars=args.max_output_chars,
        warnings=warnings,
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except DocumentError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        raise SystemExit(2)
