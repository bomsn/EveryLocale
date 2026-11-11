#!/usr/bin/env node
import { readFile, writeFile, mkdir, rename, readdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  extractDocument,
  hash,
  sourceHash,
  unitSchema,
  validateTranslation,
  approvedCatalogSchema,
  PIPELINE_REVISION,
  serviceUrl,
  type Project,
  type ApprovedCatalog,
  type SourceUnit,
} from '@everylocale/core';
import { extractCode } from './extract-code.js';
import { installBundle, activateBundle } from './bundle.js';
import { setTimeout as delay } from 'node:timers/promises';
import { help } from './help.js';

const [command, ...args] = process.argv.slice(2);
function option(name: string): string | undefined;
function option(name: string, fallback: string): string;
function option(name: string, fallback?: string) {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} needs a value`);
  return value;
}
const required = (name: string) => {
  const value = option(name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
};
async function atomicWrite(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, path);
}
async function api<T>(path: string, method = 'GET', body?: unknown, key?: string): Promise<T> {
  const base = serviceUrl(option('url', process.env.EVERYLOCALE_URL ?? 'http://localhost:4310'));
  const token = process.env.EVERYLOCALE_TOKEN;
  if (!token) throw new Error('Set EVERYLOCALE_TOKEN to a scoped project token');
  const response = await fetch(`${base.replace(/\/$/, '')}/api/v1${path}`, {
    method,
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(key ? { 'idempotency-key': key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    // A proxy or gateway error page is reported by its HTTP status.
    throw new Error(`EveryLocale returned HTTP ${String(response.status)} without a JSON body`);
  }
  if (!response.ok)
    throw new Error(
      (data as { error?: { message?: string } }).error?.message ??
        `EveryLocale returned HTTP ${String(response.status)}`,
    );
  return data as T;
}
/** How often a waiting sync asks for progress; one request covers the whole submission. */
const POLL_MS = 2000;
type RequestStatus = {
  total: number;
  counts: Partial<Record<string, number>>;
  attention: Array<{
    unitId: string;
    locale: string;
    status: string;
    failure: string | null;
    error: string | null;
    findings: string[];
  }>;
};
async function waitFor(project: string, key: string, timeoutSeconds: number) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  for (;;) {
    const status = await api<RequestStatus>(
      `/projects/${encodeURIComponent(project)}/requests/${encodeURIComponent(key)}`,
    );
    if (status.attention.length) {
      const lines = status.attention.map(
        (job) =>
          `  ${job.locale} ${job.unitId}: ${job.status}${job.failure ? ` (${job.failure})` : ''}${job.error ? ` ${job.error}` : ''}${job.findings.length ? ` ${job.findings.join(' ')}` : ''}`,
      );
      throw new Error(
        [
          `${String(status.attention.length)} of ${String(status.total)} translations need attention:`,
          ...lines,
        ].join('\n'),
      );
    }
    if ((status.counts.approved ?? 0) === status.total) return;
    if (Date.now() >= deadline)
      throw new Error(
        `Translation is still in progress after ${String(timeoutSeconds)} s: ${String(status.counts.approved ?? 0)} of ${String(status.total)} approved`,
      );
    await delay(POLL_MS);
  }
}
async function filesUnder(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'build', '.git', '.next'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await filesUnder(path)));
    else if (/\.[cm]?tsx?$/.test(entry.name)) result.push(path);
  }
  return result;
}
async function main() {
  if (
    !command ||
    ['help', '--help', '-h'].includes(command) ||
    args.includes('--help') ||
    args.includes('-h')
  ) {
    console.log(help(command === 'help' ? args[0] : command));
    return;
  }
  if (command === 'extract-code') {
    const root = resolve(required('input'));
    const units = await extractCode(await filesUnder(root), root);
    const sourceLocale = option('source-locale', 'en');
    new Intl.Locale(sourceLocale);
    await atomicWrite(
      resolve(required('output')),
      JSON.stringify(
        units.map((unit) => ({ ...unit, sourceLocale })),
        null,
        2,
      ) + '\n',
    );
    console.log(`Extracted ${units.length} declared messages.`);
    return;
  }
  if (command === 'extract') {
    const content = await readFile(resolve(required('input')), 'utf8');
    const format = required('format');
    const document = extractDocument(content, format, option('namespace', 'document'));
    const sourceLocale = option('source-locale', 'en');
    new Intl.Locale(sourceLocale);
    await atomicWrite(
      resolve(required('output')),
      JSON.stringify(
        document.units.map((unit) => ({ ...unit, sourceLocale })),
        null,
        2,
      ) + '\n',
    );
    console.log(`Extracted ${document.units.length} segments.`);
    return;
  }
  if (command === 'sync') {
    const timeout = Number(option('timeout', '600'));
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 86400)
      throw new Error('Timeout must be between 1 and 86400 seconds');
    const locales = args.includes('--import-only')
      ? []
      : required('locales')
          .split(',')
          .map((value) => value.trim());
    if (locales.some((value) => !value)) throw new Error('Provide comma-separated target locales');
    const project = required('project'),
      content = await readFile(resolve(required('input')), 'utf8');
    const units = (JSON.parse(content) as unknown[]).map((x) => unitSchema.parse(x));
    const imported = await api<{ changed: string[]; unchanged: string[] }>(
      `/projects/${encodeURIComponent(project)}/sources`,
      'POST',
      { units },
    );
    if (!args.includes('--import-only')) {
      const configuration = await api<Project>(`/projects/${encodeURIComponent(project)}`);
      // The key covers everything that changes the work, so a changed submission is never mistaken for a repeat.
      const key = hash({
        units,
        locales,
        glossary: configuration.glossary,
        instructions: configuration.instructions,
        policies: configuration.policies,
        locked: configuration.locked,
        pipeline: PIPELINE_REVISION,
      });
      await api(
        `/projects/${encodeURIComponent(project)}/jobs`,
        'POST',
        { unitIds: units.map((x) => x.id), locales },
        key,
      );
      if (args.includes('--wait')) await waitFor(project, key, timeout);
    }
    console.log(`${imported.changed.length} changed; ${imported.unchanged.length} unchanged.`);
    return;
  }
  if (command === 'export') {
    const project = required('project'),
      locale = required('locale');
    const catalog = await api<ApprovedCatalog>(
      `/projects/${encodeURIComponent(project)}/exports/${encodeURIComponent(locale)}?current=${args.includes('--allow-stale') ? 'false' : 'true'}`,
    );
    await atomicWrite(resolve(required('output')), JSON.stringify(catalog, null, 2) + '\n');
    console.log(`Exported approved revision ${catalog.revision}.`);
    return;
  }
  if (command === 'pull') {
    const project = required('project');
    const bundle = await api(
      `/projects/${encodeURIComponent(project)}/bundle?current=${args.includes('--allow-stale') ? 'false' : 'true'}`,
    );
    const installed = await installBundle(required('output'), bundle);
    console.log(`Activated approved release ${installed.revision}.`);
    return;
  }
  if (command === 'rollback') {
    await activateBundle(required('output'), required('revision'));
    console.log('Activated the retained release.');
    return;
  }
  if (command === 'render') {
    const content = await readFile(resolve(required('input')), 'utf8');
    const catalog = approvedCatalogSchema.parse(
      JSON.parse(await readFile(resolve(required('catalog')), 'utf8')),
    );
    const format = required('format');
    const document = extractDocument(content, format, option('namespace', 'document'));
    for (const unit of document.units) {
      if (catalog.sources[unit.id] !== sourceHash({ ...unit, sourceLocale: catalog.sourceLocale }))
        throw new Error(`Approved source revision differs for ${unit.id}`);
    }
    await atomicWrite(
      resolve(required('output')),
      document.render(catalog.messages, catalog.locale),
    );
    console.log('Rendered approved content.');
    return;
  }
  if (command === 'check') {
    const units = (
      JSON.parse(await readFile(resolve(required('input')), 'utf8')) as SourceUnit[]
    ).map((x) => unitSchema.parse(x));
    const catalog = approvedCatalogSchema.parse(
      JSON.parse(await readFile(resolve(required('catalog')), 'utf8')),
    );
    const errors: string[] = [];
    for (const unit of units) {
      if (catalog.sources[unit.id] !== sourceHash(unit))
        errors.push(`${unit.id}: approval does not match source revision`);
      const translation = catalog.messages[unit.id];
      if (translation === undefined) {
        errors.push(`${unit.id}: missing approval`);
        continue;
      }
      errors.push(
        ...validateTranslation(unit, translation, catalog.locale)
          .filter((x) => x.severity === 'critical')
          .map((x) => `${unit.id}: ${x.message}`),
      );
    }
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(`Validated ${units.length} current approved messages.`);
    return;
  }
  console.error(`Unknown command: ${command}. Use pnpm cli help.`);
  if (command && !['help', '--help', '-h'].includes(command)) process.exitCode = 1;
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Command failed');
  process.exitCode = 1;
});
