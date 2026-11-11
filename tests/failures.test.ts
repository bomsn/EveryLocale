import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { SqliteStore } from '../packages/store/dist/index.js';
import { TranslationWorker } from '../packages/server/dist/worker.js';
import { BackupScheduler } from '../packages/server/dist/backups.js';
import { projectSchema, unitSchema, FAILURES } from '../packages/core/dist/index.js';
import { recordingLog } from './support/log.ts';

async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 15000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('State did not settle');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
async function provider(
  status: number,
): Promise<{ server: Server; baseUrl: string; calls: () => number }> {
  let calls = 0;
  const server = createServer((request, response) => {
    calls++;
    request.resume();
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'Incorrect API key provided' } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    server,
    baseUrl: `http://127.0.0.1:${String((server.address() as { port: number }).port)}/v1`,
    calls: () => calls,
  };
}
function seeded(units = 3) {
  const store = new SqliteStore(':memory:');
  store.saveProject(
    projectSchema.parse({ id: 'site', name: 'Site', targetLocales: ['de'], budgetUsd: 1 }),
  );
  const ids = Array.from({ length: units }, (_, index) => `common:item${String(index)}`);
  store.importSources(
    'site',
    ids.map((id) => unitSchema.parse({ id, source: 'Save' })),
  );
  store.enqueue('site', ids, ['de'], 'seed');
  return store;
}

test('a rejected provider key pauses the worker once and leaves every queued job intact', async () => {
  const endpoint = await provider(401);
  const store = seeded(3);
  const log = recordingLog();
  const config = { baseUrl: endpoint.baseUrl, model: 'm', inputPrice: 1, outputPrice: 1 };
  const worker = new TranslationWorker(
    store,
    { generator: config, reviewer: config, concurrency: 1, intervalMs: 0 },
    log,
  );
  try {
    worker.start();
    await waitFor(() => !worker.available());
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(endpoint.calls(), 1, 'one rejected request is enough to stop sending');
    assert.equal(worker.status().paused?.failure, 'provider_configuration');
    const jobs = store.listJobs('site').records;
    assert.deepEqual(
      jobs.map((job) => job.status),
      ['pending', 'pending', 'pending'],
      'nothing is failed by a configuration problem',
    );
    assert.equal(jobs.find((job) => job.failure)?.failure, 'provider_configuration');
    assert.equal(jobs.find((job) => job.failure)?.attempts, 0, 'the attempt is given back');
    assert.equal(log.entries.filter((entry) => entry.fields.event === 'provider_paused').length, 1);
    store.checkHealth(worker.available());
    assert.equal(
      store.deliveryEvents().filter((event) => event.type === 'alert.provider_unavailable').length,
      1,
    );
    worker.resume();
    assert.equal(worker.available(), true);
  } finally {
    await worker.stop();
    store.close();
    await new Promise<void>((resolve) => endpoint.server.close(() => resolve()));
  }
});

test('failures are reported as one alert per project and cause, with a count and the action', () => {
  let now = 1_000_000;
  const store = new SqliteStore(':memory:', () => now);
  store.saveProject(
    projectSchema.parse({ id: 'site', name: 'Site', targetLocales: ['de'], budgetUsd: 1 }),
  );
  const ids = Array.from({ length: 25 }, (_, index) => `common:item${String(index)}`);
  store.importSources(
    'site',
    ids.map((id) => unitSchema.parse({ id, source: 'Save' })),
  );
  store.enqueue('site', ids, ['de'], 'seed');
  try {
    for (let index = 0; index < ids.length; index++) {
      const claim = store.claim(() => 0);
      assert.ok(claim);
      store.fail(claim.record.id, claim.leaseToken, 'model_output_invalid', 'Bad JSON');
    }
    store.checkHealth(true);
    store.checkHealth(true);
    const alerts = store
      .deliveryEvents()
      .filter((event) => event.type === 'alert.translation_failed');
    assert.equal(alerts.length, 1, 'one event for 25 failures');
    assert.deepEqual(
      { ...alerts[0]?.detail, examples: (alerts[0]?.detail.examples as string[]).length },
      {
        failure: 'model_output_invalid',
        count: 25,
        examples: 5,
        action: FAILURES.model_output_invalid.action,
      },
    );
    now += 3600001;
    store.checkHealth(true);
    assert.equal(
      store.deliveryEvents().filter((event) => event.type === 'alert.translation_failed').length,
      1,
      'no new failures, no new alert',
    );
  } finally {
    store.close();
  }
});

test('scheduled backups are verified, pruned to the retention count, and failures raise an alert', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'everylocale-backups-'));
  const store = seeded(1);
  const log = recordingLog();
  let now = Date.UTC(2026, 10, 11);
  const scheduler = new BackupScheduler(
    store,
    { directory, intervalMs: 3600000, keep: 2 },
    log,
    () => now,
  );
  try {
    for (let day = 0; day < 3; day++) {
      assert.ok(await scheduler.backupOnce());
      now += 86400000;
    }
    assert.deepEqual((await readdir(directory)).sort(), [
      'everylocale-2026-11-12T00-00-00-000Z.sqlite',
      'everylocale-2026-11-13T00-00-00-000Z.sqlite',
    ]);
    // A destination that already exists cannot be overwritten, so this backup fails loudly.
    now -= 86400000;
    assert.equal(await scheduler.backupOnce(), null);
    assert.equal(log.entries[0]?.fields.event, 'backup_failed');
    assert.equal(store.deliveryEvents()[0]?.type, 'alert.backup_failed');
  } finally {
    await scheduler.stop();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('maintenance check verifies a snapshot without changing a single byte', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'everylocale-check-'));
  try {
    const live = join(directory, 'live.sqlite');
    const store = seeded(1);
    await store.backup(live);
    store.close();
    const digest = async () =>
      createHash('sha256')
        .update(await readFile(live))
        .digest('hex');
    const before = await digest();
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['packages/server/dist/maintenance.js', 'check', '--database', live],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let text = '';
      child.stdout.on('data', (chunk: Buffer) => (text += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (text += chunk.toString()));
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) resolve(text);
        else reject(new Error(text));
      });
    });
    assert.match(output, /integrity checks passed/);
    assert.equal(await digest(), before);
    assert.deepEqual((await readdir(directory)).sort(), ['live.sqlite'], 'no journal files appear');
    await writeFile(live, 'not a database');
    await assert.rejects(
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [
          'packages/server/dist/maintenance.js',
          'check',
          '--database',
          live,
        ]);
        child.on('exit', (code) => (code === 1 ? reject(new Error('failed')) : resolve(code)));
      }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
