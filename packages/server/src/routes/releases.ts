import { z } from 'zod';
import { projectLocaleParams, projectParams, type RouteContext } from '../http/context.js';
import { bundleSchema, catalogSchema, okSchema } from '../http/schemas.js';

const current = (fallback: 'true' | 'false') =>
  z.object({
    current: z
      .enum(['true', 'false'])
      .default(fallback)
      .describe('`true` fails unless every message has an approval for the current source'),
  });

export function releaseRoutes({ api, auth, store }: RouteContext) {
  api.route(
    {
      method: 'GET',
      path: '/api/v1/projects/{project}/bundle',
      operationId: 'exportBundle',
      summary: 'Approved catalogs of every locale, as one verified bundle',
      description:
        '`everylocale pull` builds a release from this. Locales named in `complete` must be fully approved; others may be partial.',
      tag: 'Releases',
      access: 'export',
      params: projectParams,
      query: z.object({
        complete: z
          .string()
          .max(4000)
          .optional()
          .describe('Comma-separated locales that must be complete; every target by default'),
      }),
      response: bundleSchema,
    },
    ({ params, query, user }) => {
      auth.requireUnlimited(user);
      return store.exportBundle(
        params.project,
        query.complete === undefined
          ? 'all'
          : query.complete
              .split(',')
              .map((locale) => locale.trim())
              .filter(Boolean),
      );
    },
  );
  api.route(
    {
      method: 'GET',
      path: '/api/v1/projects/{project}/exports/{locale}',
      operationId: 'exportCatalog',
      summary: 'Approved catalog of one locale',
      tag: 'Releases',
      access: 'export',
      params: projectLocaleParams,
      query: current('false'),
      response: catalogSchema,
    },
    ({ params, query, user }) => {
      auth.requireLocale(user, params.locale);
      return store.exportCatalog(params.project, params.locale, query.current === 'true');
    },
  );
  api.route(
    {
      method: 'POST',
      path: '/api/v1/projects/{project}/exports/{locale}',
      operationId: 'snapshotCatalog',
      summary: 'Record the current approved catalog of one locale as a release artifact',
      tag: 'Releases',
      access: 'export',
      params: projectLocaleParams,
      response: catalogSchema,
    },
    ({ params, user }) => {
      auth.requireLocale(user, params.locale);
      return store.snapshot(params.project, params.locale);
    },
  );
  api.route(
    {
      method: 'POST',
      path: '/api/v1/projects/{project}/rollback',
      operationId: 'rollback',
      summary: 'Publish an earlier artifact of one locale again',
      tag: 'Releases',
      access: 'approve',
      params: projectParams,
      body: z.object({ locale: z.string(), artifactId: z.string() }),
      response: okSchema,
    },
    ({ params, body, user }) => {
      auth.requireLocale(user, body.locale);
      store.rollback(params.project, body.locale, body.artifactId, user.actor);
      return { ok: true as const };
    },
  );
  api.route(
    {
      method: 'GET',
      path: '/api/v1/projects/{project}/artifacts',
      operationId: 'listArtifacts',
      summary: 'Recorded release artifacts, newest first',
      tag: 'Releases',
      access: 'export',
      params: projectParams,
      query: z.object({ locale: z.string().optional() }),
      response: z.array(z.object({ id: z.string(), locale: z.string(), created_at: z.number() })),
    },
    ({ params, query, user }) => {
      if (query.locale) auth.requireLocale(user, query.locale);
      return store
        .artifacts(params.project, query.locale)
        .filter((item) => user.locales === null || user.locales.includes(item.locale));
    },
  );
}
