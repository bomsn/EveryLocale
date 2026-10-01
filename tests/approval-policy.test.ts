import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { SqliteStore } from '../packages/store/src/index.js';
import { projectSchema, unitSchema, type Finding } from '../packages/core/dist/index.js';
import { createApp } from '../packages/server/src/app.js';
import { TranslationWorker } from '../packages/server/src/worker.js';

function fixture(mode: 'automatic' | 'human' = 'automatic') {
  const store = new SqliteStore(':memory:');
  const project = projectSchema.parse({
    id: 'policy',
    name: 'Policy',
    targetLocales: ['de'],
    budgetUsd: 1,
    approvalMode: mode,
  });
  store.saveProject(project);
  store.importSources(project.id, [
    unitSchema.parse({ id: 'hello', source: 'Hello {name}', kind: 'icu' }),
  ]);
  const enqueue = (key: string) => store.enqueue(project.id, ['hello'], ['de'], key)[0]!;
  const complete = (id: string, translation = 'Hallo {name}', findings: Finding[] = []) => {
    const job = store.claim(() => 0)!;
    assert.equal(job.record.id, id);
    store.complete(id, job.leaseToken, translation, findings, 'Independent review completed.');
  };
  return { store, project, enqueue, complete };
}

test('automatic approval publishes exact clean revisions and records the automated actor', () => {
  const { store, enqueue, complete } = fixture();
  try {
    const job = enqueue('initial');
    complete(job.id, 'Hallo {name}', [
      { severity: 'minor', code: 'style', message: 'An alternative greeting is possible.' },
    ]);
    const approved = store.getJob('policy', job.id);
    assert.equal(approved.status, 'approved');
    assert.equal(approved.approvalRevision, approved.revision);
    assert.equal(store.exportCatalog('policy', 'de', true).messages.hello, 'Hallo {name}');
    const audit = store.auditLog('policy').find((event) => event.action === 'translation.approve')!;
    assert.equal(audit.actor, 'automation');
    assert.equal(JSON.parse(audit.detail).mode, 'automatic');
    assert.equal(JSON.parse(audit.detail).sourceHash, approved.sourceHash);
    assert.equal(enqueue('replay').revision, approved.revision);
  } finally {
    store.close();
  }
});

test('automatic approval never accepts broken structure or material AI findings', () => {
  for (const [translation, findings] of [
    ['Hallo', []],
    [
      'Hallo {name}',
      [{ severity: 'major', code: 'meaning', message: 'Meaning needs correction.' }],
    ],
    [
      'Hallo {name}',
      [{ severity: 'critical', code: 'omission', message: 'Important information is missing.' }],
    ],
  ] as Array<[string, Finding[]]>) {
    const { store, enqueue, complete } = fixture();
    try {
      const job = enqueue('initial');
      complete(job.id, translation, findings);
      assert.equal(store.getJob('policy', job.id).status, 'review');
      assert.equal(store.getJob('policy', job.id).approvalRevision, null);
      assert.deepEqual(store.exportCatalog('policy', 'de').messages, {});
      assert.equal(
        store.auditLog('policy').filter((event) => event.action === 'translation.approve').length,
        0,
      );
    } finally {
      store.close();
    }
  }
});

test('automatic corrections keep the publication until independent review and stop at changed source revisions', () => {
  const { store, enqueue, complete } = fixture();
  try {
    const job = enqueue('initial');
    complete(job.id);
    store.edit('policy', job.id, 1, 'Guten Tag {name}', 'owner');
    assert.equal(store.getJob('policy', job.id).status, 'pending');
    assert.equal(store.exportCatalog('policy', 'de').messages.hello, 'Hallo {name}');
    complete(job.id, 'Guten Tag {name}');
    assert.equal(store.getJob('policy', job.id).approvalRevision, 3);
    assert.equal(store.exportCatalog('policy', 'de', true).messages.hello, 'Guten Tag {name}');
    store.importSources('policy', [
      unitSchema.parse({ id: 'hello', source: 'Welcome {name}', kind: 'icu' }),
    ]);
    const next = enqueue('changed'),
      claim = store.claim(() => 0)!;
    store.importSources('policy', [
      unitSchema.parse({ id: 'hello', source: 'Goodbye {name}', kind: 'icu' }),
    ]);
    assert.throws(() => store.complete(next.id, claim.leaseToken, 'Willkommen {name}', [], ''));
    assert.equal(store.exportCatalog('policy', 'de').messages.hello, 'Guten Tag {name}');
  } finally {
    store.close();
  }
});

