#!/usr/bin/env python3
"""Deterministic Markdown storage for the household-capture OpenClaw skill."""

from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import json
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable
from zoneinfo import ZoneInfo


SECTIONS = ("Shopping", "Tasks", "Waiting", "Completed", "Removed")
KIND_SECTION = {"shopping": "Shopping", "task": "Tasks", "waiting": "Waiting"}
KINDS = frozenset((*KIND_SECTION, "note"))
SCOPES = frozenset(("household", "personal"))
CONFIDENCE = frozenset(("user-stated", "confirmed", "inferred", "unknown"))
LOCAL_TIMEZONE = ZoneInfo("America/New_York")
ITEM_RE = re.compile(
    r"^- \[(?P<done>[ xX])\] \[(?P<id>[A-Z]+-\d{8}-\d{4})\] "
    r"(?P<text>.*?)(?: \{origin:(?P<origin>[A-Za-z]+)\})?$"
)
ID_RE = re.compile(r"\b(?P<prefix>[A-Z]+)-(?P<date>\d{8})-(?P<seq>\d{4})\b")
NOTE_RE = re.compile(r"^## \[(?P<id>[A-Z]+N-\d{8}-\d{4})\] (?P<title>.+)$")


class CaptureError(ValueError):
    pass


@dataclass(frozen=True)
class Layout:
    workspace: Path

    @property
    def state_root(self) -> Path:
        return self.workspace.parent

    @property
    def household_root(self) -> Path:
        return self.state_root / "shared" / "household"

    @property
    def lock_path(self) -> Path:
        return self.state_root / ".household-capture.lock"

    @property
    def actor(self) -> str:
        return "natasha" if "natasha" in self.workspace.name.lower() else "jarvis"

    def list_path(self, scope: str) -> Path:
        validate_scope(scope)
        return (
            self.household_root / "LISTS.md"
            if scope == "household"
            else self.workspace / "LISTS.md"
        )

    def notes_dir(self, scope: str) -> Path:
        validate_scope(scope)
        return (
            self.household_root / "notes"
            if scope == "household"
            else self.workspace / "notes"
        )


class StoreLock:
    def __init__(self, layout: Layout):
        self.layout = layout
        self.handle = None

    def __enter__(self):
        self.layout.lock_path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = self.layout.lock_path.open("a+", encoding="utf-8")
        os.chmod(self.layout.lock_path, 0o600)
        fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX)
        return self

    def __exit__(self, *_):
        fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
        self.handle.close()


def validate_scope(scope: str) -> None:
    if scope not in SCOPES:
        raise CaptureError(f"scope must be one of {sorted(SCOPES)}")


def clean_line(value: Any, field: str, maximum: int = 1000) -> str:
    if not isinstance(value, str):
        raise CaptureError(f"{field} must be a string")
    value = " ".join(value.replace("\x00", "").split())
    if not value:
        raise CaptureError(f"{field} cannot be empty")
    if len(value) > maximum:
        raise CaptureError(f"{field} exceeds {maximum} characters")
    return value


def clean_note(value: Any) -> str:
    if not isinstance(value, str):
        raise CaptureError("text must be a string")
    value = value.replace("\x00", "").strip()
    if not value:
        raise CaptureError("text cannot be empty")
    if len(value) > 10000:
        raise CaptureError("note text exceeds 10000 characters")
    return value


def valid_due(value: Any) -> str | None:
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise CaptureError("due must be YYYY-MM-DD or null")
    try:
        dt.date.fromisoformat(value)
    except ValueError as exc:
        raise CaptureError("due must be YYYY-MM-DD or null") from exc
    return value


def today() -> dt.date:
    return dt.datetime.now(LOCAL_TIMEZONE).date()


def now_iso() -> str:
    return dt.datetime.now(LOCAL_TIMEZONE).isoformat(timespec="seconds")


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return ""


def atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    mode = path.stat().st_mode & 0o777 if path.exists() else 0o600
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def new_list(title: str) -> str:
    lines = [f"# {title}", ""]
    for section in SECTIONS:
        lines.extend((f"## {section}", ""))
    return "\n".join(lines).rstrip() + "\n"


