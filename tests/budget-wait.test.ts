import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteStore } from '../packages/store/dist/index.js';
import { projectSchema, unitSchema } from '../packages/core/dist/index.js';

test('temporary reservations leave jobs pending and do not starve another project', () => {
  const store = new SqliteStore(':memory:');
  try {
    for (const id of ['alpha', 'beta'])
      store.saveProject(
        projectSchema.parse({
          id,
          name: id,
          targetLocales: ['de'],
          budgetUsd: 1,
          approvalMode: 'automatic',
        }),
      );
    store.importSources('alpha', [unitSchema.parse({ id: 'first', source: 'Hello' })]);
    store.enqueue('alpha', ['first'], ['de'], 'first');
    const first = store.claim(() => 1)!;
    const sources = Array.from({ length: 150 }, (_, i) =>
      unitSchema.parse({ id: `waiting-${i}`, source: 'Welcome' }),
    );
    store.importSources('alpha', sources);
    store.enqueue(
      'alpha',
      sources.map((source) => source.id),
      ['de'],
      'waiting',
    );
    store.importSources('beta', [unitSchema.parse({ id: 'first', source: 'Hello' })]);
    store.enqueue('beta', ['first'], ['de'], 'first');
    const independent = store.claim(() => 0.8)!;
    assert.equal(independent.project.id, 'beta');
    assert.equal(
      store.operations().projects.find((project) => project.id === 'alpha')!.pending,
      150,
    );
    assert.equal(store.operations().projects.find((project) => project.id === 'alpha')!.failed, 0);
    assert.equal(
      store.claim(() => 0.8),
      null,
    );
    store.charge(first.record.id, first.leaseToken, 0.01);
    store.complete(first.record.id, first.leaseToken, 'Hallo', [], 'Reviewed');
    const resumed = store.claim(() => 0.8)!;
    assert.equal(resumed.project.id, 'alpha');
    assert.equal(resumed.record.status, 'running');
    assert.equal(
      store.deliveryEvents().filter((event) => event.type === 'alert.budget_exhausted').length,
      0,
    );
    assert.ok(store.listProjects().every((project) => project.spentUsd + project.reservedUsd <= 1));
  } finally {
    store.close();
  }
});
