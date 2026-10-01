import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { SqliteStore } from '../packages/store/dist/index.js';
import { TranslationWorker } from '../packages/server/dist/worker.js';
import { projectSchema, unitSchema } from '../packages/core/dist/index.js';

async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 18000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Worker state did not settle');
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

test('real provider throttling retries safely, preserves charges, and leaves publication awaiting approval', async () => {
  let calls = 0;
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    calls++;
    if (calls === 1) {
      response.writeHead(429, { 'retry-after': '0' });
      response.end();
      return;
    }
    const payload = JSON.parse(body);
    const value =
      payload.model === 'reviewer'
        ? { findings: [], summary: 'Transport fixture review' }
        : { translation: 'Hallo' };
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(value) } }],
        usage: { prompt_tokens: 40, completion_tokens: 10 },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const provider = {
    baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
    inputPrice: 1,
    outputPrice: 1,
  };
  const store = new SqliteStore(':memory:');
  store.saveProject(
    projectSchema.parse({ id: 'retry', name: 'Retry', targetLocales: ['de'], budgetUsd: 1 }),
  );
  store.importSources('retry', [unitSchema.parse({ id: 'hello', source: 'Hello' })]);
  const job = store.enqueue('retry', ['hello'], ['de'], 'retry')[0]!;
  const worker = new TranslationWorker(store, {
    generator: { ...provider, model: 'generator' },
    reviewer: { ...provider, model: 'reviewer' },
    concurrency: 2,
    intervalMs: 0,
  });
  try {
    worker.start();
    await waitFor(() => store.getJob('retry', job.id).status === 'review');
    assert.equal(calls, 3);
    assert.equal(store.getJob('retry', job.id).attempts, 2);
    assert.equal(store.listProjects()[0]!.spentUsd, 0.0001);
    assert.equal(store.listProjects()[0]!.reservedUsd, 0);
    assert.deepEqual(store.exportCatalog('retry', 'de').messages, {});
  } finally {
    await worker.stop();
    store.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('malformed model JSON is charged once and exhausted budgets prevent provider calls', async () => {
  let calls = 0;
  const server = createServer((request, response) => {
    calls++;
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        choices: [{ message: { content: 'invalid JSON' } }],
        usage: { prompt_tokens: 40, completion_tokens: 10 },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const provider = {
    baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
    model: 'generator',
    inputPrice: 1,
    outputPrice: 1,
  };
  const store = new SqliteStore(':memory:');
  for (const [id, budgetUsd] of [
    ['broken', 1],
    ['empty', 0],
  ] as const) {
    store.saveProject(projectSchema.parse({ id, name: id, targetLocales: ['de'], budgetUsd }));
    store.importSources(id, [unitSchema.parse({ id: 'hello', source: 'Hello' })]);
    store.enqueue(id, ['hello'], ['de'], id);
  }
  const worker = new TranslationWorker(store, {
    generator: provider,
    reviewer: provider,
    concurrency: 2,
    intervalMs: 0,
  });
  try {
    worker.start();
    await waitFor(() =>
      ['broken', 'empty'].every((id) => store.listJobs(id).records[0]?.status === 'failed'),
    );
    assert.equal(calls, 1);
    assert.equal(
      store.listProjects().find((project) => project.id === 'broken')!.spentUsd,
      0.00005,
    );
    assert.match(store.listJobs('broken').records[0]!.error!, /invalid JSON/);
    assert.match(store.listJobs('empty').records[0]!.error!, /budget exhausted/);
    assert.equal(
      store.listProjects().reduce((sum, project) => sum + project.reservedUsd, 0),
      0,
    );
  } finally {
    await worker.stop();
    store.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
