import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { projectSchema, type JobStatus } from '../packages/core/dist/index.js';
import { SqliteStore } from '../packages/store/dist/index.js';
import { createApp } from '../packages/server/dist/app.js';
import { loadConfig } from '../packages/server/dist/config.js';
import { TranslationWorker } from '../packages/server/dist/worker.js';

/**
 * A paid end-to-end check against real models, run by hand and never in CI. It uses the provider
 * endpoint and key from .env, optionally with another model and prices for this run only, and a
 * throwaway database. Ten messages that exercise variables, plurals, selects, numbers, dates,
 * rich text and a protected brand go through sync, generation, AI review, approval, pull and the
 * offline check in four locales, under a hard project budget.
 *
 *   pnpm live:check --model openai/gpt-4.1-nano --input-price 0.1 --output-price 0.4
 */
const { values } = parseArgs({
  options: {
    model: { type: 'string' },
    'input-price': { type: 'string' },
    'output-price': { type: 'string' },
    budget: { type: 'string', default: '0.05' },
    timeout: { type: 'string', default: '600' },
  },
});
for (const role of ['GENERATOR', 'REVIEWER']) {
  if (values.model) process.env[`EVERYLOCALE_${role}_MODEL`] = values.model;
  if (values['input-price']) process.env[`EVERYLOCALE_${role}_INPUT_PRICE`] = values['input-price'];
  if (values['output-price'])
    process.env[`EVERYLOCALE_${role}_OUTPUT_PRICE`] = values['output-price'];
}
const budget = Number(values.budget);
if (!(budget > 0 && budget <= 1)) throw new Error('--budget must be between 0 and 1 US dollars');

const LOCALES = ['de', 'fr-CA', 'ar', 'zh-TW'];
const MESSAGES = {
  welcome: 'Welcome back, {name}!',
  cart: '{count, plural, one {# item is} other {# items are}} in your cart.',
  pay: 'Pay {amount, number, ::currency/USD} now',
  terms: 'By continuing, you accept the <link>terms of service</link>.',
  order:
    '{status, select, shipped {Your order is on its way.} other {Your order is being prepared.}}',
  save: 'Save changes',
  error: 'Something went wrong. Please try again in a moment.',
  brand: 'Translated with EveryLocale',
  seen: 'Last seen on {date, date, medium}',
  invite: '{inviter} invited you to join {team}.',
};

const directory = await mkdtemp(join(tmpdir(), 'everylocale-live-'));
const app = join(directory, 'app');
const store = new SqliteStore(join(directory, 'service.sqlite'));
const config = loadConfig(store);
if (!config.worker) throw new Error('Configure the generator and reviewer in .env first');
const log = {
  error: (fields: Record<string, unknown>, message: string) => {
    console.error(message, fields);
  },
  warn: (fields: Record<string, unknown>, message: string) => {
    console.warn(message, fields);
  },
};
const service = await createApp(store, {
  ...config,
  publicOrigin: 'http://127.0.0.1',
  providersReady: true,
  logLevel: 'warn',
});
const worker = new TranslationWorker(store, { ...config.worker, concurrency: 4 }, log);
const project = 'live-check';
const cli = (...args: string[]) =>
  new Promise<string>((done, reject) => {
    const child = spawn(process.execPath, [resolve('packages/cli/dist/index.js'), ...args], {
      cwd: app,
      env: { ...process.env, EVERYLOCALE_URL: url, EVERYLOCALE_TOKEN: token },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', reject);
    child.on('exit', (code) => {
      done(`${output}${code ? `(exit ${String(code)})\n` : ''}`);
    });
  });
let url = '';
let token = '';
let failed = false;
try {
  store.saveProject(
    projectSchema.parse({
      id: project,
      name: 'Live model check',
      targetLocales: LOCALES,
      budgetUsd: budget,
      policies: [{ match: {}, translate: 'ai', approve: 'automatic' }],
      glossary: [{ source: 'EveryLocale', targets: {}, keep: true }],
    }),
  );
  await mkdir(join(app, 'locales', 'en'), { recursive: true });
  await writeFile(join(app, 'locales', 'en', 'app.json'), JSON.stringify(MESSAGES, null, 2));
  // Draft locales, so the release is written even if some messages wait for review.
  await writeFile(
    join(app, 'everylocale.config.json'),
    JSON.stringify({
      version: 1,
      project,
      sourceLocale: 'en',
      locales: LOCALES.map((id) => ({ id, status: 'draft' })),
      files: [{ pattern: 'locales/{locale}/{namespace}.json', format: 'json' }],
    }),
  );
  await service.listen({ host: '127.0.0.1', port: 0 });
  url = `http://127.0.0.1:${String((service.server.address() as { port: number }).port)}`;
  token = store.mintToken(
    project,
    ['read', 'import', 'translate', 'export'],
    Date.now() + 3600000,
  ).token;
  worker.start();
  console.log(
    `Live check: ${String(Object.keys(MESSAGES).length)} messages into ${LOCALES.join(', ')} with ${config.worker.generator.model} (generation) and ${config.worker.reviewer.model} (review), budget US$${String(budget)}.`,
  );
  process.stdout.write(await cli('sync'));
  const deadline = Date.now() + Number(values.timeout) * 1000;
  const counts = () => {
    const result: Partial<Record<JobStatus, number>> = {};
    for (const job of store.listJobs(project, undefined, 0, 200).records)
      result[job.status] = (result[job.status] ?? 0) + 1;
    return result;
  };
  while ((counts().pending ?? 0) + (counts().running ?? 0) > 0) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${JSON.stringify(counts())}`);
    await new Promise((done) => setTimeout(done, 2000));
  }
  const jobs = store.listJobs(project, undefined, 0, 200).records;
  const spent = store.listProjects().find((item) => item.id === project)?.spentUsd ?? 0;
  console.log(`\nStatuses: ${JSON.stringify(counts())}. Spent: US$${spent.toFixed(5)}.`);
  for (const locale of LOCALES) {
    console.log(`\n${locale}`);
    for (const job of jobs.filter((item) => item.locale === locale))
      console.log(
        `  ${job.status.padEnd(8)} ${job.unitId}: ${job.translation ?? '(none)'}${job.failure ? ` [${job.failure}: ${job.error ?? ''}]` : ''}${job.findings.length ? ` {${job.findings.map((finding) => `${finding.severity} ${finding.code}`).join(', ')}}` : ''}`,
      );
  }
  process.stdout.write(`\n${await cli('pull')}`);
  const check = await cli('check');
  process.stdout.write(check);
  const rendered = JSON.parse(
    await readFile(join(app, 'locales', 'ar', 'app.json'), 'utf8'),
  ) as Record<string, string>;
  console.log(`\nRendered locales/ar/app.json has ${String(Object.keys(rendered).length)} keys.`);
  failed = jobs.some((job) => job.status === 'failed') || check.includes('(exit') || spent > budget;
  console.log(failed ? '\nLive check FAILED.' : '\nLive check passed.');
} finally {
  await worker.stop();
  await service.close();
  store.close();
  await rm(directory, { recursive: true, force: true });
}
if (failed) process.exitCode = 1;
