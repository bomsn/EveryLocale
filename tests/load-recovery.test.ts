import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { SqliteStore } from '../packages/store/dist/index.js';
import { createApp } from '../packages/server/dist/app.js';
import { projectSchema, unitSchema } from '../packages/core/dist/index.js';

function processResult(code: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code]);
    let output = '';
    let errors = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (errors += chunk));
    child.on('error', reject);
    child.on('exit', (status) =>
      status === 0 ? resolve(output) : reject(new Error(errors || `Child exited ${status}`)),
    );
  });
}
test('2,000 durable jobs survive four competing processes without duplicate claims or budget overspend', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'everylocale-load-'));
  const database = join(directory, 'load.sqlite');
  const store = new SqliteStore(database);
  const start = performance.now();
  try {
    store.saveProject(
      projectSchema.parse({
        id: 'load',
        name: 'Load',
        targetLocales: ['ar', 'zh-Hant-TW', 'de', 'es', 'fr'],
        budgetUsd: 1,
      }),
    );
    const units = Array.from({ length: 400 }, (_, index) =>
      unitSchema.parse({ id: `message-${index}`, source: `Project ${index} is ready.` }),
    );
    store.importSources('load', units);
    const jobs = store.enqueue(
      'load',
      units.map((unit) => unit.id),
      ['ar', 'zh-Hant-TW', 'de', 'es', 'fr'],
      'initial',
    );
    assert.equal(jobs.length, 2000);
    assert.deepEqual(
      store
        .enqueue(
          'load',
          units.map((unit) => unit.id),
          ['ar', 'zh-Hant-TW', 'de', 'es', 'fr'],
          'initial',
        )
        .map((job) => job.id),
      jobs.map((job) => job.id),
    );
    const module = new URL('../packages/store/dist/index.js', import.meta.url).href;
    // The first 33 requests fit; the remainder individually exceed the project's entire budget.
    const code = `import {SqliteStore} from ${JSON.stringify(module)};const store=new SqliteStore(${JSON.stringify(database)});const ids=[];for(let poll=0;poll<60;poll++){const job=store.claim((project,unit,locale)=>Number(unit.id.slice(8))*5+project.targetLocales.indexOf(locale)<33?0.03:2);if(job)ids.push(job.record.id);}store.close();console.log(JSON.stringify(ids));`;
    const claims = (
      await Promise.all(Array.from({ length: 4 }, () => processResult(code)))
    ).flatMap((value) => JSON.parse(value) as string[]);
    assert.equal(claims.length, 33);
    assert.equal(new Set(claims).size, 33);
    const project = store.listProjects()[0]!;
    assert.ok(project.reservedUsd <= 1);
    assert.ok(Math.abs(project.reservedUsd - 0.99) < 1e-9);
    assert.equal(project.spentUsd, 0);
    assert.equal(store.operations().projects[0]!.running, 33);
    assert.equal(store.operations().projects[0]!.failed, 1967);
    assert.equal(store.db.pragma('quick_check', { simple: true }), 'ok');
    console.log(
      `Load evidence: 2,000 jobs and four processes settled in ${Math.round(performance.now() - start)} ms`,
    );
  } finally {
    store.close();
    assert.ok(directory.startsWith(join(tmpdir(), 'everylocale-load-')));
    await rm(directory, { recursive: true, force: true });
  }
});

test('parallel HTTP requests retain project scope, locale ownership and private cache policy', async () => {
  const store = new SqliteStore(':memory:');
  for (const projectId of ['alpha', 'beta']) {
    store.saveProject(
      projectSchema.parse({
        id: projectId,
        name: projectId,
        targetLocales: ['ar', 'de'],
        budgetUsd: 1,
        approvalMode: 'automatic',
      }),
    );
    store.importSources(projectId, [
      unitSchema.parse({ id: 'welcome', source: `Welcome ${projectId}` }),
    ]);
    store.enqueue(projectId, ['welcome'], ['ar', 'de'], 'initial');
  }
  for (;;) {
    const job = store.claim(() => 0);
    if (!job) break;
    store.complete(
      job.record.id,
      job.leaseToken,
      `${job.record.projectId} ${job.record.locale}`,
      [],
      'Transport fixture',
    );
  }
  const app = await createApp(store, {
    adminToken: 'independent-disposable-load-owner-token',
    sessionSecret: 'independent-disposable-load-session-secret',
    publicOrigin: 'http://localhost:4310',
    secureCookie: false,
    providersReady: false,
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address() as { port: number };
  const tokens = Object.fromEntries(
    ['alpha', 'beta'].map((id) => [
      id,
      store.mintToken(id, ['read', 'export'], Date.now() + 60000).token,
    ]),
  );
  try {
    await Promise.all(
      Array.from({ length: 160 }, async (_, index) => {
        const id = index % 2 ? 'alpha' : 'beta',
          locale = index % 3 ? 'ar' : 'de';
        const headers = { authorization: `Bearer ${tokens[id]}` };
        const response = await fetch(
          `http://127.0.0.1:${address.port}/api/v1/projects/${id}/exports/${locale}`,
          { headers },
        );
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const catalog = (await response.json()) as {
          locale: string;
          messages: Record<string, string>;
        };
        assert.equal(catalog.locale, locale);
        assert.equal(catalog.messages.welcome, `${id} ${locale}`);
        const denied = await fetch(`http://127.0.0.1:${address.port}/api/v1/operations`, {
          headers,
        });
        assert.equal(denied.status, 403);
      }),
    );
  } finally {
    await app.close();
    store.close();
  }
});
