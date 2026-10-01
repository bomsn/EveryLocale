import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteStore } from '../packages/store/src/index.js';
import {
  projectSchema,
  unitSchema,
  previewArguments,
  previewMessage,
} from '../packages/core/dist/index.js';
import { createApp } from '../packages/server/src/app.js';

test('coverage and filtered pagination include current sources beyond the first page and exclude stale approvals', () => {
  const store = new SqliteStore(':memory:');
  const project = projectSchema.parse({
    id: 'coverage',
    name: 'Coverage',
    targetLocales: ['de', 'ar'],
    budgetUsd: 1,
  });
  try {
    store.saveProject(project);
    const units = Array.from({ length: 205 }, (_, index) =>
      unitSchema.parse({
        id: 'message-' + index,
        source: index === 204 ? 'Last searchable message' : 'Message ' + index,
      }),
    );
    store.importSources(project.id, units);
    store.enqueue(
      project.id,
      units.map((unit) => unit.id),
      ['de'],
      'all',
    );
    for (;;) {
      const job = store.claim(() => 0);
      if (!job) break;
      store.complete(job.record.id, job.leaseToken, job.record.source.source, [], '');
    }
    assert.equal(store.summary(project.id).languages[0]!.review, 205);
    assert.equal(store.summary(project.id).languages[1]!.untranslated, 205);
    const last = store.listJobs(project.id, 'de', 0, 100, {
      search: 'Last searchable',
      status: 'review',
      current: true,
    });
    assert.equal(last.records.length, 1);
    assert.equal(last.records[0]!.unitId, 'message-204');
    const first = store.listJobs(project.id, 'de', 0, 200, { status: 'review', current: true });
    assert.equal(first.records.length, 200);
    assert.notEqual(first.cursor, null);
    assert.equal(
      store.listJobs(project.id, 'de', first.cursor!, 200, { status: 'review', current: true })
        .records.length,
      5,
    );
    store.approve(project.id, last.records[0]!.id, 1, 'owner');
    assert.equal(store.summary(project.id).languages[0]!.approved, 1);
    store.importSources(project.id, [{ ...units[204]!, source: 'Updated source' }]);
    assert.equal(store.summary(project.id).languages[0]!.approved, 0);
    assert.equal(store.summary(project.id).languages[0]!.untranslated, 1);
    assert.equal(
      store.exportCatalog(project.id, 'de').messages['message-204'],
      'Last searchable message',
    );
    assert.equal(
      store.listJobs(project.id, 'de', 0, 100, { status: 'approved', current: true }).records
        .length,
      0,
    );
    store.saveProject({ ...project, instructions: { de: 'Formal tone' } });
    assert.equal(store.summary(project.id).languages[0]!.untranslated, 205);
    assert.equal(store.listJobs(project.id, 'de', 0, 200, { current: true }).records.length, 0);
    store.withdraw(project.id, ['message-0'], 'owner');
    assert.equal(store.summary(project.id).sourceUnits, 204);
    store.saveProject({ ...project, targetLocales: [] });
    assert.deepEqual(store.summary(project.id).languages, []);
  } finally {
    store.close();
  }
});

test('ICU example inputs traverse nested branches and use suitable typed values', () => {
  const message =
    '{gender, select, female {{name} has {count, plural, one {# file} other {# files}}} other {{name} has files}} on {when, date, short}';
  const args = previewArguments(message);
  assert.deepEqual(
    args.map((argument) => [argument.name, argument.type]),
    [
      ['gender', 'text'],
      ['name', 'text'],
      ['count', 'number'],
      ['when', 'number'],
    ],
  );
  assert.match(
    previewMessage(
      message,
      'en',
      Object.fromEntries(args.map((argument) => [argument.name, argument.value])),
    ),
    /Ali has 3 files/,
  );
});
test('ICU rich text previews flatten declared tags without executing or dropping their contents', () => {
  const message =
    'Welcome <strong>{name}</strong>. {count, plural, one {<em># file</em>} other {<em># files</em>}}';
  const values = Object.fromEntries(
    previewArguments(message).map((argument) => [argument.name, argument.value]),
  );
  assert.equal(previewMessage(message, 'en', values), 'Welcome Ali. 3 files');
});

test('workspace summary and search keep project authorization and preview defaults server-side', async () => {
  const store = new SqliteStore(':memory:');
  store.saveProject(
    projectSchema.parse({ id: 'first', name: 'First', targetLocales: ['ar'], budgetUsd: 1 }),
  );
  store.saveProject(
    projectSchema.parse({ id: 'second', name: 'Second', targetLocales: ['ar'], budgetUsd: 1 }),
  );
  const token = store.mintToken('first', ['read'], Date.now() + 10000);
  const app = await createApp(store, {
    adminToken: 'test-admin-32-characters-or-longer',
    sessionSecret: 'test-independent-session-secret-long',
    publicOrigin: 'http://localhost:4310',
    secureCookie: false,
    providersReady: false,
  });
  const headers = { authorization: 'Bearer ' + token.token };
  try {
    assert.equal((await app.inject('/api/v1/projects/first/summary')).statusCode, 401);
    assert.equal(
      (await app.inject({ url: '/api/v1/projects/second/summary', headers })).statusCode,
      404,
    );
    assert.equal(
      (await app.inject({ url: '/api/v1/projects/first/summary', headers })).json().sourceUnits,
      0,
    );
    assert.equal(
      (await app.inject({ url: '/api/v1/projects/first/jobs?status=invalid', headers })).statusCode,
      422,
    );
    const result = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/first/preview',
      headers,
      payload: { locale: 'ar', message: 'مرحبًا، {name}' },
    });
    assert.equal(result.json().text, 'مرحبًا، Ali');
    assert.equal(result.json().arguments[0].name, 'name');
  } finally {
    await app.close();
    store.close();
  }
});
