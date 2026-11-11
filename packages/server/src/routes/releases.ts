import { z } from 'zod';
import { projectId, type RouteContext } from '../http/context.js';

const current = (query: unknown, fallback: 'true' | 'false') =>
  z.object({ current: z.enum(['true', 'false']).default(fallback) }).parse(query).current ===
  'true';
const localeParam = (params: unknown) => z.object({ locale: z.string() }).parse(params).locale;

export function releaseRoutes({ app, auth, store }: RouteContext) {
  app.get('/api/v1/projects/:project/bundle', async (request) => {
    const id = projectId(request);
    auth.requireUnlimited(auth.access(request, id, 'export'));
    // complete names the locales that must be fully approved; by default every target locale.
    const { complete } = z
      .object({ complete: z.string().max(4000).optional() })
      .parse(request.query);
    return store.exportBundle(
      id,
      complete === undefined
        ? 'all'
        : complete
            .split(',')
            .map((locale) => locale.trim())
            .filter(Boolean),
    );
  });
  app.get('/api/v1/projects/:project/exports/:locale', async (request) => {
    const id = projectId(request);
    const locale = localeParam(request.params);
    auth.requireLocale(auth.access(request, id, 'export'), locale);
    return store.exportCatalog(id, locale, current(request.query, 'false'));
  });
  app.post('/api/v1/projects/:project/exports/:locale', async (request) => {
    const id = projectId(request);
    const locale = localeParam(request.params);
    auth.requireLocale(auth.access(request, id, 'export'), locale);
    return store.snapshot(id, locale);
  });
  app.post('/api/v1/projects/:project/rollback', async (request) => {
    const id = projectId(request);
    const user = auth.access(request, id, 'approve');
    const body = z.object({ locale: z.string(), artifactId: z.string() }).parse(request.body);
    auth.requireLocale(user, body.locale);
    store.rollback(id, body.locale, body.artifactId, user.actor);
    return { ok: true };
  });
  app.get('/api/v1/projects/:project/artifacts', async (request) => {
    const id = projectId(request);
    const user = auth.access(request, id, 'export');
    const { locale } = z.object({ locale: z.string().optional() }).parse(request.query);
    if (locale) auth.requireLocale(user, locale);
    return store
      .artifacts(id, locale)
      .filter((item) => user.locales === null || user.locales.includes(item.locale));
  });
}
