import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore } from '../packages/store/dist/index.js';
import { projectSchema } from '../packages/core/dist/index.js';

test('SQLite survives process-style close/reopen and exposes only approved document content', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'everylocale-persistence-')),
    path = join(directory, 'state.sqlite');
  let store = new SqliteStore(path);
  try {
    store.saveProject(
      projectSchema.parse({ id: 'docs', name: 'Documents', targetLocales: ['fr'], budgetUsd: 1 }),
    );
    const imported = store.importDocument(
      'docs',
      'article',
      'markdown',
      '# Hello\n\nRead [the guide](https://example.test).\n',
    );
    const jobs = store.enqueue('docs', imported.units, ['fr'], 'first');
    store.close();
    store = new SqliteStore(path);
    assert.throws(() => store.exportDocument('docs', 'article', 'fr'));
    for (const job of jobs) {
      const claim = store.claim(() => 0)!;
      const text = claim.record.source.source
        .replace('Hello', 'Bonjour')
        .replace('Read', 'Lire')
        .replace('the guide', 'le guide');
      store.complete(job.id, claim.leaseToken, text, [], '');
      store.approve('docs', job.id, 1, 'owner');
    }
    const exported = store.exportDocument('docs', 'article', 'fr');
    assert.match(exported.content, /# Bonjour/);
    assert.match(exported.content, /https:\/\/example.test/);
    assert.equal(exported.sourceRevision, imported.sourceRevision);
    store.importDocument('docs', 'article', 'markdown', '# New source\n');
    assert.throws(() => store.exportDocument('docs', 'article', 'fr'));
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