def ensure_sections(text: str, title: str) -> str:
    if not text.strip():
        return new_list(title)
    lines = [line for line in text.splitlines() if line.strip() != "No list items yet."]
    if not any(line.startswith("# ") for line in lines):
        lines[0:0] = [f"# {title}", ""]
    for section in SECTIONS:
        if f"## {section}" not in lines:
            if lines and lines[-1]:
                lines.append("")
            lines.extend((f"## {section}", ""))
    return "\n".join(lines).rstrip() + "\n"


def section_end(lines: list[str], section: str) -> int:
    marker = f"## {section}"
    try:
        start = lines.index(marker) + 1
    except ValueError as exc:
        raise CaptureError(f"missing managed section {section}") from exc
    for index in range(start, len(lines)):
        if lines[index].startswith("## "):
            return index
    return len(lines)


def append_section(text: str, section: str, line: str) -> str:
    lines = text.rstrip("\n").splitlines()
    end = section_end(lines, section)
    while end and lines[end - 1] == "":
        end -= 1
    lines.insert(end, line)
    return "\n".join(lines).rstrip() + "\n"


def prefix(scope: str, actor: str, note: bool = False) -> str:
    base = "H" if scope == "household" else ("N" if actor == "natasha" else "J")
    return base + ("N" if note else "")


def next_id(contents: Iterable[str], wanted_prefix: str, day: dt.date) -> str:
    stamp = day.strftime("%Y%m%d")
    highest = 0
    for content in contents:
        for match in ID_RE.finditer(content):
            if match["prefix"] == wanted_prefix and match["date"] == stamp:
                highest = max(highest, int(match["seq"]))
    return f"{wanted_prefix}-{stamp}-{highest + 1:04d}"


def entries(text: str, scope: str) -> list[dict[str, Any]]:
    current = None
    result = []
    for line in text.splitlines():
        if line.startswith("## "):
            current = line[3:].strip()
            continue
        match = ITEM_RE.match(line)
        if match:
            result.append(
                {
                    "id": match["id"],
                    "scope": scope,
                    "section": current,
                    "done": match["done"].lower() == "x",
                    "text": match["text"],
                    "origin": match["origin"],
                }
            )
    return result


def list_title(scope: str, actor: str) -> str:
    if scope == "household":
        return "Household Lists"
    return "Natasha's Lists" if actor == "natasha" else "Jarvis Personal Lists"


def duplicate_open(items: Iterable[dict[str, Any]], section: str, text: str):
    wanted = " ".join(text.casefold().split())
    for item in items:
        candidate = re.sub(r" _\(added:.*?\)_$", "", item["text"])
        candidate = re.sub(r" \(due: \d{4}-\d{2}-\d{2}\)$", "", candidate)
        if item["section"] == section and " ".join(candidate.casefold().split()) == wanted:
            return item
    return None


