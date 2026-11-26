"""Additive schema in the configured Uplift database, never household SQLite.

The ingest_documents shape is individually adapted from Uplift's sql/schema.sql.
Legacy financial rows are neither rewritten nor interpreted as accepted here.
"""

SCHEMA = """
CREATE TABLE IF NOT EXISTS ingest_documents (
 sha256 TEXT PRIMARY KEY, source_path TEXT NOT NULL, source_name TEXT NOT NULL,
 size_bytes INTEGER NOT NULL, stored_path TEXT NOT NULL,
 first_ingested_at_utc TEXT NOT NULL, created_at_utc TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS uplift_api_migrations (
 version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS uplift_projects (
 code TEXT PRIMARY KEY, name TEXT NOT NULL, context_text TEXT NOT NULL,
 active INTEGER NOT NULL CHECK(active IN (0,1)), revision INTEGER NOT NULL,
 updated_at TEXT NOT NULL, updated_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS uplift_receipts (
 id TEXT PRIMARY KEY, source_sha256 TEXT NOT NULL UNIQUE,
 owner_actor_id TEXT NOT NULL, artifact_id TEXT NOT NULL,
 filename TEXT NOT NULL, mime_type TEXT NOT NULL, source_relative_path TEXT NOT NULL,
 latest_revision INTEGER NOT NULL DEFAULT 0, accepted_revision INTEGER,
 disposition TEXT NOT NULL DEFAULT 'received', disputed INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(source_sha256) REFERENCES ingest_documents(sha256)
);
CREATE TABLE IF NOT EXISTS uplift_evidence (
 id TEXT PRIMARY KEY, receipt_id TEXT NOT NULL, kind TEXT NOT NULL,
 source_ref TEXT NOT NULL, source_sha256 TEXT, text_content TEXT NOT NULL,
 facts_json TEXT NOT NULL, content_hash TEXT NOT NULL,
 created_by TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(receipt_id) REFERENCES uplift_receipts(id)
);
CREATE TABLE IF NOT EXISTS uplift_revisions (
 receipt_id TEXT NOT NULL, revision INTEGER NOT NULL,
 parent_revision INTEGER NOT NULL, state TEXT NOT NULL,
 candidate_json TEXT NOT NULL, candidate_hash TEXT NOT NULL,
 validation_json TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(receipt_id,revision), FOREIGN KEY(receipt_id) REFERENCES uplift_receipts(id)
);
CREATE TABLE IF NOT EXISTS uplift_acceptances (
 id TEXT PRIMARY KEY, receipt_id TEXT NOT NULL, revision INTEGER NOT NULL,
 policy_version TEXT NOT NULL, profile TEXT NOT NULL, verification_level TEXT NOT NULL,
 actor_id TEXT NOT NULL, operation_id TEXT NOT NULL,
 evidence_json TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(receipt_id,revision) REFERENCES uplift_revisions(receipt_id,revision),
 UNIQUE(receipt_id,revision)
);
CREATE TABLE IF NOT EXISTS uplift_financial_entries (
 receipt_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, acceptance_id TEXT NOT NULL,
 currency TEXT NOT NULL, total_minor INTEGER NOT NULL, profile TEXT NOT NULL,
 purchase_date TEXT NOT NULL, vendor TEXT NOT NULL, allocations_json TEXT NOT NULL,
 verification_level TEXT NOT NULL,
 FOREIGN KEY(receipt_id,revision) REFERENCES uplift_revisions(receipt_id,revision),
 FOREIGN KEY(acceptance_id) REFERENCES uplift_acceptances(id)
);
CREATE TABLE IF NOT EXISTS uplift_reviews (
 id TEXT PRIMARY KEY, receipt_id TEXT NOT NULL, revision INTEGER NOT NULL,
 reasons_json TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(receipt_id,revision) REFERENCES uplift_revisions(receipt_id,revision),
 UNIQUE(receipt_id,revision)
);
CREATE TABLE IF NOT EXISTS uplift_review_responses (
 id TEXT PRIMARY KEY, review_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 response_text TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(review_id) REFERENCES uplift_reviews(id)
);
CREATE TABLE IF NOT EXISTS uplift_attempt_events (
 id TEXT PRIMARY KEY, receipt_id TEXT NOT NULL, native_task_ref TEXT NOT NULL,
 phase_ref TEXT NOT NULL, state TEXT NOT NULL, error_code TEXT,
 candidate_revision INTEGER, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(receipt_id) REFERENCES uplift_receipts(id)
);
CREATE TABLE IF NOT EXISTS uplift_api_operations (
 actor_id TEXT NOT NULL, operation_id TEXT NOT NULL, operation TEXT NOT NULL,
 request_hash TEXT NOT NULL, receipt_id TEXT, project_code TEXT,
 result_json TEXT NOT NULL, committed_at TEXT NOT NULL,
 PRIMARY KEY(actor_id,operation_id), FOREIGN KEY(receipt_id) REFERENCES uplift_receipts(id)
);
CREATE INDEX IF NOT EXISTS uplift_reviews_open ON uplift_reviews(status,updated_at);
CREATE INDEX IF NOT EXISTS uplift_receipts_owner ON uplift_receipts(owner_actor_id,updated_at);
CREATE INDEX IF NOT EXISTS uplift_evidence_receipt ON uplift_evidence(receipt_id,created_at);
CREATE INDEX IF NOT EXISTS uplift_attempt_receipt ON uplift_attempt_events(receipt_id,created_at);
"""
