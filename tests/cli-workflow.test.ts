import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { projectSchema } from '../packages/core/dist/index.js';
import { SqliteStore } from '../packages/store/dist/index.js';
import { createApp } from '../packages/server/dist/app.js';
import { TranslationWorker } from '../packages/server/dist/worker.js';
import { loadRelease } from '../packages/runtime/dist/server.js';
import { recordingLog } from './support/log.ts';

/** Fixture model translations by target locale and source text. */
const TRANSLATIONS: Record<string, Record<string, string>> = {
  de: {
    'Welcome, {name}!': 'Willkommen, {name}!',
    Save: 'Speichern',
    'Save changes': 'Änderungen speichern',
    '{count, plural, one {# project} other {# projects}}':
      '{count, plural, one {# Projekt} other {# Projekte}}',
  },
  fr: {
    'Welcome, {name}!': 'Bienvenue, {name} !',
    Save: 'Enregistrer',
    'Save changes': 'Enregistrer les modifications',
    '{count, plural, one {# project} other {# projects}}':
      '{count, plural, one {# projet} many {# projets} other {# projets}}',
  },
};

async function everylocale(cwd: string, args: string[], env: Record<string, string>) {
  return new Promise<{ code: number | null; output: string }>((done, reject) => {
    const child = spawn(process.execPath, [resolve('packages/cli/dist/index.js'), ...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', reject);
    child.on('exit', (code) => {
      done({ code, output });
    });
  });
}

test('an app syncs, pulls, checks, imports and rolls back its translations through the real service', async () => {
  const provider = createServer((request, response) => {
    void (async () => {
      let body = '';
      for await (const chunk of request) body += String(chunk);
      const payload = JSON.parse(body) as { model: string; messages: Array<{ content: string }> };
      const input = JSON.parse(payload.messages[1]?.content ?? '{}') as {
        source: string;
        targetLocale: string;
      };
      const value =
        payload.model === 'reviewer'
          ? { findings: [], summary: 'Fixture review' }
          : { translation: TRANSLATIONS[input.targetLocale]?.[input.source] ?? input.source };
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(value) } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      );
    })();
  });
  await new Promise<void>((done) => provider.listen(0, '127.0.0.1', done));
  const model = {
    baseUrl: `http://127.0.0.1:${String((provider.address() as { port: number }).port)}/v1`,
    inputPrice: 0,
    outputPrice: 0,
  };
  const directory = await mkdtemp(join(tmpdir(), 'everylocale-app-'));
  const app = join(directory, 'app');
  await cp('examples/quickstart', app, { recursive: true });
  const store = new SqliteStore(join(directory, 'service.sqlite'));
  store.saveProject(
    projectSchema.parse({
      id: 'first-app',
      name: 'First app',
      targetLocales: ['de', 'fr'],
      budgetUsd: 5,
      policies: [
        { match: { tag: 'help' }, translate: 'human', approve: 'human' },
        { match: {}, translate: 'ai', approve: 'automatic' },
      ],
    }),
  );
  const service = await createApp(store, {
    adminToken: 'owner-token-with-at-least-32-characters',
    sessionSecret: 'session-secret-with-at-least-32-characters',
    publicOrigin: 'http://localhost:4310',
    secureCookie: false,
    providersReady: true,
    logLevel: 'silent',
    trustProxy: false,
  });
  const worker = new TranslationWorker(
    store,
    {
      generator: { ...model, model: 'generator' },
      reviewer: { ...model, model: 'reviewer' },
      concurrency: 2,
      intervalMs: 0,
    },
    recordingLog(),
  );
  try {
    await service.listen({ host: '127.0.0.1', port: 0 });
    worker.start();
    const token = store.mintToken(
      'first-app',
      ['read', 'import', 'translate', 'export'],
      Date.now() + 600000,
    );
    const env = {
      EVERYLOCALE_URL: `http://127.0.0.1:${String((service.server.address() as { port: number }).port)}`,
      EVERYLOCALE_TOKEN: token.token,
    };
    const run = (...args: string[]) => everylocale(app, args, env);

    // Help pages need a person; German is live, so the wait reports them and fails.
    const blocked = await run('sync', '--wait', '--timeout', '60');
    assert.equal(blocked.code, 1, blocked.output);
    assert.match(blocked.output, /in live locales need attention/);
    assert.match(blocked.output, /de content\/getting-started:[^\n]*: awaiting/);
    for (const job of store.listJobs('first-app', 'de', 0, 100, { status: 'awaiting' }).records) {
      const translation = {
        'Getting started': 'Erste Schritte',
        'Create your first project.': 'Erstelle dein erstes Projekt.',
        'Create a project and invite your team.': 'Erstelle ein Projekt und lade dein Team ein.',
      }[job.source.source.replace(/\[\[EL:[^\]]+\]\]/g, '')];
      assert.ok(translation, job.source.source);
      store.edit(
        'first-app',
        job.id,
        job.revision,
        job.source.source.replace(/(?<=^|\]\])[^[]+$/, translation),
        'writer',
      );
      store.approve('first-app', job.id, store.getJob('first-app', job.id).revision, 'reviewer');
    }
    const synced = await run('sync', '--wait', '--timeout', '60');
    assert.equal(synced.code, 0, synced.output);
    assert.match(synced.output, /Draft locales have 4 open translations/);

    const pulled = await run('pull');
    assert.equal(pulled.code, 0, pulled.output);
    assert.match(pulled.output, /content\/fr\/getting-started\.md: not written; 4 segments/);
    assert.deepEqual(JSON.parse(await readFile(join(app, 'locales/de/app.json'), 'utf8')), {
      welcome: 'Willkommen, {name}!',
      save: 'Speichern',
      projects: '{count, plural, one {# Projekt} other {# Projekte}}',
    });
    const german = await readFile(join(app, 'content/de/getting-started.md'), 'utf8');
    assert.match(
      german,
      /^---\ntitle: "Erste Schritte"\ndescription: "Erstelle dein erstes Projekt."\norder: 1\n---/,
    );
    assert.match(german, /# Erste Schritte\n\nErstelle ein Projekt und lade dein Team ein\./);
    const release = await loadRelease(join(app, '.everylocale'));
    const first = release.revision;
    assert.equal(release.manifest.locales.find((item) => item.id === 'fr')?.missing.length, 4);
    assert.deepEqual(Object.keys(release.messages('de', ['app'])).sort(), [
      'app:projects',
      'app:save',
      'app:welcome',
    ]);
    assert.deepEqual(release.manifest.plurals.fr?.cardinal, ['one', 'many', 'other']);

    const clean = await run('check');
    assert.equal(clean.code, 0, clean.output);
    assert.match(
      clean.output,
      /complete for every live locale[\s\S]*fr \(draft\): 4 messages not approved yet/,
    );

    assert.equal((await run('codegen')).code, 0);
    const declarations = await readFile(join(app, 'everylocale.generated.d.ts'), 'utf8');
    assert.match(declarations, /"app:projects": \{ "count": number \};/);
    assert.match(declarations, /"app:save": undefined;/);
    assert.match(declarations, /"app:welcome": \{ "name": string \| number \};/);
    assert.doesNotMatch(declarations, /content:/, 'documents are not typed messages');
    assert.equal((await run('codegen', '--check')).code, 0);

    // Editing a source message makes the committed release stale until the next sync and pull.
    await writeFile(
      join(app, 'locales/en/app.json'),
      JSON.stringify({
        welcome: 'Welcome, {name}!',
        save: 'Save changes',
        projects: '{count, plural, one {# project} other {# projects}}',
      }),
    );
    const stale = await run('check', '--json');
    assert.equal(stale.code, 1);
    const report = JSON.parse(stale.output) as {
      problems: Array<{ code: string; locale?: string; id?: string }>;
    };
    assert.deepEqual(
      report.problems.map((problem) => [problem.code, problem.locale, problem.id]),
      [['translation_stale', 'de', 'app:save']],
    );
    assert.equal((await run('codegen', '--check')).code, 0, 'argument types did not change');
    assert.equal((await run('sync', '--wait', '--timeout', '60')).code, 0);
    assert.equal((await run('pull')).code, 0);
    assert.equal((await run('check')).code, 0);
    assert.equal(
      JSON.parse(await readFile(join(app, 'locales/de/app.json'), 'utf8')).save,
      'Änderungen speichern',
    );

    // A tampered release is refused.
    const second = (await loadRelease(join(app, '.everylocale'))).revision;
    const tampered = join(app, '.everylocale/releases', second, 'de/app.json');
    const original = await readFile(tampered, 'utf8');
    assert.ok(original.includes('Willkommen'));
    await writeFile(tampered, original.replace('Willkommen', 'Hallo'));
    const refused = await run('check');
    assert.equal(refused.code, 1);
    assert.match(refused.output, /altered[\s\S]*release_missing/);
    await writeFile(tampered, original);

    // Rolling back activates the earlier verified release.
    assert.equal((await run('rollback', '--revision', first)).code, 0);
    assert.equal((await loadRelease(join(app, '.everylocale'))).revision, first);
    assert.equal((await run('rollback', '--revision', second)).code, 0);

    // Existing translations are imported as candidates that follow the message policy.
    await writeFile(
      join(app, 'locales/fr/app.json'),
      JSON.stringify({
        welcome: 'Bonjour, {name} !',
        save: 'Enregistrer les modifications',
        projects: '{count, plural, one {# projet} other {# projets}}',
      }),
    );
    const imported = await run('import', '--locale', 'fr');
    assert.equal(imported.code, 1, 'one entry is rejected');
    assert.match(imported.output, /Imported 1 translations; 1 were unchanged/);
    assert.match(imported.output, /app:projects: [^\n]*many/);

    // Code that uses unknown, assembled or no ids is reported.
    await mkdir(join(app, 'src'), { recursive: true });
    await writeFile(
      join(app, 'src/page.tsx'),
      'const key = \'app:save\';\nexport const A = ({ n }: { n: string }) => <><Message id="app:welcome" /><Message id="app:typo" />{t(`app:${n}`)}{format(key)}</>;\n',
    );
    const code = JSON.parse((await run('check', '--code', 'src', '--json')).output) as {
      problems: Array<{ code: string; id?: string; file?: string }>;
    };
    assert.deepEqual(
      code.problems.map((problem) => [problem.code, problem.id ?? problem.file]),
      [
        ['id_unknown', 'app:typo'],
        ['id_dynamic', 'src/page.tsx:2'],
        ['id_unused', 'app:projects'],
      ],
    );

    // Deleting a source file withdraws its messages on the next sync.
    await rm(join(app, 'content/en/getting-started.md'));
    const removed = await run('sync');
    assert.match(removed.output, /4 withdrawn/);
    assert.equal(
      store
        .documents('first-app')
        .some((document) => document.namespace === 'content/getting-started'),
      false,
    );
  } finally {
    await worker.stop();
    await service.close();
    store.close();
    await new Promise<void>((done) => provider.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  }
});