def capture(layout: Layout, payload_text: str) -> dict[str, Any]:
    try:
        payload = json.loads(payload_text)
    except json.JSONDecodeError as exc:
        raise CaptureError(f"payload-json is invalid JSON: {exc.msg}") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
        raise CaptureError("payload must be an object with an items array")
    if not 1 <= len(payload["items"]) <= 50:
        raise CaptureError("items must contain between 1 and 50 entries")

    validated = []
    errors = []
    for index, raw in enumerate(payload["items"]):
        try:
            if not isinstance(raw, dict):
                raise CaptureError("item must be an object")
            kind, scope = raw.get("kind"), raw.get("scope")
            if kind not in KINDS:
                raise CaptureError(f"kind must be one of {sorted(KINDS)}")
            validate_scope(scope)
            confidence = raw.get("confidence", "user-stated")
            if confidence not in CONFIDENCE:
                raise CaptureError(f"confidence must be one of {sorted(CONFIDENCE)}")
            value = clean_note(raw.get("text")) if kind == "note" else clean_line(raw.get("text"), "text")
            validated.append(
                {
                    "kind": kind,
                    "scope": scope,
                    "text": value,
                    "title": raw.get("title"),
                    "due": valid_due(raw.get("due")),
                    "confidence": confidence,
                }
            )
        except CaptureError as exc:
            errors.append({"index": index, "error": str(exc)})
    if errors:
        return {"ok": False, "verified": False, "saved": [], "existing": [], "errors": errors}

    saved, existing = [], []
    with StoreLock(layout):
        lists = {
            scope: ensure_sections(read_text(layout.list_path(scope)), list_title(scope, layout.actor))
            for scope in SCOPES
        }
        notes: dict[tuple[str, str], str] = {}
        day = today()
        for item in validated:
            scope = item["scope"]
            if item["kind"] == "note":
                path = layout.notes_dir(scope) / f"{day.isoformat()}.md"
                key = (scope, str(path))
                current = notes.get(key, read_text(path))
                note_id = next_id((current,), prefix(scope, layout.actor, True), day)
                raw_title = item["title"] or item["text"].splitlines()[0]
                title = clean_line(raw_title, "title", 120).replace("[", "(").replace("]", ")")
                if not current.strip():
                    current = f"# Notes — {day.isoformat()}\n"
                block = (
                    f"\n## [{note_id}] {title}\n\n"
                    f"- Captured: {now_iso()}\n"
                    f"- Captured by: {layout.actor}\n"
                    f"- Visibility: {scope}\n"
                    f"- Confidence: {item['confidence']}\n\n"
                    f"{item['text']}\n"
                )
                notes[key] = current.rstrip() + "\n" + block
                saved.append(
                    {
                        "id": note_id,
                        "kind": "note",
                        "scope": scope,
                        "title": title,
                        "path": str(path),
                    }
                )
                continue

            section = KIND_SECTION[item["kind"]]
            found = duplicate_open(entries(lists[scope], scope), section, item["text"])
            if found:
                existing.append(found)
                continue
            item_id = next_id((lists[scope],), prefix(scope, layout.actor), day)
            due = f" (due: {item['due']})" if item["due"] else ""
            metadata = f" _(added: {day.isoformat()}; by: {layout.actor})_"
            line = f"- [ ] [{item_id}] {item['text']}{due}{metadata}"
            lists[scope] = append_section(lists[scope], section, line)
            saved.append(
                {
                    "id": item_id,
                    "kind": item["kind"],
                    "scope": scope,
                    "section": section,
                    "text": item["text"],
                    "due": item["due"],
                    "path": str(layout.list_path(scope)),
                }
            )

        for scope, content in lists.items():
            if any(item["scope"] == scope and item["kind"] != "note" for item in validated):
                atomic_write(layout.list_path(scope), content)
        for (_, path), content in notes.items():
            atomic_write(Path(path), content)
        verified = all(entry["id"] in read_text(Path(entry["path"])) for entry in saved)
    return {
        "ok": verified,
        "verified": verified,
        "saved": saved,
        "existing": existing,
        "errors": [],
    }


def show(layout: Layout, scope: str) -> dict[str, Any]:
    selected = ("household", "personal") if scope == "both" else (scope,)
    if scope != "both":
        validate_scope(scope)
    result = []
    for item_scope in selected:
        path = layout.list_path(item_scope)
        content = ensure_sections(read_text(path), list_title(item_scope, layout.actor))
        result.append({"scope": item_scope, "path": str(path), "items": entries(content, item_scope)})
    return {"ok": True, "lists": result}


def find_line(lines: list[str], item_id: str):
    for index, line in enumerate(lines):
        match = ITEM_RE.match(line)
        if match and match["id"] == item_id:
            section = ""
            for previous in reversed(lines[:index]):
                if previous.startswith("## "):
                    section = previous[3:].strip()
                    break
            return index, match, section
    raise CaptureError(f"item {item_id} was not found")


