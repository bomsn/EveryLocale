import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, readdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { SqliteStore } from '../packages/store/dist/index.js';
import { projectSchema, serviceUrl, documentPreview } from '../packages/core/dist/index.js';
import { EveryLocaleClient } from '../packages/adapters/dist/index.js';
import { databasePath } from '../packages/server/dist/paths.js';

async function command(file: string, args: string[], env: Record<string, string> = {}) {
  return new Promise<{ code: number | null; output: string }>((done, reject) => {
    const child = spawn(process.execPath, [resolve(file), ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (value: Buffer) => (output += value.toString()));
    child.stderr.on('data', (value: Buffer) => (output += value.toString()));
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
    assert.equal(
      existsSync(join(directory, 'service.sqlite')),
      false,
      'the doctor creates nothing',
    );
    const legacy = join(directory, 'legacy.sqlite');
    const old = new DatabaseSync(legacy);
    old.exec(await readFile('tests/fixtures/schema-v1.sql', 'utf8'));
    old.close();
    const upgradeLater = await command('packages/server/dist/doctor.js', [], {
      ...env,
      EVERYLOCALE_DATABASE: relative(resolve('packages/server'), legacy),
    });
    assert.match(upgradeLater.output, /schema version 1; the service upgrades it on next start/);
    const reread = new DatabaseSync(legacy, { readOnly: true });
    const version = (reread.prepare('PRAGMA user_version').get() as { user_version: number })
      .user_version;
    reread.close();
    assert.equal(version, 1, 'the doctor never upgrades a database');
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
    const invalid = await cli(['sync', '--wait', '--timeout', '0'], env);
    assert.equal(invalid.code, 1);
    assert.match(invalid.output, /--timeout must be between/);
    const unknown = await cli(['pull', '--projekt', 'first-app'], env);
    assert.equal(unknown.code, 1);
    assert.match(unknown.output, /Unknown option: --projekt/);
    const noValue = await cli(['import', '--locale'], env);
    assert.equal(noValue.code, 1);
    assert.match(noValue.output, /--locale needs a value/);
    const noConfig = await cli(['sync', '--config', 'missing/everylocale.config.json'], env);
    assert.equal(noConfig.code, 1);
    assert.match(noConfig.output, /No everylocale.config.json found/);
    assert.equal(requests, 0, 'nothing reaches the service before the input is valid');
    const help = await cli(['help', 'sync']);
    assert.equal(help.code, 0);
    assert.match(help.output, /everylocale sync \[--wait\]/);
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
