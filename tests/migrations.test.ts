import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqliteStore, SCHEMA_VERSION } from '../packages/store/dist/index.js';
import { policyFor, projectSchema } from '../packages/core/dist/index.js';

async function legacyDatabase(directory: string) {
  const path = join(directory, 'everylocale.sqlite');
  const db = new DatabaseSync(path);
  db.exec(await readFile('tests/fixtures/schema-v1.sql', 'utf8'));
  db.prepare('INSERT INTO projects(id,config,created_at) VALUES(?,?,?)').run(
    'shop',
    JSON.stringify({
      id: 'shop',
      name: 'Shop',
      sourceLocale: 'en',
      targetLocales: ['de'],
      budgetUsd: 2,
      approvalMode: 'automatic',
      glossary: [],
      instructions: {},
    }),
    1,
  );
  db.prepare(
    'INSERT INTO access_tokens(id,project_id,token_hash,scopes,created_at,expires_at) VALUES(?,?,?,?,?,?)',
  ).run('t1', 'shop', 'hash', '["read"]', 1, 9e15);
  db.close();
  return path;
}

test('a first-release database upgrades in order, keeps its data and leaves a backup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'everylocale-migrate-'));
  try {
    const path = await legacyDatabase(directory);
    const store = new SqliteStore(path, () => 42);
    try {
      assert.deepEqual(store.migration, {
        from: 1,
        to: SCHEMA_VERSION,
        backup: `${path}.v1-42.backup.sqlite`,
      });
      assert.equal(store.db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
      const project = store.getProject('shop');
      assert.equal(policyFor(project, { id: 'any:key', tags: [] }).approve, 'automatic');
      assert.equal('approvalMode' in project, false);
      assert.deepEqual(store.tokens('shop')[0]?.locales, null);
      for (const table of ['delivery_events', 'auth_vault', 'sessions'])
        assert.ok(
          store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table),
          table,
        );
    } finally {
      store.close();
    }
    const backup = new DatabaseSync(`${path}.v1-42.backup.sqlite`, { readOnly: true });
    assert.equal(
      (backup.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
      1,
      'the backup is the old schema',
    );
    backup.close();
    const reopened = new SqliteStore(path);
    assert.deepEqual(reopened.migration, {
      from: SCHEMA_VERSION,
      to: SCHEMA_VERSION,
      backup: null,
    });
    reopened.close();
    assert.equal(
      (await readdir(directory)).filter((name) => name.endsWith('.backup.sqlite')).length,
      1,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a new database starts at the current schema without a backup', () => {
  const store = new SqliteStore(':memory:');
  try {
    assert.deepEqual(store.migration, { from: 0, to: SCHEMA_VERSION, backup: null });
    store.saveProject(
      projectSchema.parse({ id: 'fresh', name: 'Fresh', targetLocales: ['fr'], budgetUsd: 1 }),
    );
  } finally {
    store.close();
  }
});

test('a database from a newer release is refused before anything is changed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'everylocale-newer-'));
  try {
    const path = join(directory, 'newer.sqlite');
    const db = new DatabaseSync(path);
    db.exec(`PRAGMA user_version = ${String(SCHEMA_VERSION + 1)}`);
    db.close();
    assert.throws(() => new SqliteStore(path), /newer than this service/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
