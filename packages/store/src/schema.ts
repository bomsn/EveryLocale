export const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, config TEXT NOT NULL, spent REAL NOT NULL DEFAULT 0,
  reserved REAL NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sources (
  project_id TEXT NOT NULL REFERENCES projects(id), unit_id TEXT NOT NULL,
  data TEXT NOT NULL, source_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(project_id, unit_id)
);
CREATE TABLE IF NOT EXISTS jobs (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL REFERENCES projects(id), unit_id TEXT NOT NULL,
  locale TEXT NOT NULL, source_hash TEXT NOT NULL, context_hash TEXT NOT NULL,
  source_data TEXT NOT NULL, status TEXT NOT NULL, translation TEXT,
  revision INTEGER NOT NULL DEFAULT 0, findings TEXT NOT NULL DEFAULT '[]',
  review_summary TEXT NOT NULL DEFAULT '', attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT, cost REAL NOT NULL DEFAULT 0, reserved REAL NOT NULL DEFAULT 0,
  lease_token TEXT, lease_until INTEGER, available_at INTEGER NOT NULL,
  approval_revision INTEGER, created_at INTEGER NOT NULL,
  operation TEXT NOT NULL DEFAULT 'generate',
  UNIQUE(project_id, unit_id, locale, context_hash)
);
CREATE INDEX IF NOT EXISTS jobs_claim ON jobs(status, available_at, seq);
CREATE INDEX IF NOT EXISTS jobs_project ON jobs(project_id, locale, seq);
CREATE TABLE IF NOT EXISTS publications (
  project_id TEXT NOT NULL, unit_id TEXT NOT NULL, locale TEXT NOT NULL,
  translation TEXT NOT NULL, source_hash TEXT NOT NULL, job_id TEXT NOT NULL,
  revision INTEGER NOT NULL, published_at INTEGER NOT NULL,
  PRIMARY KEY(project_id, unit_id, locale)
);
CREATE TABLE IF NOT EXISTS requests (
  project_id TEXT NOT NULL, request_key TEXT NOT NULL, body_hash TEXT NOT NULL,
  job_ids TEXT NOT NULL, PRIMARY KEY(project_id,request_key)
);
CREATE TABLE IF NOT EXISTS access_tokens (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  token_hash TEXT NOT NULL UNIQUE, scopes TEXT NOT NULL, created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS audit (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL,
  actor TEXT NOT NULL, action TEXT NOT NULL, entity_id TEXT NOT NULL,
  detail TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, locale TEXT NOT NULL,
  data TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
  project_id TEXT NOT NULL REFERENCES projects(id), namespace TEXT NOT NULL,
  format TEXT NOT NULL, content TEXT NOT NULL, unit_ids TEXT NOT NULL,
  source_revision TEXT NOT NULL, PRIMARY KEY(project_id,namespace)
);
CREATE TABLE IF NOT EXISTS translation_memory (
  project_id TEXT NOT NULL REFERENCES projects(id), cache_key TEXT NOT NULL,
  translation TEXT NOT NULL, findings TEXT NOT NULL, review_summary TEXT NOT NULL,
  PRIMARY KEY(project_id,cache_key)
);
CREATE TABLE IF NOT EXISTS delivery_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL, type TEXT NOT NULL, entity_id TEXT NOT NULL,
  detail TEXT NOT NULL, created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
  available_at INTEGER NOT NULL, lease_token TEXT, lease_until INTEGER, error TEXT
);
CREATE INDEX IF NOT EXISTS delivery_claim ON delivery_events(status,available_at,seq);
CREATE TABLE IF NOT EXISTS auth_vault (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS auth_locks (id TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at INTEGER NOT NULL);
PRAGMA user_version = 3;
`;
