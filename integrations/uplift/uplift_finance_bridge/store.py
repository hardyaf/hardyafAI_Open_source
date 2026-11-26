from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat

from . import POLICY_VERSION, SCHEMA_VERSION
from .authority import IDENTIFIER, receipt_access
from .errors import ReceiptError, require
from .schema import SCHEMA


def now():
    return datetime.now(timezone.utc).isoformat()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def digest(value):
    return hashlib.sha256(value if isinstance(value, bytes) else canonical(value).encode()).hexdigest()


def identifier(prefix, value):
    return prefix + digest(value)[:48]


def private_directory(path):
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and not path.is_symlink(), "uplift_storage_unsafe", 503)
    if os.name != "nt":
        require(info.st_uid == os.getuid() and info.st_mode & 0o077 == 0, "uplift_storage_permissions", 503)


class Store:
    def __init__(self, database, vault):
        self.database = Path(database)
        self.vault = Path(vault)
        require(self.database.is_absolute() and self.vault.is_absolute(), "uplift_paths_required", 503)
        self.connection = None

    def initialize(self):
        private_directory(self.database.parent)
        private_directory(self.vault)
        private_directory(self.vault / "originals")
        if self.database.exists():
            info = self.database.lstat()
            require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and not self.database.is_symlink(), "uplift_storage_unsafe", 503)
            if os.name != "nt":
                require(info.st_uid == os.getuid() and info.st_mode & 0o077 == 0, "uplift_storage_permissions", 503)
        connection = sqlite3.connect(self.database, timeout=10, isolation_level=None)
        self.connection = connection
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA synchronous=FULL")
        connection.execute("PRAGMA busy_timeout=10000")
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
        require(not tables or "ingest_documents" in tables or "uplift_api_migrations" in tables, "uplift_database_authority_mismatch", 503)
        if "ingest_documents" in tables:
            columns = {row[1] for row in connection.execute("PRAGMA table_info(ingest_documents)")}
            require({"sha256", "source_path", "source_name", "size_bytes", "stored_path", "first_ingested_at_utc"} <= columns, "uplift_database_authority_mismatch", 503)
        if connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='uplift_api_migrations'").fetchone():
            maximum = connection.execute("SELECT MAX(version) FROM uplift_api_migrations").fetchone()[0]
            require(maximum is None or maximum <= SCHEMA_VERSION, "uplift_schema_newer_than_code", 503)
        connection.executescript(SCHEMA)
        connection.execute("INSERT OR IGNORE INTO uplift_api_migrations(version,applied_at) VALUES (?,?)", (SCHEMA_VERSION, now()))
        if os.name != "nt":
            os.chmod(self.database, 0o600)
        return self.readiness()

    def open_existing(self):
        require(self.database.is_file() and not self.database.is_symlink(), "uplift_not_initialized", 503)
        info = self.database.lstat()
        require(info.st_nlink == 1, "uplift_storage_unsafe", 503)
        if os.name != "nt":
            require(info.st_uid == os.getuid() and info.st_mode & 0o077 == 0, "uplift_storage_permissions", 503)
        private_directory(self.database.parent)
        private_directory(self.vault)
        self.connection = sqlite3.connect(self.database, timeout=10, isolation_level=None)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys=ON")
        self.connection.execute("PRAGMA busy_timeout=10000")
        self.connection.execute("PRAGMA synchronous=FULL")
        require(self.connection.execute("SELECT MAX(version) FROM uplift_api_migrations").fetchone()[0] == SCHEMA_VERSION, "uplift_schema_unavailable", 503)

    def close(self):
        if self.connection is not None:
            self.connection.close()
            self.connection = None

    def readiness(self):
        versions = [row[0] for row in self.connection.execute("SELECT version FROM uplift_api_migrations ORDER BY version")]
        return {"schemaVersion": SCHEMA_VERSION, "migrationVersions": versions, "policyVersion": POLICY_VERSION,
                "authority": "uplift", "providersInvoked": False, "legacyAcceptanceImported": False,
                "projectCatalogConfigured": self.connection.execute("SELECT COUNT(*) FROM uplift_projects WHERE active=1").fetchone()[0] > 0}

    def mutate(self, principal, operation, operation_id, params, callback, receipt_id=None, project_code=None):
        require(isinstance(operation_id, str) and 8 <= len(operation_id) <= 128 and IDENTIFIER.fullmatch(operation_id), "receipt_operation_id_required")
        request_hash = digest({"operation": operation, "params": params})
        connection = self.connection
        connection.execute("BEGIN IMMEDIATE")
        try:
            if receipt_id:
                receipt_access(connection, principal, receipt_id)
            if project_code:
                principal.project(project_code)
            previous = connection.execute("SELECT * FROM uplift_api_operations WHERE actor_id=? AND operation_id=?", (principal.actor_id, operation_id)).fetchone()
            if previous:
                require(previous["request_hash"] == request_hash and previous["operation"] == operation, "receipt_operation_conflict", 409)
                result = json.loads(previous["result_json"])
                connection.commit()
                return {**result, "replayed": True}
            result = callback()
            connection.execute("INSERT INTO uplift_api_operations(actor_id,operation_id,operation,request_hash,receipt_id,project_code,result_json,committed_at) VALUES (?,?,?,?,?,?,?,?)",
                               (principal.actor_id, operation_id, operation, request_hash, receipt_id, project_code, canonical(result), now()))
            connection.commit()
            return {**result, "replayed": False}
        except BaseException:
            connection.rollback()
            raise

    def receipt(self, principal, receipt_id):
        return receipt_access(self.connection, principal, receipt_id)

    def revision(self, receipt_id, revision, principal=None):
        row = self.connection.execute("SELECT * FROM uplift_revisions WHERE receipt_id=? AND revision=?", (receipt_id, revision)).fetchone()
        require(row is not None, "receipt_revision_not_found", 404)
        if principal is not None:
            body = json.loads(row["candidate_json"])
            require(all(part["projectCode"] in principal.project_codes for part in body.get("allocations", [])), "receipt_revision_not_found", 404)
        return row

    def evidence(self, receipt_id):
        return {row["id"]: {**dict(row), "facts": json.loads(row["facts_json"])}
                for row in self.connection.execute("SELECT * FROM uplift_evidence WHERE receipt_id=?", (receipt_id,))}

    def save_original(self, sha256, content):
        require(re.fullmatch(r"[a-f0-9]{64}", sha256) is not None and hashlib.sha256(content).hexdigest() == sha256, "receipt_source_hash_mismatch")
        relative = "originals/" + sha256
        target = self.vault / relative
        try:
            descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
        except FileExistsError:
            self.read_original(relative, sha256)
            return relative
        try:
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
        except BaseException:
            # An incomplete immutable object is never considered a valid original.
            target.unlink(missing_ok=True)
            raise
        return relative

    def read_original(self, relative, expected):
        require(re.fullmatch(r"originals/[a-f0-9]{64}", relative) is not None, "receipt_source_unavailable", 503)
        descriptor = os.open(self.vault/relative, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor, "rb") as handle:
            info = os.fstat(handle.fileno())
            require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= 25*1024*1024, "receipt_source_unavailable", 503)
            if os.name != "nt":
                require(info.st_uid == os.getuid() and info.st_mode & 0o077 == 0, "uplift_storage_permissions", 503)
            content = handle.read()
        require(hashlib.sha256(content).hexdigest() == expected, "receipt_source_hash_mismatch", 503)
        return content
