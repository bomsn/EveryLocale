import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteStore } from '../packages/store/src/index.js';
import { projectSchema, unitSchema } from '../packages/core/dist/index.js';
test('changed glossary or instructions retain manual wording for new independent review until its source changes', () => {
  const store = new SqliteStore(':memory:');
  const project = projectSchema.parse({
    id: 'example',
    name: 'Example',
    targetLocales: ['de'],
    approvalMode: 'automatic',
    budgetUsd: 1,
  });
  try {
    store.saveProject(project);
    store.importSources('example', [
      unitSchema.parse({ id: 'welcome', source: 'Welcome {name}', kind: 'icu' }),
    ]);
    const first = store.enqueue('example', ['welcome'], ['de'], 'first')[0]!;
    let claim = store.claim(() => 0)!;
    store.complete(first.id, claim.leaseToken, 'Willkommen {name}', [], '');
    store.edit('example', first.id, 1, 'Guten Tag {name}', 'owner');
    claim = store.claim(() => 0)!;
    store.complete(first.id, claim.leaseToken, 'Guten Tag {name}', [], '');
    store.saveProject({ ...project, instructions: { de: 'Formal voice' } });
    const next = store.enqueue('example', ['welcome'], ['de'], 'guidance')[0]!;
    assert.equal(next.status, 'pending');
    assert.equal(next.translation, 'Guten Tag {name}');
    assert.equal(store.exportCatalog('example', 'de').messages.welcome, 'Guten Tag {name}');
    claim = store.claim(() => 0)!;
    assert.equal(claim.reviewOnly, true);
    store.complete(next.id, claim.leaseToken, next.translation!, [], 'Reviewed new guidance');
    assert.equal(store.exportCatalog('example', 'de', true).messages.welcome, 'Guten Tag {name}');
    store.importSources('example', [
      unitSchema.parse({ id: 'welcome', source: 'Goodbye {name}', kind: 'icu' }),
    ]);
    const changed = store.enqueue('example', ['welcome'], ['de'], 'source')[0]!;
    assert.equal(changed.translation, null);
    claim = store.claim(() => 0)!;
    assert.equal(claim.reviewOnly, false);
  } finally {
    store.close();
  }
});
