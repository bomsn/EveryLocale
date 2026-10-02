import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm, readdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { SqliteStore } from '../packages/store/dist/index.js';
import { projectSchema, serviceUrl, documentPreview } from '../packages/core/dist/index.js';
import { EveryLocaleClient } from '../packages/adapters/dist/index.js';
import { createApp } from '../packages/server/src/app.js';
import { TranslationWorker } from '../packages/server/src/worker.js';
import { databasePath } from '../packages/server/src/paths.js';

async function command(file: string, args: string[], env: Record<string, string> = {}) {
  return new Promise<{ code: number | null; output: string }>((done, reject) => {
    const child = spawn(process.execPath, [resolve(file), ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (value) => (output += value));
    child.stderr.on('data', (value) => (output += value));
    child.on('error', reject);
    child.on('exit', (code) => done({ code, output }));
  });
}
const cli = (args: string[], env: Record<string, string> = {}) =>
  command('packages/cli/dist/index.js', args, env);

test('configuration checks and maintenance use the service database without model calls or credential output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'everylocale-doctor-'));
  assert.ok(directory.startsWith(join(tmpdir(), 'everylocale-doctor-')));
  try {
    assert.equal(databasePath('../../data/example.sqlite'), resolve('data/example.sqlite'));
    const env = {
      EVERYLOCALE_DATABASE: relative(resolve('packages/server'), join(directory, 'service.sqlite')),
      EVERYLOCALE_ADMIN_TOKEN: 'private-owner-credential-of-sufficient-length',
      EVERYLOCALE_SESSION_SECRET: 'independent-private-session-secret-of-sufficient-length',
      EVERYLOCALE_CHATGPT_SECRET: '',
      EVERYLOCALE_WEBHOOK_URL: '',
      EVERYLOCALE_GENERATOR_URL: '',
      EVERYLOCALE_GENERATOR_MODEL: '',
      EVERYLOCALE_REVIEWER_URL: '',
      EVERYLOCALE_REVIEWER_MODEL: '',
    };
    const missing = await command('packages/server/dist/doctor.js', [], env);
    assert.equal(missing.code, 1);
    assert.match(missing.output, /Translation is not configured/);
    const configured = await command('packages/server/dist/doctor.js', [], {
      ...env,
      EVERYLOCALE_GENERATOR_URL: 'http://127.0.0.1:1/v1',
      EVERYLOCALE_GENERATOR_MODEL: 'example',
      EVERYLOCALE_GENERATOR_INPUT_PRICE: '0',
      EVERYLOCALE_GENERATOR_OUTPUT_PRICE: '0',
      EVERYLOCALE_REVIEWER_URL: 'http://127.0.0.1:1/v1',
      EVERYLOCALE_REVIEWER_MODEL: 'example',
      EVERYLOCALE_REVIEWER_INPUT_PRICE: '0',
      EVERYLOCALE_REVIEWER_OUTPUT_PRICE: '0',
    });
    assert.equal(configured.code, 0, configured.output);
    assert.match(configured.output, /No model request was sent/);
    assert.doesNotMatch(configured.output, /private-owner|private-session/);
    const store = new SqliteStore(join(directory, 'service.sqlite'));
    store.saveProject(
      projectSchema.parse({
        id: 'first-app',
        name: 'Saved in the service',
        targetLocales: ['de'],
        budgetUsd: 1,
      }),
    );
    store.close();
    const backup = await command(
      'packages/server/dist/maintenance.js',
      ['backup', '--output', join(directory, 'snapshot.sqlite')],
      env,
    );
    assert.equal(backup.code, 0, backup.output);
    const restored = new SqliteStore(join(directory, 'snapshot.sqlite'));
    assert.equal(restored.getProject('first-app').name, 'Saved in the service');
    restored.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('invalid CLI options stop before service mutation and remote credentials require HTTPS', async () => {
  let requests = 0;
  const server = createServer((_, response) => {
    requests++;
    response.end('{}');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  try {
    const env = {
      EVERYLOCALE_URL: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      EVERYLOCALE_TOKEN: 'scoped-example',
    };
    const invalid = await cli(
      [
        'sync',
        '--project',
        'first-app',
        '--input',
        'examples/messages.json',
        '--locales',
        'de',
        '--wait',
        '--timeout',
        '0',
      ],
      env,
    );
    assert.equal(invalid.code, 1);
    assert.match(invalid.output, /Timeout/);
    assert.equal(requests, 0);
    const noValue = await cli(
      ['sync', '--project', '--input', 'source.json', '--locales', 'de'],
      env,
    );
    assert.equal(noValue.code, 1);
    assert.match(noValue.output, /--project needs a value/);
    assert.equal(requests, 0);
    const help = await cli(['sync', '--help']);
    assert.equal(help.code, 0);
    assert.match(help.output, /first-app/);
    assert.throws(() => serviceUrl('http://example.com'), /HTTPS/);
    assert.throws(() => new EveryLocaleClient('http://example.com', 'secret'), /HTTPS/);
    assert.throws(() => serviceUrl('https://user:password@example.com'), /credentials/);
    assert.equal(serviceUrl('http://[::1]:4310/'), 'http://[::1]:4310');
  } finally {
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
  }
});

test('public guides retain safe links and real destinations while review previews stay inactive', async () => {
  const html = documentPreview(
    '# Start\n\n[Safe](https://example.com) [Bad](javascript:alert(1))\n\n```sh\nexample\n```',
    'markdown',
    { link: (href) => href, headingIds: true, focusableCode: true },
  );
  assert.match(html, /id="start"/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.doesNotMatch(html, /href="javascript/);
  assert.match(html, /pre tabindex="0"/);
  assert.doesNotMatch(documentPreview('[Safe](https://example.com)', 'markdown'), /href=/);
  const root = 'packages/server/public/guides';
  const files = (await readdir(root)).filter((name) => name.endsWith('.html'));
  assert.equal(files.length, 10);
  for (const file of files) {
    const content = await readFile(join(root, file), 'utf8');
    for (const match of content.matchAll(/href="(\/assets\/guides\/[^"#]+)(#[^"]+)?"/g)) {
      const destination = join(root, match[1]!.replace('/assets/guides/', ''));
      await access(destination);
      if (match[2])
        assert.ok(
          (await readFile(destination, 'utf8')).includes(`id="${match[2].slice(1)}"`),
          `${file}: ${match[0]}`,
        );
    }
  }
});

test('the documented JSON example translates, renders, updates and reuses unchanged work through the real service and CLI', async () => {
  let calls = 0;
  const translated: Record<string, string> = {
    'Welcome, {name}!': 'Willkommen, {name}!',
    'Create a project': 'Projekt erstellen',
    'Your changes are saved.': 'Deine Änderungen sind gespeichert.',
    'Create your first project': 'Erstelle dein erstes Projekt',
  };
  const provider = createServer(async (request, response) => {
    let content = '';
    for await (const chunk of request) content += chunk;
    const payload = JSON.parse(content),
      input = JSON.parse(payload.messages[1].content);
    calls++;
    const value =
      payload.model === 'reviewer'
        ? { findings: [], summary: 'Fixture independent review' }
        : { translation: translated[input.source] };
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(value) } }],
        usage: { prompt_tokens: 100, completion_tokens: 30 },
      }),
    );
  });
  await new Promise<void>((done) => provider.listen(0, '127.0.0.1', done));
  const directory = await mkdtemp(join(tmpdir(), 'everylocale-first-file-'));
  assert.ok(directory.startsWith(join(tmpdir(), 'everylocale-first-file-')));
  const store = new SqliteStore(join(directory, 'service.sqlite'));
  const app = await createApp(store, {
    adminToken: 'example-owner-token-of-sufficient-length',
    sessionSecret: 'example-independent-session-secret-of-sufficient-length',
    publicOrigin: 'http://localhost:4310',
    secureCookie: false,
    providersReady: true,
  });
  const base = {
    baseUrl: `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`,
    inputPrice: 0,
    outputPrice: 0,
  };
  const worker = new TranslationWorker(store, {
    generator: { ...base, model: 'generator' },
    reviewer: { ...base, model: 'reviewer' },
    concurrency: 2,
    intervalMs: 0,
  });
  try {
    store.saveProject(
      projectSchema.parse({
        id: 'first-app',
        name: 'My first app',
        targetLocales: ['de'],
        budgetUsd: 1,
        approvalMode: 'automatic',
      }),
    );
    const token = store.mintToken(
      'first-app',
      ['read', 'import', 'translate', 'export'],
      Date.now() + 60000,
    ).token;
    await app.listen({ host: '127.0.0.1', port: 0 });
    worker.start();
    const env = {
      EVERYLOCALE_URL: `http://127.0.0.1:${(app.server.address() as { port: number }).port}`,
      EVERYLOCALE_TOKEN: token,
    };
    const input = join(directory, 'messages.json'),
      source = join(directory, 'source.json'),
      catalog = join(directory, 'de.catalog.json'),
      output = join(directory, 'de.json');
    await writeFile(input, await readFile('examples/messages.json'));
    const run = async (args: string[]) => {
      const result = await cli(args, env);
      assert.equal(result.code, 0, result.output);
    };
    const sync = async () => {
      await run([
        'extract',
        '--input',
        input,
        '--format',
        'json',
        '--namespace',
        'messages',
        '--output',
        source,
      ]);
      await run([
        'sync',
        '--project',
        'first-app',
        '--input',
        source,
        '--locales',
        'de',
        '--wait',
        '--timeout',
        '20',
      ]);
      await run(['export', '--project', 'first-app', '--locale', 'de', '--output', catalog]);
      await run([
        'render',
        '--input',
        input,
        '--format',
        'json',
        '--namespace',
        'messages',
        '--catalog',
        catalog,
        '--output',
        output,
      ]);
    };
    await sync();
    assert.equal(calls, 6);
    assert.equal(
      JSON.parse(await readFile(catalog, 'utf8')).messages['messages:welcome'],
      'Willkommen, {name}!',
    );
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), {
      welcome: 'Willkommen, {name}!',
      createProject: 'Projekt erstellen',
      saved: 'Deine Änderungen sind gespeichert.',
    });
    await sync();
    assert.equal(calls, 6);
    const changed = JSON.parse(await readFile(input, 'utf8'));
    changed.createProject = 'Create your first project';
    await writeFile(input, JSON.stringify(changed));
    await sync();
    assert.equal(calls, 8);
    assert.equal(
      JSON.parse(await readFile(output, 'utf8')).createProject,
      'Erstelle dein erstes Projekt',
    );
    await run(['pull', '--project', 'first-app', '--output', join(directory, 'locales')]);
    const pointer = JSON.parse(await readFile(join(directory, 'locales/current.json'), 'utf8'));
    const delivered = JSON.parse(
      await readFile(join(directory, 'locales/releases', pointer.revision, 'de.json'), 'utf8'),
    );
    assert.equal(delivered.messages['messages:createProject'], 'Erstelle dein erstes Projekt');
  } finally {
    await worker.stop();
    await app.close();
    store.close();
    await new Promise<void>((done, reject) =>
      provider.close((error) => (error ? reject(error) : done())),
    );
    await rm(directory, { recursive: true, force: true });
  }
});
