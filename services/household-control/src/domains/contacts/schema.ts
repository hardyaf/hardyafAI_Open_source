/** Contacts owns these tables; app.db alone applies the additive migration. */
export const contactsMigrationSql = `
CREATE TABLE IF NOT EXISTS contact_cards (
  id TEXT PRIMARY KEY, owner_profile_id TEXT NOT NULL, audience TEXT NOT NULL CHECK(audience IN ('private','household')),
  origin_conversation_id TEXT NOT NULL, origin_task_id TEXT NOT NULL, origin_prompt_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY, card_id TEXT NOT NULL UNIQUE REFERENCES contact_cards(id), owner_profile_id TEXT NOT NULL,
  audience TEXT NOT NULL CHECK(audience IN ('private','household')), current_revision INTEGER NOT NULL CHECK(current_revision>0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS contact_card_sources (
  card_id TEXT NOT NULL REFERENCES contact_cards(id), ordinal INTEGER NOT NULL, artifact_id TEXT NOT NULL,
  original_artifact_id TEXT NOT NULL, sha256 TEXT NOT NULL, mime_type TEXT NOT NULL, byte_length INTEGER NOT NULL,
  filename TEXT NOT NULL, PRIMARY KEY(card_id,ordinal)
);
CREATE TABLE IF NOT EXISTS contact_revisions (
  contact_id TEXT NOT NULL REFERENCES contacts(id), revision INTEGER NOT NULL,
  fields_json TEXT NOT NULL, observations_json TEXT NOT NULL, uncertainties_json TEXT NOT NULL,
  reason TEXT NOT NULL, audience TEXT NOT NULL CHECK(audience IN ('private','household')), actor_profile_id TEXT NOT NULL, prompt_id TEXT, created_at TEXT NOT NULL,
  PRIMARY KEY(contact_id,revision)
);
CREATE TABLE IF NOT EXISTS contact_operations (
  actor_profile_id TEXT NOT NULL, operation_id TEXT NOT NULL, request_hash TEXT NOT NULL,
  contact_id TEXT NOT NULL REFERENCES contacts(id), response_json TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(actor_profile_id,operation_id)
);
CREATE INDEX IF NOT EXISTS contacts_audience_updated ON contacts(audience,updated_at);
CREATE INDEX IF NOT EXISTS contacts_owner_updated ON contacts(owner_profile_id,updated_at);
`;
