import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { SqliteStore } from '../packages/store/dist/index.js';
import { projectSchema, unitSchema } from '../packages/core/dist/index.js';
import { DeliveryWorker, verifyDelivery } from '../packages/server/dist/delivery.js';
import { createApp } from '../packages/server/dist/app.js';

function prepared(path = ':memory:', now?: () => number) {
  const store = new SqliteStore(path, now);
  store.saveProject(
    projectSchema.parse({
      id: 'example',
      name: 'Example',
      targetLocales: ['de'],
      budgetUsd: 1,
      approvalMode: 'automatic',
    }),
  );
  store.importSources('example', [unitSchema.parse({ id: 'welcome', source: 'Welcome' })]);
  store.enqueue('example', ['welcome'], ['de'], 'initial');
  const job = store.claim(() => 0.01)!;
  store.charge(job.record.id, job.leaseToken, 0.001);
  store.complete(job.record.id, job.leaseToken, 'Willkommen', [], 'Example review');
  return store;
}

test('unavailable providers and aged queues produce durable, bounded exception notifications', async () => {
  let now = Date.now();
  const directory = await mkdtemp(join(tmpdir(), 'everylocale-health-'));
  const path = join(directory, 'live.sqlite');
  let store = prepared(path, () => now);
  try {
    store.importSources('example', [unitSchema.parse({ id: 'help', source: 'Help' })]);
    store.enqueue('example', ['help'], ['de'], 'waiting');
    store.checkHealth(false);
    assert.equal(
      store.deliveryEvents().filter((e) => e.type === 'alert.provider_unavailable').length,
      1,
    );
    now += 900000;
    store.checkHealth(false);
    assert.equal(store.deliveryEvents().filter((e) => e.type === 'alert.queue_stalled').length, 1);
    store.close();
    store = new SqliteStore(path, () => now);
    store.checkHealth(false);
    assert.equal(store.deliveryEvents().filter((e) => e.type.startsWith('alert.')).length, 2);
    now += 3600000;
    store.checkHealth(true);
    assert.equal(
      store.deliveryEvents().filter((e) => e.type === 'alert.provider_unavailable').length,
      1,
    );
    assert.equal(store.deliveryEvents().filter((e) => e.type === 'alert.queue_stalled').length, 2);
    const job = store.claim(() => 0)!;
    store.complete(job.record.id, job.leaseToken, 'Hilfe', [], 'Reviewed');
    now += 3600000;
    store.checkHealth(false);
    assert.equal(store.deliveryEvents().filter((e) => e.type.startsWith('alert.')).length, 3);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test('online SQLite backup restores exact approvals, spending, tokens and durable publication events', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'everylocale-backup-'));
  assert.ok(directory.startsWith(join(tmpdir(), 'everylocale-backup-')));
  const store = prepared(join(directory, 'live.sqlite'));
  const token = store.mintToken('example', ['read', 'export'], Date.now() + 60000).token;
  const catalog = store.snapshot('example', 'de');
  try {
    await store.backup(join(directory, 'backup.sqlite'));
    await assert.rejects(store.backup(join(directory, 'backup.sqlite')), /already exists/);
    const restored = new SqliteStore(join(directory, 'backup.sqlite'));
    try {
      assert.equal(restored.db.pragma('quick_check', { simple: true }), 'ok');
      assert.deepEqual(restored.exportCatalog('example', 'de'), catalog);
      assert.equal(restored.listProjects()[0]!.spentUsd, 0.001);
      assert.equal(restored.authenticate(token)?.projectId, 'example');
      assert.equal(restored.deliveryEvents()[0]!.type, 'publication.changed');
      assert.equal(restored.artifacts('example')[0]!.id, catalog.revision);
    } finally {
      restored.close();
    }
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test('delivery survives restarts, obeys leases and retries, verifies signatures and preserves stable event IDs', async () => {
  let now = Date.now();
  const store = prepared(':memory:', () => now);
  const secret = 'independent-disposable-webhook-secret';
  const bodies: string[] = [];
  let calls = 0;
  const receiver = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    assert.equal(
      verifyDelivery(
        body,
        String(request.headers['x-everylocale-timestamp']),
        String(request.headers['x-everylocale-signature']),
        secret,
      ),
      true,
    );
    bodies.push(body);
    calls++;
    response.writeHead(calls === 1 ? 503 : 204);
    response.end();
  });
  await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  const config = {
    url: `http://127.0.0.1:${(receiver.address() as { port: number }).port}`,
    secret,
  };
  try {
    const worker = new DeliveryWorker(store, config);
    await worker.deliverOnce();
    assert.equal(store.deliveryEvents()[0]!.status, 'pending');
    now += 5000;
    await new DeliveryWorker(store, config).deliverOnce();
    assert.equal(store.deliveryEvents()[0]!.status, 'delivered');
    assert.equal(JSON.parse(bodies[0]!).id, JSON.parse(bodies[1]!).id);
    assert.equal(
      verifyDelivery(bodies[1]!, String(Date.now() - 600000), 'f'.repeat(64), secret),
      false,
    );
    assert.equal(
      verifyDelivery(bodies[1]! + 'x', String(Date.now()), 'f'.repeat(64), secret),
      false,
    );
    store.importSources('example', [unitSchema.parse({ id: 'second', source: 'Help' })]);
    store.enqueue('example', ['second'], ['de'], 'second');
    const job = store.claim(() => 0)!;
    store.fail(job.record.id, job.leaseToken, 'provider unavailable');
    const first = store.claimDelivery()!;
    assert.equal(store.claimDelivery(), null);
    now += 31000;
    const recovered = store.claimDelivery()!;
    assert.equal(recovered.event.id, first.event.id);
    assert.throws(() => store.settleDelivery(first.event.id, first.leaseToken), /no longer active/);
    store.settleDelivery(recovered.event.id, recovered.leaseToken);
    assert.equal(store.operations().projects[0]!.failed, 1);
  } finally {
    store.close();
    await new Promise<void>((resolve) => receiver.close(() => resolve()));
  }
});
test('operations never leak other projects to scoped accounts', async () => {
  const store = prepared();
  const app = await createApp(store, {
    adminToken: 'disposable-independent-owner-token',
    sessionSecret: 'disposable-independent-session-secret',
    publicOrigin: 'http://localhost:4310',
    secureCookie: false,
    providersReady: false,
  });
  const token = store.mintToken('example', ['read'], Date.now() + 60000).token;
  try {
    assert.equal(
      (
        await app.inject({
          url: '/api/v1/operations',
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
      403,
    );
    const response = await app.inject({
      url: '/api/v1/operations',
      headers: { authorization: 'Bearer disposable-independent-owner-token' },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().projects[0].id, 'example');
  } finally {
    await app.close();
    store.close();
  }
});
