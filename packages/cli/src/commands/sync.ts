import { setTimeout as delay } from 'node:timers/promises';
import { hash, PIPELINE_REVISION, type Project } from '@everylocale/core';
import type { Api } from '../api.js';
import type { Workspace } from '../project.js';

/** The service accepts at most this many messages per translation request. */
const BATCH = 5000;
/** How often a waiting sync asks for progress; one request covers a whole submission. */
const POLL_MS = 2000;

type RequestStatus = {
  total: number;
  counts: Partial<Record<string, number>>;
  locales: Record<string, Partial<Record<string, number>>>;
  attention: Array<{
    unitId: string;
    locale: string;
    status: string;
    failure: string | null;
    error: string | null;
    findings: string[];
  }>;
};
type ServiceDocument = { namespace: string; units: string[]; options: { origin?: string } };
/** Marks documents this command maintains, so other connectors' documents are never withdrawn. */
const ORIGIN = 'everylocale-files';

/** Confirms the service project covers every configured locale before any upload. */
async function checkProject(api: Api, workspace: Workspace): Promise<Project> {
  const { config } = workspace;
  const project = await api<Project>(`/projects/${encodeURIComponent(config.project)}`);
  if (project.sourceLocale !== config.sourceLocale)
    throw new Error(
      `The service project's source locale is ${project.sourceLocale}, but the config says ${config.sourceLocale}`,
    );
  const absent = config.registry
    .slice(1)
    .map((item) => item.id)
    .filter((locale) => !project.targetLocales.includes(locale));
  if (absent.length)
    throw new Error(
      `Add these target locales to project ${config.project} first: ${absent.join(', ')}`,
    );
  return project;
}

export async function sync(
  api: Api,
  workspace: Workspace,
  options: { wait: boolean; timeoutSeconds: number; log: (line: string) => void },
) {
  const { config } = workspace;
  const project = await checkProject(api, workspace);
  const path = (suffix: string) => `/projects/${encodeURIComponent(config.project)}${suffix}`;
  const unitIds: string[] = [];
  const revisions: string[] = [];
  let changed = 0;
  for (const source of workspace.sources) {
    const result = await api<{ changed: string[]; units: string[]; sourceRevision: string }>(
      path('/documents'),
      'POST',
      {
        namespace: source.namespace,
        format: source.format,
        content: await workspace.read(source),
        options: {
          ...(source.frontMatter ? { frontMatter: source.frontMatter } : {}),
          ...(source.tags.length ? { tags: source.tags } : {}),
          origin: ORIGIN,
        },
      },
    );
    unitIds.push(...result.units);
    revisions.push(result.sourceRevision);
    changed += result.changed.length;
  }
  // A file deleted locally withdraws its messages; documents from other connectors are untouched.
  const local = new Set(workspace.sources.map((source) => source.namespace));
  const removed = (await api<ServiceDocument[]>(path('/documents'))).filter(
    (document) => document.options.origin === ORIGIN && !local.has(document.namespace),
  );
  for (const document of removed)
    await api(path(`/documents/${encodeURIComponent(document.namespace)}`), 'DELETE');
  const withdrawn = removed.flatMap((document) => document.units);
  const locales = config.registry.slice(1).map((item) => item.id);
  const keys: string[] = [];
  for (let start = 0; start < unitIds.length; start += BATCH) {
    const batch = unitIds.slice(start, start + BATCH);
    // The key covers everything that changes the work, so a different request is never a repeat.
    const key = hash({
      batch,
      revisions,
      locales,
      glossary: project.glossary,
      instructions: project.instructions,
      policies: project.policies,
      locked: project.locked,
      pipeline: PIPELINE_REVISION,
    });
    await api(path('/jobs'), 'POST', { unitIds: batch, locales }, key);
    keys.push(key);
  }
  options.log(
    `Synchronized ${String(workspace.sources.length)} files: ${String(unitIds.length)} messages, ${String(changed)} changed, ${String(withdrawn.length)} withdrawn.`,
  );
  const live = new Set(
    config.registry
      .slice(1)
      .filter((item) => item.status === 'live')
      .map((item) => item.id),
  );
  if (options.wait) await waitFor(api, path, keys, live, options.timeoutSeconds, options.log);
}

const describe = (job: RequestStatus['attention'][number]) =>
  `  ${job.locale} ${job.unitId}: ${job.status}${job.failure ? ` (${job.failure})` : ''}${job.error ? ` ${job.error}` : ''}${job.findings.length ? ` ${job.findings.join(' ')}` : ''}`;

/** Only live locales block a release; open work in draft locales is listed, not failed. */
async function waitFor(
  api: Api,
  path: (suffix: string) => string,
  keys: readonly string[],
  live: ReadonlySet<string>,
  timeoutSeconds: number,
  log: (line: string) => void,
) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  for (;;) {
    const statuses = await Promise.all(
      keys.map((key) => api<RequestStatus>(path(`/requests/${encodeURIComponent(key)}`))),
    );
    const attention = statuses.flatMap((status) => status.attention);
    const blocking = attention.filter((job) => live.has(job.locale));
    let total = 0;
    let approved = 0;
    for (const status of statuses)
      for (const [locale, counts] of Object.entries(status.locales)) {
        if (!live.has(locale)) continue;
        for (const count of Object.values(counts)) total += count ?? 0;
        approved += counts.approved ?? 0;
      }
    if (blocking.length)
      throw new Error(
        [
          `${String(blocking.length)} of ${String(total)} translations in live locales need attention:`,
          ...blocking.map(describe),
        ].join('\n'),
      );
    if (approved === total) {
      log(`All ${String(total)} translations in live locales are approved.`);
      const drafts = attention.filter((job) => !live.has(job.locale));
      if (drafts.length)
        log(
          [
            `Draft locales have ${String(drafts.length)} open translations:`,
            ...drafts.map(describe),
          ].join('\n'),
        );
      return;
    }
    if (Date.now() >= deadline)
      throw new Error(
        `Translation is still in progress after ${String(timeoutSeconds)} s: ${String(approved)} of ${String(total)} live translations approved`,
      );
    await delay(POLL_MS);
  }
}
