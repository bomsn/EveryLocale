import type Database from 'better-sqlite3';

type Migration = { version: number; description: string; up: (db: Database.Database) => void };

/**
 * Every schema change is one numbered migration, applied in order inside a transaction.
 * Migrations are never edited after release; a change to existing data is a new migration.
 * Version 2 was never released.
 */
const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    description: 'Projects, sources, jobs, publications, tokens, audit, documents and memory',
    up: (db) =>
      db.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY, config TEXT NOT NULL, spent REAL NOT NULL DEFAULT 0,
        reserved REAL NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
      );
      CREATE TABLE sources (
        project_id TEXT NOT NULL REFERENCES projects(id), unit_id TEXT NOT NULL,
        data TEXT NOT NULL, source_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY(project_id, unit_id)
      );
      CREATE TABLE jobs (
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
      CREATE INDEX jobs_claim ON jobs(status, available_at, seq);
      CREATE INDEX jobs_project ON jobs(project_id, locale, seq);
      CREATE TABLE publications (
        project_id TEXT NOT NULL, unit_id TEXT NOT NULL, locale TEXT NOT NULL,
        translation TEXT NOT NULL, source_hash TEXT NOT NULL, job_id TEXT NOT NULL,
        revision INTEGER NOT NULL, published_at INTEGER NOT NULL,
        PRIMARY KEY(project_id, unit_id, locale)
      );
      CREATE TABLE requests (
        project_id TEXT NOT NULL, request_key TEXT NOT NULL, body_hash TEXT NOT NULL,
        job_ids TEXT NOT NULL, PRIMARY KEY(project_id,request_key)
      );
      CREATE TABLE access_tokens (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
        token_hash TEXT NOT NULL UNIQUE, scopes TEXT NOT NULL, created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE audit (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL,
        actor TEXT NOT NULL, action TEXT NOT NULL, entity_id TEXT NOT NULL,
        detail TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE artifacts (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, locale TEXT NOT NULL,
        data TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE documents (
        project_id TEXT NOT NULL REFERENCES projects(id), namespace TEXT NOT NULL,
        format TEXT NOT NULL, content TEXT NOT NULL, unit_ids TEXT NOT NULL,
        source_revision TEXT NOT NULL, PRIMARY KEY(project_id,namespace)
      );
      CREATE TABLE translation_memory (
        project_id TEXT NOT NULL REFERENCES projects(id), cache_key TEXT NOT NULL,
        translation TEXT NOT NULL, findings TEXT NOT NULL, review_summary TEXT NOT NULL,
        PRIMARY KEY(project_id,cache_key)
      );
    `),
  },
  {
    version: 3,
    description: 'Durable delivery events and the encrypted provider credential vault',
    up: (db) =>
      db.exec(`
      CREATE TABLE delivery_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
        project_id TEXT NOT NULL, type TEXT NOT NULL, entity_id TEXT NOT NULL,
        detail TEXT NOT NULL, created_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        available_at INTEGER NOT NULL, lease_token TEXT, lease_until INTEGER, error TEXT
      );
      CREATE INDEX delivery_claim ON delivery_events(status,available_at,seq);
      CREATE TABLE auth_vault (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE auth_locks (id TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at INTEGER NOT NULL);
    `),
  },
  {
    version: 4,
    description:
      'Approval policies, limited reviewer tokens, revocable sessions and job failure codes',
    up: (db) => {
      // Project-wide approval modes become one catch-all policy with the same behavior.
      db.exec(`
        UPDATE projects SET config = json_remove(
          json_set(config, '$.policies', json_array(json_object(
            'match', json_object(),
            'translate', 'ai',
            'approve', coalesce(json_extract(config, '$.approvalMode'), 'human')
          ))),
          '$.approvalMode'
        );
        ALTER TABLE access_tokens ADD COLUMN locales TEXT;
        ALTER TABLE access_tokens ADD COLUMN namespaces TEXT;
        ALTER TABLE jobs ADD COLUMN failure TEXT;
        ALTER TABLE documents ADD COLUMN options TEXT NOT NULL DEFAULT '{}';
        ALTER TABLE jobs ADD COLUMN failed_at INTEGER;
        CREATE INDEX jobs_failures ON jobs(project_id, status, failed_at);
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY, token_id TEXT REFERENCES access_tokens(id), csrf TEXT NOT NULL,
          created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX sessions_expiry ON sessions(expires_at);
      `);
    },
  },
];
export const SCHEMA_VERSION = Math.max(...MIGRATIONS.map((item) => item.version));

export type MigrationResult = { from: number; to: number; backup: string | null };

/**
 * Brings a database to the current schema. An existing database is copied with VACUUM INTO
 * before its first pending migration, so a failed or unwanted upgrade can be restored.
 */
/** Refuses a database written by a newer release before this process changes anything in it. */
export function schemaVersion(db: Database.Database): number {
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version > SCHEMA_VERSION)
    throw new Error(
      `Database schema version ${String(version)} is newer than this service (${String(SCHEMA_VERSION)}); upgrade EveryLocale`,
    );
  return version;
}

export function migrate(db: Database.Database, path: string, now = Date.now()): MigrationResult {
  const from = schemaVersion(db);
  const pending = MIGRATIONS.filter((item) => item.version > from);
  if (!pending.length) return { from, to: from, backup: null };
  let backup: string | null = null;
  if (from > 0 && path !== ':memory:') {
    backup = `${path}.v${String(from)}-${String(now)}.backup.sqlite`;
    db.prepare('VACUUM INTO ?').run(backup);
  }
  for (const migration of pending)
    db.transaction(() => {
      migration.up(db);
      db.pragma(`user_version = ${String(migration.version)}`);
    }).immediate();
  return { from, to: SCHEMA_VERSION, backup };
}
