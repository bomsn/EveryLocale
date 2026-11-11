import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectSchema, unitSchema, sourceHash, type Policy } from '../packages/core/dist/index.js';
import { SqliteStore } from '../packages/store/dist/index.js';

function fixture(policies: Policy[], locked: string[] = []) {
  const store = new SqliteStore(':memory:');
  const project = projectSchema.parse({
    id: 'site',
    name: 'Site',
    targetLocales: ['de', 'fr'],
    budgetUsd: 1,
    policies,
    locked,
  });
  store.saveProject(project);
  store.importSources('site', [
    unitSchema.parse({ id: 'legal:terms', source: 'You agree to these terms.' }),
    unitSchema.parse({ id: 'common:save', source: 'Save' }),
    unitSchema.parse({ id: 'common:brand', source: 'EveryLocale' }),
    unitSchema.parse({ id: 'marketing:hero', source: 'Ship faster', tags: ['campaign'] }),
  ]);
  return { store, project };
}
const humanLegal: Policy[] = [
  { match: { namespace: 'legal' }, translate: 'human', approve: 'human' },
  { match: { tag: 'campaign' }, translate: 'ai', approve: 'human' },
  { match: {}, translate: 'ai', approve: 'automatic' },
];

test('text under a human translation policy never reaches a model and waits for a person', () => {
  const { store } = fixture(humanLegal);
  try {
    const [terms] = store.enqueue('site', ['legal:terms'], ['de'], 'legal');
    assert.ok(terms);
    assert.equal(terms.status, 'awaiting');
    assert.equal(
      store.claim(() => 0),
      null,
      'nothing is offered to the worker',
    );
    store.edit('site', terms.id, terms.revision, 'Sie stimmen diesen Bedingungen zu.', 'owner');
    const written = store.getJob('site', terms.id);
    assert.equal(written.status, 'review', 'human approval is still required');
    assert.match(written.reviewSummary, /no text to a model/);
    assert.equal(
      store.claim(() => 0),
      null,
      'wording written by a person gets no AI review here',
    );
    store.approve('site', terms.id, written.revision, 'reviewer');
    assert.equal(
      store.exportCatalog('site', 'de').messages['legal:terms'],
      'Sie stimmen diesen Bedingungen zu.',
    );
    assert.equal(store.summary('site').languages.find((item) => item.locale === 'fr')?.awaiting, 0);
  } finally {
    store.close();
  }
});

test('switching a namespace to human translation stops queued model work immediately', () => {
  const { store, project } = fixture([{ match: {}, translate: 'ai', approve: 'automatic' }]);
  try {
    const [terms] = store.enqueue('site', ['legal:terms'], ['de'], 'before');
    assert.equal(terms?.status, 'pending');
    store.saveProject({ ...project, policies: humanLegal });
    assert.equal(store.getJob('site', terms.id).status, 'awaiting');
    assert.equal(
      store.claim(() => 0),
      null,
    );
  } finally {
    store.close();
  }
});

test('the first matching policy wins and tags select a policy without changing the source revision', () => {
  const { store } = fixture(humanLegal);
  try {
    const tagged = unitSchema.parse({
      id: 'marketing:hero',
      source: 'Ship faster',
      tags: ['campaign'],
    });
    const untagged = unitSchema.parse({ id: 'marketing:hero', source: 'Ship faster' });
    assert.equal(sourceHash(tagged), sourceHash(untagged));
    const [hero] = store.enqueue('site', ['marketing:hero'], ['de'], 'hero');
    assert.ok(hero);
    const claimed = store.claim(() => 0);
    assert.equal(claimed?.record.id, hero.id);
    store.complete(hero.id, claimed.leaseToken, 'Schneller liefern', [], 'Clean');
    assert.equal(store.getJob('site', hero.id).status, 'review', 'the campaign tag needs a person');
    const [save] = store.enqueue('site', ['common:save'], ['de'], 'save');
    const next = store.claim(() => 0);
    assert.ok(save && next);
    store.complete(save.id, next.leaseToken, 'Speichern', [], 'Clean');
    assert.equal(store.getJob('site', save.id).status, 'approved', 'the catch-all approves');
  } finally {
    store.close();
  }
});

test('locked keys publish the source text in every locale without model work', () => {
  const { store } = fixture(humanLegal, ['common:brand']);
  try {
    const jobs = store.enqueue('site', ['common:brand'], ['de', 'fr'], 'brand');
    assert.deepEqual(
      jobs.map((job) => job.status),
      ['approved', 'approved'],
    );
    assert.equal(
      store.claim(() => 0),
      null,
    );
    assert.equal(store.exportCatalog('site', 'fr').messages['common:brand'], 'EveryLocale');
    assert.ok(
      store.auditLog('site').some((entry) => entry.actor === 'locked-key'),
      'the audit names who approved',
    );
  } finally {
    store.close();
  }
});

test('imported translations follow each message policy and report every rejected entry', () => {
  const { store } = fixture([
    { match: { namespace: 'legal' }, translate: 'human', approve: 'automatic' },
    { match: {}, translate: 'ai', approve: 'automatic' },
  ]);
  try {
    const result = store.importTranslations(
      'site',
      'de',
      [
        { unitId: 'legal:terms', translation: 'Sie stimmen diesen Bedingungen zu.' },
        { unitId: 'common:save', translation: 'Speichern' },
        { unitId: 'common:brand', translation: 'EveryLocale 2' },
        { unitId: 'common:missing', translation: 'Fehlt' },
      ],
      'importer',
    );
    assert.deepEqual(result.imported, ['legal:terms', 'common:save']);
    assert.deepEqual(
      result.rejected.map((entry) => entry.unitId),
      ['common:brand', 'common:missing'],
    );
    assert.match(result.rejected[0]?.reason ?? '', /Protected value|Unexpected factual value/);
    // Human policy with automatic approval publishes a clean import at once.
    assert.equal(
      store.exportCatalog('site', 'de').messages['legal:terms'],
      'Sie stimmen diesen Bedingungen zu.',
    );
    // AI policy queues an independent review before anything is published.
    assert.equal(store.exportCatalog('site', 'de').messages['common:save'], undefined);
    const review = store.claim(() => 0);
    assert.equal(review?.record.unitId, 'common:save');
    assert.equal(review.reviewOnly, true);
    const again = store.importTranslations(
      'site',
      'de',
      [{ unitId: 'legal:terms', translation: 'Sie stimmen diesen Bedingungen zu.' }],
      'importer',
    );
    assert.deepEqual(again.unchanged, ['legal:terms']);
    assert.throws(
      () =>
        store.importTranslations('site', 'ja', [{ unitId: 'common:save', translation: 'x' }], 'x'),
      /not configured/,
    );
  } finally {
    store.close();
  }
});

test('the last policy must match every message', () => {
  assert.throws(
    () =>
      projectSchema.parse({
        id: 'site',
        name: 'Site',
        targetLocales: ['de'],
        budgetUsd: 1,
        policies: [{ match: { namespace: 'legal' }, approve: 'human' }],
      }),
    /last policy must match every message/,
  );
});
