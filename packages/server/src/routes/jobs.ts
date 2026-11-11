import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ContractError,
  policyFor,
  validateTranslation,
  type JobStatus,
  type Project,
  type TranslationRecord,
} from '@everylocale/core';
import { itemId, projectId, type RouteContext } from '../http/context.js';
import type { Identity } from '../http/auth.js';

const STATUSES: readonly [JobStatus, ...JobStatus[]] = [
  'pending',
  'running',
  'awaiting',
  'review',
  'failed',
  'stale',
  'approved',
];

/** Jobs carry the policy that governs them, so clients never re-derive the rules. */
const withPolicy = (project: Project, job: TranslationRecord) => ({
  ...job,
  policy: policyFor(project, job.source),
});

export function jobRoutes({ app, auth, config, store }: RouteContext) {
  /** Reads a job the caller may see; limited tokens get "not found" for anything outside them. */
  const visibleJob = (request: FastifyRequest, user: Identity, id = itemId(request)) => {
    const job = store.getJob(projectId(request), id);
    auth.requireAllowed(user, job.locale, job.unitId);
    return job;
  };

  app.post('/api/v1/projects/:project/jobs', async (request) => {
    const id = projectId(request);
    auth.access(request, id, 'translate');
    if (!config.providersReady)
      throw new ContractError(
        'provider_configuration',
        'Configure generation and review providers before translating',
        503,
      );
    const body = z
      .object({
        unitIds: z.array(z.string()).min(1).max(5000),
        locales: z.array(z.string()).min(1).max(100),
      })
      .parse(request.body);
    const key = z.string().min(1).max(200).parse(request.headers['idempotency-key']);
    return { records: store.enqueue(id, body.unitIds, body.locales, key) };
  });
  app.get('/api/v1/projects/:project/jobs', async (request) => {
    const id = projectId(request);
    const user = auth.access(request, id, 'read');
    const query = z
      .object({
        locale: z.string().optional(),
        cursor: z.coerce.number().int().nonnegative().default(0),
        limit: z.coerce.number().int().min(1).max(200).default(100),
        status: z.enum(STATUSES).optional(),
        search: z.string().max(200).optional(),
        current: z.enum(['true', 'false']).default('false'),
      })
      .parse(request.query);
    const page = store.listJobs(id, query.locale, query.cursor, query.limit, {
      status: query.status,
      search: query.search,
      current: query.current === 'true',
      within: user,
    });
    const project = store.getProject(id);
    return { ...page, records: page.records.map((job) => withPolicy(project, job)) };
  });
  app.get('/api/v1/projects/:project/summary', async (request) => {
    const id = projectId(request);
    const user = auth.access(request, id, 'read');
    const summary = store.summary(id);
    return {
      ...summary,
      languages: summary.languages.filter(
        (language) => user.locales === null || user.locales.includes(language.locale),
      ),
    };
  });
  app.get('/api/v1/projects/:project/jobs/:id', async (request) => {
    const job = visibleJob(request, auth.access(request, projectId(request), 'read'));
    return withPolicy(store.getProject(job.projectId), job);
  });
  app.get('/api/v1/projects/:project/jobs/:id/validation', async (request) => {
    const id = projectId(request);
    const job = visibleJob(request, auth.access(request, id, 'read'));
    return {
      findings: job.translation
        ? validateTranslation(
            job.source,
            job.translation,
            job.locale,
            store.getProject(id).glossary,
          )
        : [],
    };
  });
  app.patch('/api/v1/projects/:project/jobs/:id', async (request) => {
    const id = projectId(request);
    const user = auth.access(request, id, 'review');
    const job = visibleJob(request, user);
    const body = z
      .object({ revision: z.number().int(), translation: z.string().min(1).max(100000) })
      .parse(request.body);
    store.edit(id, job.id, body.revision, body.translation, user.actor);
    return store.getJob(id, job.id);
  });
  app.post('/api/v1/projects/:project/jobs/:id/approve', async (request) => {
    const id = projectId(request);
    const user = auth.access(request, id, 'approve');
    const job = visibleJob(request, user);
    const body = z
      .object({ revision: z.number().int(), overrideReason: z.string().max(2000).optional() })
      .parse(request.body);
    store.approve(id, job.id, body.revision, user.actor, body.overrideReason);
    return store.getJob(id, job.id);
  });
  app.post('/api/v1/projects/:project/approve', async (request) => {
    const id = projectId(request);
    const user = auth.access(request, id, 'approve');
    const { entries } = z
      .object({
        entries: z
          .array(z.object({ id: z.string(), revision: z.number().int() }))
          .min(1)
          .max(500),
      })
      .parse(request.body);
    for (const entry of entries) visibleJob(request, user, entry.id);
    store.approveBatch(id, entries, user.actor);
    return { approved: entries.length };
  });
  app.post('/api/v1/projects/:project/jobs/:id/retry', async (request) => {
    const id = projectId(request);
    const user = auth.access(request, id, 'translate');
    store.retry(id, visibleJob(request, user).id, user.actor);
    return { ok: true };
  });
  app.post('/api/v1/projects/:project/translations', async (request) => {
    const id = projectId(request);
    const user = auth.access(request, id, 'import');
    const body = z
      .object({
        locale: z.string(),
        entries: z
          .array(
            z.object({ unitId: z.string().min(1), translation: z.string().min(1).max(100000) }),
          )
          .min(1)
          .max(5000),
      })
      .parse(request.body);
    auth.requireLocale(user, body.locale);
    const outside = body.entries.filter((entry) => !auth.allows(user, body.locale, entry.unitId));
    const result = store.importTranslations(
      id,
      body.locale,
      body.entries.filter((entry) => auth.allows(user, body.locale, entry.unitId)),
      user.actor,
    );
    return {
      ...result,
      rejected: [
        ...result.rejected,
        ...outside.map((entry) => ({ unitId: entry.unitId, reason: 'Outside this token' })),
      ],
    };
  });
}