def move_item(
    layout: Layout, scope: str, item_id: str, action: str, confirmation: str | None
) -> dict[str, Any]:
    validate_scope(scope)
    item_id = clean_line(item_id, "id", 64)
    if action == "remove" and confirmation != item_id:
        raise CaptureError("remove requires --confirm with the exact same stable ID")
    path = layout.list_path(scope)
    with StoreLock(layout):
        content = ensure_sections(read_text(path), list_title(scope, layout.actor))
        lines = content.rstrip().splitlines()
        index, match, old_section = find_line(lines, item_id)
        if action == "complete":
            if old_section == "Completed":
                return {"ok": True, "verified": True, "unchanged": True, "id": item_id}
            destination, origin = "Completed", old_section or "Tasks"
            line = (
                f"- [x] [{item_id}] {match['text']} "
                f"_(completed: {today().isoformat()})_ {{origin:{origin}}}"
            )
        elif action == "remove":
            if old_section == "Removed":
                return {"ok": True, "verified": True, "unchanged": True, "id": item_id}
            destination, origin = "Removed", old_section or "Tasks"
            line = (
                f"- [x] [{item_id}] {match['text']} "
                f"_(removed: {today().isoformat()})_ {{origin:{origin}}}"
            )
        elif action == "restore":
            if old_section not in ("Completed", "Removed"):
                return {"ok": True, "verified": True, "unchanged": True, "id": item_id}
            destination = match["origin"] or "Tasks"
            if destination not in KIND_SECTION.values():
                destination = "Tasks"
            text = re.sub(
                r" _\((?:completed|removed): \d{4}-\d{2}-\d{2}\)_$", "", match["text"]
            )
            line = f"- [ ] [{item_id}] {text}"
        else:
            raise CaptureError(f"unsupported action {action}")

        del lines[index]
        updated = append_section("\n".join(lines).rstrip() + "\n", destination, line)
        atomic_write(path, updated)
        verified = any(
            item["id"] == item_id and item["section"] == destination
            for item in entries(read_text(path), scope)
        )
        return {
            "ok": verified,
            "verified": verified,
            "id": item_id,
            "scope": scope,
            "from": old_section,
            "section": destination,
            "path": str(path),
        }


def recent_notes(layout: Layout, scope: str, limit: int) -> dict[str, Any]:
    validate_scope(scope)
    notes = []
    for path in sorted(layout.notes_dir(scope).glob("*.md"), reverse=True):
        for note in note_entries(path):
            note["preview"] = " ".join(note.pop("text").split())[:240]
            notes.append(note)
        if len(notes) >= limit:
            break
    return {"ok": True, "scope": scope, "notes": notes[:limit]}


def note_entries(path: Path) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    body: list[str] = []

    def finish() -> None:
        if current is not None:
            current["text"] = "\n".join(body).strip()
            result.append(current.copy())

    for line in read_text(path).splitlines():
        match = NOTE_RE.match(line)
        if match:
            finish()
            current = {"id": match["id"], "title": match["title"], "path": str(path)}
            body = []
        elif current is not None:
            if line.startswith("- Captured: "):
                current["captured"] = line.removeprefix("- Captured: ")
            elif line.startswith("- Visibility: "):
                current["visibility"] = line.removeprefix("- Visibility: ")
            elif line.startswith("- Confidence: "):
                current["confidence"] = line.removeprefix("- Confidence: ")
            elif not line.startswith("- Captured by: "):
                body.append(line)
    finish()
    return result


def search_notes(layout: Layout, scope: str, query: str, limit: int) -> dict[str, Any]:
    selected = ("household", "personal") if scope == "both" else (scope,)
    if scope != "both":
        validate_scope(scope)
    wanted = clean_line(query, "query", 500).casefold()
    terms = tuple(dict.fromkeys(re.findall(r"[\w-]+", wanted)))
    matches = []
    for item_scope in selected:
        for path in sorted(layout.notes_dir(item_scope).glob("*.md"), reverse=True):
            for note in note_entries(path):
                title = note["title"].casefold()
                text = note["text"].casefold()
                note_id = note["id"].casefold()
                score = 0
                if wanted == note_id:
                    score += 200
                if wanted == title:
                    score += 150
                if wanted in title:
                    score += 75
                if wanted in text:
                    score += 50
                score += sum(8 for term in terms if term in title)
                score += sum(2 for term in terms if term in text)
                if score:
                    note["scope"] = item_scope
                    note["matchScore"] = score
                    matches.append(note)
    matches.sort(
        key=lambda note: (note["matchScore"], note.get("captured", "")), reverse=True
    )
    return {"ok": True, "scope": scope, "query": query, "notes": matches[:limit]}


