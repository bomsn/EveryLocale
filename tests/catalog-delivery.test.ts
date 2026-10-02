import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteStore } from '../packages/store/dist/index.js';
import { projectSchema, unitSchema, catalogBundleSchema } from '../packages/core/dist/index.js';
import { installBundle, activateBundle, readBundle } from '../packages/cli/dist/bundle.js';

test('catalog releases publish together, retain rollback and reject incomplete or damaged delivery', async () => {
  const store = new SqliteStore(':memory:');
  const directory = await mkdtemp(join(tmpdir(), 'everylocale-delivery-'));
  assert.ok(directory.startsWith(join(tmpdir(), 'everylocale-delivery-')));
  try {
    store.saveProject(
      projectSchema.parse({
        id: 'example',
        name: 'Example',
        targetLocales: ['de', 'fr'],
        approvalMode: 'automatic',
        budgetUsd: 1,
      }),
    );
    store.importSources('example', [unitSchema.parse({ id: 'welcome', source: 'Welcome' })]);
    store.enqueue('example', ['welcome'], ['de', 'fr'], 'first');
    assert.throws(() => store.exportBundle('example'), /not fully approved/);
    for (const translation of ['Willkommen', 'Bienvenue']) {
      const job = store.claim(() => 0)!;
      store.complete(job.record.id, job.leaseToken, translation, [], 'Checked');
    }
    const first = store.exportBundle('example');
    catalogBundleSchema.parse(first);
    await installBundle(directory, first);
    assert.deepEqual(await readBundle(directory), first);
    store.importSources('example', [unitSchema.parse({ id: 'welcome', source: 'Hello' })]);
    assert.throws(() => store.exportBundle('example'), /not fully approved/);
    assert.equal(store.exportBundle('example', false).catalogs[1]!.messages.welcome, 'Willkommen');
    store.enqueue('example', ['welcome'], ['de', 'fr'], 'second');
    for (const translation of ['Hallo', 'Bonjour']) {
      const job = store.claim(() => 0)!;
      store.complete(job.record.id, job.leaseToken, translation, [], 'Checked');
    }
    const second = store.exportBundle('example');
    await installBundle(directory, second);
    await installBundle(directory, second);
    assert.deepEqual(await readBundle(directory), second);
    await activateBundle(directory, first.revision);
    assert.deepEqual(await readBundle(directory), first);
    await writeFile(join(directory, 'releases', second.revision, 'de.json'), '{}');
    await assert.rejects(activateBundle(directory, second.revision), /differs/);
    assert.deepEqual(await readBundle(directory), first);
    await assert.rejects(activateBundle(directory, '../../bad'), /Invalid/);
    const damaged = JSON.parse(JSON.stringify(second));
    damaged.catalogs[0].messages.welcome = 'Tampered';
    assert.throws(() => catalogBundleSchema.parse(damaged), /checksum/);
    const pointer = JSON.parse(await readFile(join(directory, 'current.json'), 'utf8'));
    assert.equal(pointer.revision, first.revision);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
