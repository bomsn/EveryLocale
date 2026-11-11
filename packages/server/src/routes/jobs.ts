import { z } from 'zod';
import {
  ContractError,
  policyFor,
  validateTranslation,
  type Project,
  type TranslationRecord,
} from '@everylocale/core';
import { projectItemParams, projectParams, type RouteContext } from '../http/context.js';
import type { Identity } from '../http/auth.js';
import {
  findingResponseSchema,
  importResultSchema,
  JOB_STATUSES,
  okSchema,
  recordSchema,
  recordWithPolicySchema,
  requestStatusSchema,
  summarySchema,
} from '../http/schemas.js';

/** Jobs carry the policy that governs them, so clients never re-derive the rules. */
const withPolicy = (project: Project, job: TranslationRecord) => ({
  ...job,
  policy: policyFor(project, job.source),
});

export function jobRoutes({ api, auth, config, store }: RouteContext) {
  /** Reads a job the caller may see; limited tokens get "not found" for anything outside them. */
  const visibleJob = (project: string, user: Identity, id: string) => {
    const job = store.getJob(project, id);
    auth.requireAllowed(user, job.locale, job.unitId);
    return job;
  };

  api.route(
    {
      method: 'POST',
      path: '/api/v1/projects/{project}/jobs',
      operationId: 'enqueue',
      summary: 'Queue translation of messages into locales',
      description:
        'Repeating a request with the same `idempotency-key` returns the same jobs and spends nothing again.',
      tag: 'Translations',
      access: 'translate',
      params: projectParams,
      headers: z.object({ 'idempotency-key': z.string().min(1).max(200) }),
      body: z.object({
        unitIds: z.array(z.string()).min(1).max(5000),
        locales: z.array(z.string()).min(1).max(100),
      }),
      response: z.object({ records: z.array(recordSchema) }),
    },
    ({ params, headers, body }) => {
      if (!config.providersReady)
        throw new ContractError(
          'provider_configuration',
          'Configure generation and review providers before translating',
          503,
        );
      return {
        records: store.enqueue(
          params.project,
          body.unitIds,
          body.locales,
          headers['idempotency-key'],
        ),
      };
    },
  );
  api.route(
    {
      method: 'GET',
      path: '/api/v1/projects/{project}/jobs',
      operationId: 'listJobs',
      summary: 'Translations, filtered and paged',
      tag: 'Translations',
      access: 'read',
      params: projectParams,
      query: z.object({
        locale: z.string().optional(),
        cursor: z.coerce.number().int().nonnegative().default(0),
        limit: z.coerce.number().int().min(1).max(200).default(100),
        status: z.enum(JOB_STATUSES).optional(),
        search: z.string().max(200).optional(),
        current: z.enum(['true', 'false']).default('false'),
      }),
      response: z.object({
        records: z.array(recordWithPolicySchema),
        cursor: z
          .number()
          .int()
          .nullable()
          .describe('Pass back for the next page; null at the end'),
      }),
    },
    ({ params, query, user }) => {
      const page = store.listJobs(params.project, query.locale, query.cursor, query.limit, {
        status: query.status,
        search: query.search,
        current: query.current === 'true',
        within: user,
      });
      const project = store.getProject(params.project);
      return { ...page, records: page.records.map((job) => withPolicy(project, job)) };
    },
  );
  api.route(
    {
      method: 'GET',
      path: '/api/v1/projects/{project}/requests/{key}',
      operationId: 'requestStatus',
      summary: 'Progress of one submission, by its idempotency key',
      description: '`attention` lists what stops a release: failed, awaiting, in review or stale.',
      tag: 'Translations',
      access: 'read',
      params: projectParams.extend({ key: z.string().min(1).max(200) }),
      response: requestStatusSchema,
    },
    ({ params, user }) => {
      const status = store.requestStatus(params.project, params.key);
      return {
        ...status,
        attention: status.attention.filter((job) => auth.allows(user, job.locale, job.unitId)),
      };
    },
  );
  api.route(
    {
      method: 'GET',
      path: '/api/v1/projects/{project}/summary',
      operationId: 'summary',
      summary: 'Counts per locale',
      tag: 'Translations',
      access: 'read',
      params: projectParams,
      response: summarySchema,
    },
    ({ params, user }) => {
      const summary = store.summary(params.project);
      return {
        ...summary,
        languages: summary.languages.filter(
          (language) => user.locales === null || user.locales.includes(language.locale),
        ),
      };
    },
  );
  api.route(
    {
      method: 'GET',
      path: '/api/v1/projects/{project}/jobs/{id}',
      operationId: 'getJob',
      summary: 'One translation',
      tag: 'Translations',
      access: 'read',
      params: projectItemParams,
      response: recordWithPolicySchema,
    },
    ({ params, user }) =>
      withPolicy(store.getProject(params.project), visibleJob(params.project, user, params.id)),
  );
  api.route(
    {
      method: 'GET',
      path: '/api/v1/projects/{project}/jobs/{id}/validation',
      operationId: 'validateJob',
      summary: 'Structural checks of the current candidate',
      tag: 'Translations',
      access: 'read',
      params: projectItemParams,
      response: z.object({ findings: z.array(findingResponseSchema) }),
    },
    ({ params, user }) => {
      const job = visibleJob(params.project, user, params.id);
      return {
        findings: job.translation
          ? validateTranslation(
              job.source,
              job.translation,
              job.locale,
              store.getProject(params.project).glossary,
            )
          : [],
      };
    },
  );
  api.route(
    {
      method: 'PATCH',
      path: '/api/v1/projects/{project}/jobs/{id}',
      operationId: 'editJob',
      summary: 'Replace the candidate with wording from a person',
      description:
        'Fails with `revision_conflict` when the translation changed since `revision` was read.',
      tag: 'Translations',
      access: 'review',
      params: projectItemParams,
      body: z.object({ revision: z.number().int(), translation: z.string().min(1).max(100000) }),
      response: recordSchema,
    },
    ({ params, body, user }) => {
      const job = visibleJob(params.project, user, params.id);
      store.edit(params.project, job.id, body.revision, body.translation, user.actor);
      return store.getJob(params.project, job.id);
    },
  );
  api.route(
    {
      method: 'POST',
      path: '/api/v1/projects/{project}/jobs/{id}/approve',
      operationId: 'approveJob',
      summary: 'Approve one candidate at the revision the reviewer saw',
      tag: 'Translations',
      access: 'approve',
      params: projectItemParams,
      body: z.object({
        revision: z.number().int(),
        overrideReason: z
          .string()
          .max(2000)
          .optional()
          .describe('Required to approve over major findings'),
      }),
      response: recordSchema,
    },
    ({ params, body, user }) => {
      const job = visibleJob(params.project, user, params.id);
      store.approve(params.project, job.id, body.revision, user.actor, body.overrideReason);
      return store.getJob(params.project, job.id);
    },
  );
  api.route(
    {
      method: 'POST',
      path: '/api/v1/projects/{project}/approve',
      operationId: 'approveBatch',
      summary: 'Approve several candidates at once, all or none',
      tag: 'Translations',
      access: 'approve',
      params: projectParams,
      body: z.object({
        entries: z
          .array(z.object({ id: z.string(), revision: z.number().int() }))
          .min(1)
          .max(500),
      }),
      response: z.object({ approved: z.number().int() }),
    },
    ({ params, body, user }) => {
      for (const entry of body.entries) visibleJob(params.project, user, entry.id);
      store.approveBatch(params.project, body.entries, user.actor);
      return { approved: body.entries.length };
    },
  );
  api.route(
    {
      method: 'POST',
      path: '/api/v1/projects/{project}/jobs/{id}/retry',
      operationId: 'retryJob',
      summary: 'Queue a failed translation again',
      tag: 'Translations',
      access: 'translate',
      params: projectItemParams,
      response: okSchema,
    },
    ({ params, user }) => {
      store.retry(params.project, visibleJob(params.project, user, params.id).id, user.actor);
      return { ok: true as const };
    },
  );
  api.route(
    {
      method: 'POST',
      path: '/api/v1/projects/{project}/translations',
      operationId: 'importTranslations',
      summary: 'Bring existing translations in as candidates',
      description:
        'Each entry follows its message policy as an edit would. Rejected entries are listed with the reason.',
      tag: 'Translations',
      access: 'import',
      params: projectParams,
      body: z.object({
        locale: z.string(),
        entries: z
          .array(
            z.object({ unitId: z.string().min(1), translation: z.string().min(1).max(100000) }),
          )
          .min(1)
          .max(5000),
      }),
      response: importResultSchema,
    },
    ({ params, body, user }) => {
      auth.requireLocale(user, body.locale);
      const outside = body.entries.filter((entry) => !auth.allows(user, body.locale, entry.unitId));
      const result = store.importTranslations(
        params.project,
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
    },
  );
}
