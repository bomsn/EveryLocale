import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import staticFiles from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  ContractError,
  extractDocument,
  projectSchema,
  unitSchema,
  previewMessage,
  previewArguments,
  documentPreview,
  validateTranslation,
  PIPELINE_REVISION,
  DEFAULT_LOCALES,
} from '@everylocale/core';
import type { LocalizationStore, Scope } from '@everylocale/store';
import type { ChatGptConnection } from './chatgpt.js';

export type AppConfig = {
  adminToken: string;
  sessionSecret: string;
  publicOrigin: string;
  secureCookie: boolean;
  providersReady: boolean;
  connection?: ChatGptConnection;
};
type Identity = { owner: boolean; actor: string; projectId?: string; scopes: Scope[] };
const allScopes: Scope[] = ['read', 'import', 'translate', 'review', 'approve', 'export'];
const equal = (a: string, b: string) =>
  Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export async function createApp(store: LocalizationStore, config: AppConfig) {
  const app = Fastify({ bodyLimit: 2500000, logger: false });
  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(staticFiles, {
    root: fileURLToPath(new URL('../public/', import.meta.url)),
    prefix: '/assets/',
    decorateReply: true,
  });
  const loginAttempts = new Map<string, { count: number; until: number }>();
  const styleNonce = randomBytes(24).toString('base64url');
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ContractError)
      return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
    if (error instanceof z.ZodError)
      return reply.code(422).send({
        error: {
          code: 'validation',
          message: 'Invalid request fields',
          fields: error.issues.map((x) => x.path.join('.')),
        },
      });
    if (
      error &&
      typeof error === 'object' &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode < 500
    )
      return reply
        .code(error.statusCode)
        .send({ error: { code: 'request', message: 'Invalid request' } });
    return reply
      .code(500)
      .send({ error: { code: 'internal', message: 'The request could not be completed' } });
  });
  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cache-Control', 'no-store');
    reply.header(
      'Content-Security-Policy',
      `default-src 'self'; script-src 'self'; style-src 'self' 'nonce-${styleNonce}'; img-src 'self' data:; frame-src 'self' about:; frame-ancestors 'none'; object-src 'none'; base-uri 'none'`,
    );
  });
  const identity = (request: FastifyRequest): Identity => {
    const authorization = request.headers.authorization;
    if (authorization?.startsWith('Bearer ')) {
      const token = authorization.slice(7);
      if (equal(token, config.adminToken))
        return { owner: true, actor: 'owner', scopes: allScopes };
      const scoped = store.authenticate(token);
      if (scoped) return { owner: false, ...scoped };
      throw new ContractError('unauthorized', 'Authentication required', 401);
    }
    const signed = request.cookies.el_session;
    const verified = signed ? request.unsignCookie(signed) : null;
    if (!verified?.valid || !verified.value)
      throw new ContractError('unauthorized', 'Authentication required', 401);
    let session: { expires: number; csrf: string; tokenId?: string };
    try {
      session = JSON.parse(verified.value);
    } catch {
      throw new ContractError('unauthorized', 'Authentication required', 401);
    }
    if (session.expires <= Date.now() || !session.csrf)
      throw new ContractError('unauthorized', 'Session expired', 401);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      if (
        request.headers.origin !== config.publicOrigin ||
        request.headers['x-csrf-token'] !== session.csrf
      )
        throw new ContractError('csrf', 'Refresh the workspace before making changes', 403);
    }
    if (session.tokenId) {
      const scoped = store.authenticateId(session.tokenId);
      if (!scoped)
        throw new ContractError('unauthorized', 'Session access was revoked or expired', 401);
      return { owner: false, ...scoped };
    }
    return { owner: true, actor: 'owner-session', scopes: allScopes };
  };
  const access = (request: FastifyRequest, projectId: string, scope: Scope): Identity => {
    const user = identity(request);
    if (!user.owner && user.projectId !== projectId)
      throw new ContractError('not_found', 'Project not found', 404);
    if (!user.scopes.includes(scope))
      throw new ContractError('forbidden', 'This token cannot perform that operation', 403);
    return user;
  };
  const projectId = (request: FastifyRequest) =>
    z.object({ project: z.string() }).parse(request.params).project;
  const jobId = (request: FastifyRequest) => z.object({ id: z.string() }).parse(request.params).id;
  app.get('/health', async () => ({ status: 'healthy' }));
  app.get('/api/v1/locales', async () => DEFAULT_LOCALES);
  app.get('/', async (request, reply) => reply.sendFile('index.html'));
  app.post('/api/v1/session', async (request, reply) => {
    for (const [ip, entry] of loginAttempts)
      if (entry.until <= Date.now()) loginAttempts.delete(ip);
    const attempt = loginAttempts.get(request.ip);
    if (attempt && attempt.until > Date.now() && attempt.count >= 10)
      throw new ContractError('rate_limit', 'Too many login attempts', 429);
    const { token } = z.object({ token: z.string().max(500) }).parse(request.body);
    if (request.headers.origin !== config.publicOrigin)
      throw new ContractError('origin', 'Unexpected workspace origin', 403);
    const owner = equal(token, config.adminToken);
    const scoped = owner ? null : store.authenticate(token);
    if (!owner && (!scoped || !scoped.scopes.includes('read'))) {
      loginAttempts.set(request.ip, {
        count: attempt && attempt.until > Date.now() ? attempt.count + 1 : 1,
        until: Date.now() + 60000,
      });
      throw new ContractError('unauthorized', 'Invalid workspace token', 401);
    }
    loginAttempts.delete(request.ip);
    const csrf = randomBytes(24).toString('base64url');
    reply.setCookie(
      'el_session',
      JSON.stringify({
        expires: Date.now() + 8 * 3600000,
        csrf,
        ...(scoped ? { tokenId: scoped.actor.slice(6) } : {}),
      }),
      {
        signed: true,
        httpOnly: true,
        secure: config.secureCookie,
        sameSite: 'strict',
        path: '/',
        maxAge: 8 * 3600,
      },
    );
    return { csrf };
  });
  app.get('/api/v1/session', async (request) => {
    const user = identity(request);
    const signed = request.cookies.el_session;
    const decoded = signed ? request.unsignCookie(signed) : null;
    return {
      owner: user.owner,
      scopes: user.scopes,
      csrf: decoded?.valid ? JSON.parse(decoded.value!).csrf : null,
      providersReady: config.providersReady,
    };
  });
  app.delete('/api/v1/session', async (request, reply) => {
    identity(request);
    reply.clearCookie('el_session', { path: '/' });
    return { ok: true };
  });
  app.get('/api/v1/projects', async (request) => {
    const user = identity(request);
    if (!user.scopes.includes('read'))
      throw new ContractError('forbidden', 'This token cannot read project configuration', 403);
    return store.listProjects().filter((x) => user.owner || x.id === user.projectId);
  });
  app.get('/api/v1/operations', async (request) => {
    if (!identity(request).owner)
      throw new ContractError('forbidden', 'Only the owner can inspect service operations', 403);
    return { ...store.operations(), events: store.deliveryEvents() };
  });
  app.get('/api/v1/chatgpt/accounts', async (request) => {
    if (!identity(request).owner)
      throw new ContractError('forbidden', 'Only the owner can inspect provider accounts', 403);
    return {
      configured: Boolean(config.connection),
      accounts: config.connection?.accounts() ?? [],
      usageUrl: 'https://chatgpt.com/settings/usage',
    };
  });
  app.get('/api/v1/chatgpt/accounts/:id/models', async (request) => {
    if (!identity(request).owner)
      throw new ContractError('forbidden', 'Only the owner can inspect provider accounts', 403);
    if (!config.connection)
      throw new ContractError('provider_configuration', 'ChatGPT is not configured', 503);
    const { id } = z.object({ id: z.string().max(200) }).parse(request.params);
    return config.connection.models(id);
  });
  app.post('/api/v1/chatgpt/accounts/:id/disconnect', async (request) => {
    if (!identity(request).owner)
      throw new ContractError('forbidden', 'Only the owner can disconnect provider accounts', 403);
    if (!config.connection)
      throw new ContractError('provider_configuration', 'ChatGPT is not configured', 503);
    const { id } = z.object({ id: z.string().max(200) }).parse(request.params);
    return config.connection.disconnect(id);
  });
  app.post('/api/v1/deliveries/:id/retry', async (request) => {
    if (!identity(request).owner)
      throw new ContractError('forbidden', 'Only the owner can retry delivery', 403);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    store.retryDelivery(id);
    return { ok: true };
  });
  app.put('/api/v1/projects/:project', async (request) => {
    const user = identity(request);
    if (!user.owner)
      throw new ContractError('forbidden', 'Only the owner can configure projects', 403);
    const project = projectSchema.parse({ ...(request.body as object), id: projectId(request) });
    return store.saveProject(project, user.actor);
  });
  app.get('/api/v1/projects/:project', async (request) => {
    const id = projectId(request);
    access(request, id, 'read');
    return { ...store.getProject(id), pipelineRevision: PIPELINE_REVISION };
  });
  app.post('/api/v1/projects/:project/tokens', async (request) => {
    const user = identity(request),
      id = projectId(request);
    if (!user.owner) throw new ContractError('forbidden', 'Only the owner can issue tokens', 403);
    const body = z
      .object({
        scopes: z.array(z.enum(allScopes as [Scope, ...Scope[]])).min(1),
        expiresAt: z.number(),
      })
      .parse(request.body);
    return store.mintToken(id, body.scopes, body.expiresAt);
  });
  app.get('/api/v1/projects/:project/tokens', async (request) => {
    const user = identity(request);
    if (!user.owner) throw new ContractError('forbidden', 'Only the owner can inspect tokens', 403);
    return store.tokens(projectId(request));
  });
  app.delete('/api/v1/projects/:project/tokens/:id', async (request) => {
    const user = identity(request);
    if (!user.owner) throw new ContractError('forbidden', 'Only the owner can revoke tokens', 403);
    store.revokeToken(projectId(request), jobId(request), user.actor);
    return { ok: true };
  });
  app.post('/api/v1/projects/:project/sources', async (request) => {
    const id = projectId(request);
    access(request, id, 'import');
    const { units } = z.object({ units: z.array(unitSchema).min(1).max(5000) }).parse(request.body);
    return store.importSources(id, units);
  });
  app.post('/api/v1/projects/:project/documents', async (request) => {
    const id = projectId(request);
    access(request, id, 'import');
    const body = z
      .object({
        content: z.string(),
        format: z.enum(['json', 'yaml', 'po', 'markdown', 'mdx', 'html']),
        namespace: z.string().min(1).max(160),
      })
      .parse(request.body);
    return store.importDocument(id, body.namespace, body.format, body.content);
  });
  app.get('/api/v1/projects/:project/documents', async (request) => {
    const id = projectId(request);
    access(request, id, 'read');
    return store.documents(id);
  });
  app.get('/api/v1/projects/:project/documents/:id/export/:locale', async (request) => {
    const id = projectId(request);
    access(request, id, 'export');
    const { locale } = z.object({ locale: z.string() }).parse(request.params);
    return store.exportDocument(id, jobId(request), locale);
  });
  app.post('/api/v1/projects/:project/withdraw', async (request) => {
    const id = projectId(request),
      user = access(request, id, 'import');
    const { unitIds } = z.object({ unitIds: z.array(z.string()).max(5000) }).parse(request.body);
    store.withdraw(id, unitIds, user.actor);
    return { ok: true };
  });
  app.post('/api/v1/projects/:project/jobs', async (request) => {
    const id = projectId(request);
    access(request, id, 'translate');
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
    access(request, id, 'read');
    const query = z
      .object({
        locale: z.string().optional(),
        cursor: z.coerce.number().int().nonnegative().default(0),
        limit: z.coerce.number().int().min(1).max(200).default(100),
        status: z.enum(['pending', 'running', 'review', 'failed', 'stale', 'approved']).optional(),
        search: z.string().max(200).optional(),
        current: z.enum(['true', 'false']).default('false'),
      })
      .parse(request.query);
    return store.listJobs(id, query.locale, query.cursor, query.limit, {
      status: query.status,
      search: query.search,
      current: query.current === 'true',
    });
  });
  app.get('/api/v1/projects/:project/summary', async (request) => {
    const id = projectId(request);
    access(request, id, 'read');
    return store.summary(id);
  });
  app.get('/api/v1/projects/:project/jobs/:id', async (request) => {
    const id = projectId(request);
    access(request, id, 'read');
    return store.getJob(id, jobId(request));
  });
  app.get('/api/v1/projects/:project/jobs/:id/validation', async (request) => {
    const id = projectId(request);
    access(request, id, 'read');
    const job = store.getJob(id, jobId(request));
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
  app.post('/api/v1/projects/:project/preview', async (request) => {
    const id = projectId(request);
    access(request, id, 'read');
    const body = z
      .object({
        locale: z.string(),
        message: z.string().max(100000),
        values: z
          .record(z.string(), z.union([z.string().max(1000), z.number(), z.boolean()]))
          .default({}),
      })
      .parse(request.body);
    if (!store.getProject(id).targetLocales.includes(body.locale))
      throw new ContractError('locale', 'Locale is not configured', 422);
    try {
      const argumentsList = previewArguments(body.message);
      const values = {
        ...Object.fromEntries(argumentsList.map((argument) => [argument.name, argument.value])),
        ...body.values,
      };
      return { text: previewMessage(body.message, body.locale, values), arguments: argumentsList };
    } catch {
      throw new ContractError(
        'preview',
        'Provide values for all message variables and preserve valid ICU syntax',
        422,
      );
    }
  });
  app.get('/api/v1/projects/:project/documents/:namespace/preview/:locale', async (request) => {
    const id = projectId(request);
    access(request, id, 'read');
    const { namespace, locale } = z
      .object({ namespace: z.string(), locale: z.string() })
      .parse(request.params);
    const preview = store.previewDocument(id, namespace, locale);
    const frame = (content: string, language: string) =>
      `<!doctype html><html lang="${language}" dir="${DEFAULT_LOCALES.find((item) => item.id === language)?.direction ?? 'ltr'}"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${styleNonce}'; base-uri 'none'; form-action 'none'"><style nonce="${styleNonce}">body{font:16px/1.7 system-ui,sans-serif;padding:20px;color:#26322e;overflow-wrap:anywhere}table{border-collapse:collapse}td,th{border:1px solid #bbc9bd;padding:8px}pre{white-space:pre-wrap}blockquote{border-inline-start:3px solid #bbc9bd;padding-inline-start:16px}</style></head><body>${documentPreview(content, preview.format)}</body></html>`;
    return {
      isPreview: true,
      pendingUnits: preview.pendingUnits,
      sourceRevision: preview.sourceRevision,
      source: frame(preview.source, preview.sourceLocale),
      translation: frame(preview.translation, locale),
    };
  });
  app.patch('/api/v1/projects/:project/jobs/:id', async (request) => {
    const id = projectId(request),
      user = access(request, id, 'review');
    const body = z
      .object({ revision: z.number().int(), translation: z.string().min(1).max(100000) })
      .parse(request.body);
    store.edit(id, jobId(request), body.revision, body.translation, user.actor);
    return store.getJob(id, jobId(request));
  });
  app.post('/api/v1/projects/:project/jobs/:id/approve', async (request) => {
    const id = projectId(request),
      user = access(request, id, 'approve');
    const body = z
      .object({ revision: z.number().int(), overrideReason: z.string().max(2000).optional() })
      .parse(request.body);
    store.approve(id, jobId(request), body.revision, user.actor, body.overrideReason);
    return store.getJob(id, jobId(request));
  });
  app.post('/api/v1/projects/:project/approve', async (request) => {
    const id = projectId(request),
      user = access(request, id, 'approve');
    const { entries } = z
      .object({
        entries: z
          .array(z.object({ id: z.string(), revision: z.number().int() }))
          .min(1)
          .max(500),
      })
      .parse(request.body);
    store.approveBatch(id, entries, user.actor);
    return { approved: entries.length };
  });
  app.post('/api/v1/projects/:project/jobs/:id/retry', async (request) => {
    const id = projectId(request),
      user = access(request, id, 'translate');
    store.retry(id, jobId(request), user.actor);
    return { ok: true };
  });
  app.get('/api/v1/projects/:project/bundle', async (request) => {
    const id = projectId(request);
    access(request, id, 'export');
    const { current } = z
      .object({ current: z.enum(['true', 'false']).default('true') })
      .parse(request.query);
    return store.exportBundle(id, current === 'true');
  });
  app.get('/api/v1/projects/:project/exports/:locale', async (request) => {
    const id = projectId(request);
    access(request, id, 'export');
    const { locale } = z.object({ locale: z.string() }).parse(request.params);
    const { current } = z
      .object({ current: z.enum(['true', 'false']).default('false') })
      .parse(request.query);
    return store.exportCatalog(id, locale, current === 'true');
  });
  app.post('/api/v1/projects/:project/exports/:locale', async (request) => {
    const id = projectId(request);
    access(request, id, 'export');
    const { locale } = z.object({ locale: z.string() }).parse(request.params);
    return store.snapshot(id, locale);
  });
  app.post('/api/v1/projects/:project/rollback', async (request) => {
    const id = projectId(request),
      user = access(request, id, 'approve');
    const body = z.object({ locale: z.string(), artifactId: z.string() }).parse(request.body);
    store.rollback(id, body.locale, body.artifactId, user.actor);
    return { ok: true };
  });
  app.get('/api/v1/projects/:project/artifacts', async (request) => {
    const id = projectId(request);
    access(request, id, 'export');
    const { locale } = z.object({ locale: z.string().optional() }).parse(request.query);
    return store.artifacts(id, locale);
  });
  app.get('/api/v1/projects/:project/audit', async (request) => {
    const id = projectId(request);
    access(request, id, 'read');
    return store.auditLog(id);
  });
  return app;
}
