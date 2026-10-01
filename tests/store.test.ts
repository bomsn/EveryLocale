import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteStore } from '../packages/store/src/index.js';
import { projectSchema, unitSchema, ContractError } from '../packages/core/dist/index.js';

test('the final target locale can be disabled while approved history remains available for deliberate re-enabling', () => {
  const store = new SqliteStore(':memory:');
  try {
    const project = projectSchema.parse({
      id: 'disable',
      name: 'Disable',
      targetLocales: ['de'],
      budgetUsd: 1,
    });
    store.saveProject(project);
    store.importSources(project.id, [unitSchema.parse({ id: 'hello', source: 'Hello' })]);
    const job = store.enqueue(project.id, ['hello'], ['de'], 'first')[0]!,
      claim = store.claim(() => 0)!;
    store.complete(job.id, claim.leaseToken, 'Hallo', [], '');
    store.approve(project.id, job.id, 1, 'owner');
    store.saveProject({ ...project, targetLocales: [] });
    assert.throws(() => store.exportCatalog(project.id, 'de'));
    assert.equal(store.exportCatalog(project.id, 'en').messages.hello, 'Hello');
    store.saveProject(project);
    assert.equal(store.exportCatalog(project.id, 'de').messages.hello, 'Hallo');
  } finally {
    store.close();
  }
});