test('approval policy changes preserve the queue, apply at completion, and protect legacy human projects', () => {
  const { store, project, enqueue, complete } = fixture('human');
  try {
    const first = enqueue('initial');
    complete(first.id);
    assert.equal(store.getJob('policy', first.id).status, 'review');
    store.saveProject({ ...project, approvalMode: 'automatic' });
    assert.equal(store.getJob('policy', first.id).status, 'review');
    assert.deepEqual(store.exportCatalog('policy', 'de').messages, {});
    store.importSources('policy', [
      unitSchema.parse({ id: 'hello', source: 'Welcome {name}', kind: 'icu' }),
    ]);
    const next = enqueue('changed');
    store.saveProject(project);
    complete(next.id, 'Willkommen {name}');
    assert.equal(store.getJob('policy', next.id).status, 'review');
    const legacy = { ...project } as Partial<typeof project>;
    delete legacy.approvalMode;
    store.db
      .prepare('UPDATE projects SET config=? WHERE id=?')
      .run(JSON.stringify(legacy), project.id);
    assert.equal(store.getProject(project.id).approvalMode, 'human');
    assert.equal(store.listProjects()[0]!.approvalMode, 'human');
  } finally {
    store.close();
  }
});

test('translation memory and restored source corrections receive a fresh automatic approval', () => {
  const { store, enqueue, complete } = fixture();
  try {
    const first = enqueue('initial');
    complete(first.id);
    store.importSources('policy', [
      unitSchema.parse({ id: 'another', source: 'Hello {name}', kind: 'icu' }),
    ]);
    const reused = store.enqueue('policy', ['another'], ['de'], 'memory')[0]!;
    assert.equal(reused.status, 'approved');
    assert.equal(reused.translation, 'Hallo {name}');
    store.importSources('policy', [
      unitSchema.parse({ id: 'hello', source: 'Welcome {name}', kind: 'icu' }),
    ]);
    store.importSources('policy', [
      unitSchema.parse({ id: 'hello', source: 'Hello {name}', kind: 'icu' }),
    ]);
    const restored = enqueue('restored');
    assert.equal(restored.id, first.id);
    assert.equal(restored.status, 'approved');
    assert.equal(restored.approvalRevision, 2);
    store.withdraw('policy', ['hello', 'another'], 'owner');
    assert.deepEqual(store.exportCatalog('policy', 'de').messages, {});
  } finally {
    store.close();
  }
});

test('real HTTP worker automatically approves and exports without a human approval endpoint', async () => {
  const calls: string[] = [];
  const provider = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    calls.push(payload.model);
    const value =
      payload.model === 'reviewer'
        ? { findings: [], summary: 'No material issues.' }
        : { translation: 'Hallo {name}' };
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(value) } }],
        usage: { prompt_tokens: 20, completion_tokens: 10 },
      }),
    );
  });
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const { store, enqueue } = fixture();
  const adminToken = 'automatic-approval-local-fixture-owner-token';
  const app = await createApp(store, {
    adminToken,
    sessionSecret: 'automatic-approval-independent-session-secret',
    publicOrigin: 'http://localhost:4310',
    secureCookie: false,
    providersReady: true,
  });
  const base = {
    baseUrl: `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`,
    inputPrice: 1,
    outputPrice: 1,
  };
  const worker = new TranslationWorker(store, {
    generator: { ...base, model: 'generator' },
    reviewer: { ...base, model: 'reviewer' },
    concurrency: 1,
    intervalMs: 0,
  });
  try {
    const job = enqueue('worker');
    worker.start();
    const deadline = Date.now() + 10000;
    while (store.getJob('policy', job.id).status !== 'approved') {
      if (Date.now() > deadline) throw new Error('Automatic worker approval timed out');
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    const exported = await app.inject({
      url: '/api/v1/projects/policy/exports/de?current=true',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(exported.statusCode, 200);
    assert.equal(exported.json().messages.hello, 'Hallo {name}');
    assert.deepEqual(calls, ['generator', 'reviewer']);
    const token = store.mintToken('policy', ['read', 'translate', 'export'], Date.now() + 60000);
    const changedPolicy = await app.inject({
      method: 'PUT',
      url: '/api/v1/projects/policy',
      headers: { authorization: `Bearer ${token.token}` },
      payload: { name: 'Policy', targetLocales: ['de'], budgetUsd: 1, approvalMode: 'automatic' },
    });
    assert.equal(changedPolicy.statusCode, 403);
  } finally {
    await worker.stop();
    await app.close();
    store.close();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
});
