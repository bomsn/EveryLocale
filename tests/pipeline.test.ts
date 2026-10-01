import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { SqliteStore } from '../packages/store/src/index.js';
import { createApp } from '../packages/server/src/app.js';
import { TranslationWorker } from '../packages/server/src/worker.js';
import { projectSchema, unitSchema } from '../packages/core/dist/index.js';

test('CLI extraction and approved rendering preserve a non-English source revision', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'everylocale-source-locale-'));
  const store = new SqliteStore(':memory:');
  try {
    const input = join(directory, 'source.json'),
      unitsPath = join(directory, 'units.json'),
      catalogPath = join(directory, 'de.json'),
      output = join(directory, 'rendered.json');
    await writeFile(input, JSON.stringify({ greeting: 'Bonjour {name}' }));
    await cli(
      [
        'extract',
        '--input',
        input,
        '--format',
        'json',
        '--namespace',
        'site',
        '--source-locale',
        'fr',
        '--output',
        unitsPath,
      ],
      {},
    );
    const units = JSON.parse(await readFile(unitsPath, 'utf8'));
    assert.equal(units[0].sourceLocale, 'fr');
    store.saveProject(
      projectSchema.parse({
        id: 'site',
        name: 'Site',
        sourceLocale: 'fr',
        targetLocales: ['de'],
        budgetUsd: 1,
      }),
    );
    store.importSources('site', units);
    const job = store.enqueue('site', [units[0].id], ['de'], 'first')[0]!,
      claim = store.claim(() => 0)!;
    store.complete(job.id, claim.leaseToken, 'Hallo {name}', [], '');
    store.approve('site', job.id, 1, 'owner');
    await writeFile(catalogPath, JSON.stringify(store.exportCatalog('site', 'de', true)));
    await cli(
      [
        'render',
        '--input',
        input,
        '--format',
        'json',
        '--namespace',
        'site',
        '--catalog',
        catalogPath,
        '--output',
        output,
      ],
      {},
    );
    assert.equal(JSON.parse(await readFile(output, 'utf8')).greeting, 'Hallo {name}');
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

const translations: Record<string, string> = {
  ar: 'مرحبا {name}',
  'zh-Hant-TW': '你好 {name}',
  de: 'Hallo {name}',
  es: 'Hola {name}',
  fr: 'Bonjour {name}',
};
async function until(condition: () => boolean) {
  const deadline = Date.now() + 10000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for real worker');
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}
async function cli(args: string[], environment: Record<string, string>) {
  return new Promise<string>((resolvePromise, reject) => {
    const process = spawn(
      globalThis.process.execPath,
      [resolve('packages/cli/dist/index.js'), ...args],
      { env: { ...globalThis.process.env, ...environment }, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '';
    process.stdout.on('data', (x) => (output += x));
    process.stderr.on('data', (x) => (output += x));
    process.on('error', reject);
    process.on('exit', (code) => (code === 0 ? resolvePromise(output) : reject(new Error(output))));
  });
}
test('real HTTP provider transport, durable worker, owner approval and CLI export run end to end', async () => {
  let calls = 0;
  const provider = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body),
      input = JSON.parse(payload.messages[1].content);
    calls++;
    const value =
      payload.model === 'reviewer'
        ? { findings: [], summary: 'Fixture review: no issues.' }
        : { translation: translations[input.targetLocale] };
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(value) } }],
        usage: { prompt_tokens: 100, completion_tokens: 25 },
      }),
    );
  });
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const providerPort = (provider.address() as { port: number }).port;
  const directory = await mkdtemp(join(tmpdir(), 'everylocale-e2e-'));
  const database = join(directory, 'test.sqlite'),
    store = new SqliteStore(database);
  const admin = 'e2e-owner-token-with-more-than-32-characters';
  const app = await createApp(store, {
    adminToken: admin,
    sessionSecret: 'e2e-session-independent-secret-32-characters',
    publicOrigin: 'http://localhost:4310',
    secureCookie: false,
    providersReady: true,
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const port = (app.server.address() as { port: number }).port;
  const config = { baseUrl: `http://127.0.0.1:${providerPort}/v1`, inputPrice: 1, outputPrice: 1 };
  const worker = new TranslationWorker(store, {
    generator: { ...config, model: 'generator' },
    reviewer: { ...config, model: 'reviewer' },
    concurrency: 2,
    intervalMs: 0,
  });
  try {
    const headers = { authorization: `Bearer ${admin}` };
    const project = projectSchema.parse({
      id: 'example',
      name: 'Example',
      targetLocales: Object.keys(translations),
      budgetUsd: 1,
    });
    assert.equal(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/v1/projects/example',
          headers,
          payload: project,
        })
      ).statusCode,
      200,
    );
    const units = [unitSchema.parse({ id: 'hello', source: 'Hello {name}', kind: 'icu' })];
    await writeFile(join(directory, 'units.json'), JSON.stringify(units));
    const environment = { EVERYLOCALE_TOKEN: admin, EVERYLOCALE_URL: `http://127.0.0.1:${port}` };
    await cli(
      [
        'sync',
        '--project',
        'example',
        '--input',
        join(directory, 'units.json'),
        '--locales',
        Object.keys(translations).join(','),
      ],
      environment,
    );
    worker.start();
    await until(() => store.listJobs('example').records.every((x) => x.status === 'review'));
    const jobs = store.listJobs('example').records;
    assert.equal(jobs.length, 5);
    assert.equal(calls, 10);
    const initial = await app.inject({
      url: '/api/v1/projects/example/exports/de?current=true',
      headers,
    });
    assert.equal(initial.statusCode, 422);
    for (const job of jobs) {
      assert.equal(job.translation, translations[job.locale]);
      assert.deepEqual(job.findings, []);
    }
    const approved = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/example/approve',
      headers,
      payload: { entries: jobs.map((x) => ({ id: x.id, revision: x.revision })) },
    });
    assert.equal(approved.statusCode, 200);
    const output = join(directory, 'de.approved.json');
    await cli(
      ['export', '--project', 'example', '--locale', 'de', '--output', output],
      environment,
    );
    assert.equal(JSON.parse(await readFile(output, 'utf8')).messages.hello, 'Hallo {name}');
    await cli(
      ['check', '--input', join(directory, 'units.json'), '--catalog', output],
      environment,
    );
    await cli(
      [
        'sync',
        '--project',
        'example',
        '--input',
        join(directory, 'units.json'),
        '--locales',
        Object.keys(translations).join(','),
      ],
      environment,
    );
    assert.equal(store.listJobs('example').records.length, 5);
    assert.equal(calls, 10);
    const german = jobs.find((x) => x.locale === 'de')!;
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/example/jobs/${german.id}`,
      headers,
      payload: { revision: 1, translation: 'Guten Tag {name}' },
    });
    await until(() => store.getJob('example', german.id).status === 'review');
    assert.equal(store.getJob('example', german.id).translation, 'Guten Tag {name}');
    assert.equal(calls, 11);
    assert.equal(store.exportCatalog('example', 'de').messages.hello, 'Hallo {name}');
    assert.ok(store.listProjects()[0]!.spentUsd > 0);
    assert.equal(store.listProjects()[0]!.reservedUsd, 0);
  } finally {
    await worker.stop();
    await app.close();
    store.close();
    await new Promise<void>((resolve, reject) =>
      provider.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  }
});
test('SQLite survives process-style close/reopen and exposes only approved document content', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'everylocale-persistence-')),
    path = join(directory, 'state.sqlite');
  let store = new SqliteStore(path);
  try {
    store.saveProject(
      projectSchema.parse({ id: 'docs', name: 'Documents', targetLocales: ['fr'], budgetUsd: 1 }),
    );
    const imported = store.importDocument(
      'docs',
      'article',
      'markdown',
      '# Hello\n\nRead [the guide](https://example.test).\n',
    );
    const jobs = store.enqueue('docs', imported.units, ['fr'], 'first');
    store.close();
    store = new SqliteStore(path);
    assert.throws(() => store.exportDocument('docs', 'article', 'fr'));
    for (const job of jobs) {
      const claim = store.claim(() => 0)!;
      const text = claim.record.source.source
        .replace('Hello', 'Bonjour')
        .replace('Read', 'Lire')
        .replace('the guide', 'le guide');
      store.complete(job.id, claim.leaseToken, text, [], '');
      store.approve('docs', job.id, 1, 'owner');
    }
    const exported = store.exportDocument('docs', 'article', 'fr');
    assert.match(exported.content, /# Bonjour/);
    assert.match(exported.content, /https:\/\/example.test/);
    assert.equal(exported.sourceRevision, imported.sourceRevision);
    store.importDocument('docs', 'article', 'markdown', '# New source\n');
    assert.throws(() => store.exportDocument('docs', 'article', 'fr'));
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