function fixture() {
  let time = 1000;
  const store = new SqliteStore(':memory:', () => time);
  store.saveProject(
    projectSchema.parse({
      id: 'test',
      name: 'Test',
      targetLocales: ['de', 'ar', 'zh-Hant-TW'],
      budgetUsd: 1,
    }),
  );
  store.importSources('test', [unitSchema.parse({ id: 'save', source: 'Save settings' })]);
  const enqueue = (key = 'first') => store.enqueue('test', ['save'], ['de'], key)[0]!;
  return {
    store,
    enqueue,
    advance: (ms: number) => {
      time += ms;
    },
  };
}
test('duplicate requests and identical sources do not create extra translation spend', () => {
  const { store, enqueue } = fixture();
  try {
    const first = enqueue();
    assert.equal(enqueue().id, first.id);
    assert.equal(enqueue('another').id, first.id);
    assert.equal(store.listJobs('test').records.length, 1);
    assert.deepEqual(
      store.importSources('test', [unitSchema.parse({ id: 'save', source: 'Save settings' })]),
      { changed: [], unchanged: ['save'] },
    );
    store.importSources('test', [unitSchema.parse({ id: 'save', source: 'Save preferences' })]);
    assert.throws(
      () => enqueue(),
      (x: unknown) => x instanceof ContractError && x.code === 'idempotency_conflict',
    );
  } finally {
    store.close();
  }
});
test('approvals bind exact source and candidate revisions while old publications survive updates', () => {
  const { store, enqueue } = fixture();
  try {
    const job = enqueue(),
      claimed = store.claim(() => 0.1)!;
    store.charge(job.id, claimed.leaseToken, 0.03);
    store.complete(job.id, claimed.leaseToken, 'Einstellungen speichern', [], 'No issues');
    assert.deepEqual(store.exportCatalog('test', 'de').messages, {});
    assert.throws(() => store.approve('test', job.id, 0, 'owner'));
    store.approve('test', job.id, 1, 'owner');
    assert.equal(store.exportCatalog('test', 'de').messages.save, 'Einstellungen speichern');
    store.importSources('test', [unitSchema.parse({ id: 'save', source: 'Save preferences' })]);
    assert.equal(store.getJob('test', job.id).status, 'stale');
    assert.equal(store.exportCatalog('test', 'de').messages.save, 'Einstellungen speichern');
    assert.throws(() => store.exportCatalog('test', 'de', true));
    store.withdraw('test', ['save'], 'owner');
    assert.deepEqual(store.exportCatalog('test', 'de').messages, {});
  } finally {
    store.close();
  }
});
test('critical structure is never bypassed by an owner override', () => {
  const { store } = fixture();
  try {
    store.importSources('test', [unitSchema.parse({ id: 'pay', source: 'Pay 25 USD' })]);
    const job = store.enqueue('test', ['pay'], ['de'], 'payment')[0]!,
      claim = store.claim(() => 0)!;
    store.complete(job.id, claim.leaseToken, 'Bezahlen 30 USD', [], '');
    assert.throws(() => store.approve('test', job.id, 1, 'owner', 'Accept anyway'));
    assert.deepEqual(store.exportCatalog('test', 'de').messages, {});
  } finally {
    store.close();
  }
});
test('budget reservations are atomic and expired leases cannot publish', () => {
  const { store, enqueue, advance } = fixture();
  try {
    const first = enqueue(),
      claim = store.claim(() => 0.7)!;
    store.importSources('test', [unitSchema.parse({ id: 'second', source: 'Continue' })]);
    const second = store.enqueue('test', ['second'], ['de'], 'second')[0]!;
    assert.equal(
      store.claim(() => 0.7),
      null,
    );
    assert.equal(store.getJob('test', second.id).status, 'failed');
    advance(160000);
    const recovery = store.claim(() => 0.1)!;
    assert.notEqual(recovery.leaseToken, claim.leaseToken);
    assert.throws(() => store.complete(first.id, claim.leaseToken, 'Speichern', [], ''));
    assert.ok(store.listProjects()[0]!.spentUsd >= 0.7);
  } finally {
    store.close();
  }
});
test('manual corrections survive identical imports and approval races reject stale revisions', () => {
  const { store, enqueue } = fixture();
  try {
    const first = enqueue(),
      claim = store.claim(() => 0)!;
    store.complete(first.id, claim.leaseToken, 'Speichern', [], '');
    store.edit('test', first.id, 1, 'Einstellungen speichern', 'owner');
    assert.equal(enqueue('same-content').translation, 'Einstellungen speichern');
    assert.throws(() => store.approve('test', first.id, 1, 'owner'));
    const review = store.claim(() => 0)!;
    store.complete(
      first.id,
      review.leaseToken,
      'Einstellungen speichern',
      [],
      'Corrections reviewed',
    );
    store.approve('test', first.id, 3, 'owner');
    assert.equal(store.exportCatalog('test', 'de').messages.save, 'Einstellungen speichern');
  } finally {
    store.close();
  }
});
test('batch approvals roll back entirely if any revision is invalid', () => {
  const { store, enqueue } = fixture();
  try {
    const first = enqueue(),
      claim = store.claim(() => 0)!;
    store.complete(first.id, claim.leaseToken, 'Speichern', [], '');
    assert.throws(() =>
      store.approveBatch(
        'test',
        [
          { id: first.id, revision: 1 },
          { id: 'missing', revision: 1 },
        ],
        'owner',
      ),
    );
    assert.equal(store.getJob('test', first.id).status, 'review');
    assert.deepEqual(store.exportCatalog('test', 'de').messages, {});
  } finally {
    store.close();
  }
});
test('project tokens are scoped, expire, and revoke immediately', () => {
  const { store, advance } = fixture();
  try {
    const token = store.mintToken('test', ['read', 'export'], 2000);
    assert.deepEqual(store.authenticate(token.token)?.scopes, ['read', 'export']);
    store.revokeToken('test', token.id, 'owner');
    assert.equal(store.authenticate(token.token), null);
    const second = store.mintToken('test', ['read'], 2000);
    advance(1001);
    assert.equal(store.authenticate(second.token), null);
  } finally {
    store.close();
  }
});
test('approved artifact rollback cannot resurrect withdrawn source content', () => {
  const { store, enqueue } = fixture();
  try {
    const first = enqueue(),
      claim = store.claim(() => 0)!;
    store.complete(first.id, claim.leaseToken, 'Speichern', [], '');
    store.approve('test', first.id, 1, 'owner');
    const artifact = store.snapshot('test', 'de');
    store.withdraw('test', ['save'], 'owner');
    store.rollback('test', 'de', artifact.revision, 'owner');
    assert.deepEqual(store.exportCatalog('test', 'de').messages, {});
  } finally {
    store.close();
  }
});