def dashboard(layout: Layout, scope: str) -> dict[str, Any]:
    validate_scope(scope)
    items = show(layout, scope)["lists"][0]["items"]
    active = [item for item in items if item["section"] in ("Shopping", "Tasks", "Waiting")]
    blocks: list[dict[str, Any]] = [
        {
            "type": "metrics",
            "items": [
                {
                    "label": section,
                    "value": str(sum(item["section"] == section for item in active)),
                }
                for section in ("Shopping", "Tasks", "Waiting")
            ],
        }
    ]
    for section in ("Shopping", "Tasks", "Waiting"):
        rows = [
            [item["id"], item["text"][:240]]
            for item in active
            if item["section"] == section
        ][:10]
        if rows:
            blocks.append(
                {"type": "table", "title": section, "columns": ["ID", "Item"], "rows": rows}
            )
    if len(blocks) == 1:
        blocks.append({"type": "text", "title": "All clear", "text": "No active items."})
    blocks.append(
        {
            "type": "text",
            "title": "Snapshot",
            "text": f"Refreshed {now_iso()} from canonical Markdown.",
        }
    )
    name = "household-lists" if scope == "household" else f"{layout.actor}-personal-lists"
    title = "Household lists" if scope == "household" else "Personal lists"
    return {
        "title": title,
        "name": name,
        "pin": True,
        "size": "lg",
        "report": {"blocks": blocks},
    }


def paths(layout: Layout) -> dict[str, Any]:
    return {
        "ok": True,
        "actor": layout.actor,
        "workspace": str(layout.workspace),
        "household_lists": str(layout.list_path("household")),
        "personal_lists": str(layout.list_path("personal")),
        "household_notes": str(layout.notes_dir("household")),
        "personal_notes": str(layout.notes_dir("personal")),
    }


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    root.add_argument("--workspace", type=Path, help=argparse.SUPPRESS)
    commands = root.add_subparsers(dest="command", required=True)
    command = commands.add_parser("capture")
    command.add_argument("--payload-json", required=True)
    command = commands.add_parser("show")
    command.add_argument("--scope", choices=("household", "personal", "both"), required=True)
    command = commands.add_parser("recent-notes")
    command.add_argument("--scope", choices=tuple(SCOPES), required=True)
    command.add_argument("--limit", type=int, default=10)
    command = commands.add_parser("search-notes")
    command.add_argument("--scope", choices=("household", "personal", "both"), required=True)
    command.add_argument("--query", required=True)
    command.add_argument("--limit", type=int, default=10)
    for action in ("complete", "restore"):
        command = commands.add_parser(action)
        command.add_argument("--scope", choices=tuple(SCOPES), required=True)
        command.add_argument("--id", required=True)
    command = commands.add_parser("remove")
    command.add_argument("--scope", choices=tuple(SCOPES), required=True)
    command.add_argument("--id", required=True)
    command.add_argument("--confirm", required=True)
    command = commands.add_parser("dashboard")
    command.add_argument("--scope", choices=tuple(SCOPES), required=True)
    commands.add_parser("paths")
    return root


def default_workspace() -> Path:
    return Path(__file__).resolve().parents[3]


def main() -> int:
    args = parser().parse_args()
    layout = Layout((args.workspace or default_workspace()).expanduser().resolve())
    try:
        if args.command == "capture":
            result = capture(layout, args.payload_json)
        elif args.command == "show":
            result = show(layout, args.scope)
        elif args.command == "recent-notes":
            if not 1 <= args.limit <= 100:
                raise CaptureError("limit must be between 1 and 100")
            result = recent_notes(layout, args.scope, args.limit)
        elif args.command == "search-notes":
            if not 1 <= args.limit <= 100:
                raise CaptureError("limit must be between 1 and 100")
            result = search_notes(layout, args.scope, args.query, args.limit)
        elif args.command in ("complete", "restore"):
            result = move_item(layout, args.scope, args.id, args.command, None)
        elif args.command == "remove":
            result = move_item(layout, args.scope, args.id, "remove", args.confirm)
        elif args.command == "dashboard":
            result = dashboard(layout, args.scope)
        else:
            result = paths(layout)
    except (CaptureError, OSError) as exc:
        result = {"ok": False, "error": str(exc)}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("ok", True) else 2


if __name__ == "__main__":
    raise SystemExit(main())
