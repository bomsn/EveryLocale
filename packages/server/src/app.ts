import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import staticFiles from '@fastify/static';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ContractError } from '@everylocale/core';
import type { LocalizationStore } from '@everylocale/store';
import { createAuth } from './http/auth.js';
import { Api, openApiDocument } from './http/contract.js';
import type { AppConfig, RouteContext } from './http/context.js';
import { sessionRoutes } from './routes/session.js';
import { operationRoutes } from './routes/operations.js';
import { projectRoutes } from './routes/projects.js';
import { contentRoutes } from './routes/content.js';
import { jobRoutes } from './routes/jobs.js';
import { releaseRoutes } from './routes/releases.js';

export type { AppConfig, LogLevel } from './http/context.js';
export { LOG_LEVELS } from './http/context.js';

const REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;
const VERSION = z
  .object({ version: z.string() })
  .parse(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))).version;

export async function createApp(store: LocalizationStore, config: AppConfig) {
  const app = Fastify({
    bodyLimit: 2500000,
    trustProxy: config.trustProxy,
    requestIdHeader: 'x-request-id',
    genReqId: (request) => {
      const supplied = request.headers['x-request-id'];
      return typeof supplied === 'string' && REQUEST_ID.test(supplied) ? supplied : randomUUID();
    },
    logger: {
      level: config.logLevel,
      // Requests carry tokens, cookies and translatable content; logs carry none of them.
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-csrf-token"]'],
        censor: '[redacted]',
      },
      serializers: {
        req: (request: { method: string; routeOptions?: { url?: string }; id: string }) => ({
          id: request.id,
          method: request.method,
          route: request.routeOptions?.url,
        }),
      },
    },
  });
  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(staticFiles, {
    root: fileURLToPath(new URL('../public/', import.meta.url)),
    prefix: '/assets/',
    decorateReply: true,
  });
  const styleNonce = randomBytes(24).toString('base64url');
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ContractError) {
      if (error.status >= 500) request.log.error({ code: error.code }, error.message);
      return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof z.ZodError)
      return reply.code(422).send({
        error: {
          code: 'validation',
          message: 'Invalid request fields',
          fields: error.issues.map((issue) => issue.path.join('.')),
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
    request.log.error({ err: error }, 'request failed');
    return reply.code(500).send({
      error: {
        code: 'internal',
        message: 'The request could not be completed',
        requestId: request.id,
      },
    });
  });
  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Request-Id', request.id);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cache-Control', 'no-store');
    reply.header(
      'Content-Security-Policy',
      `default-src 'self'; script-src 'self'; style-src 'self' 'nonce-${styleNonce}'; img-src 'self' data:; frame-src 'self' about:; frame-ancestors 'none'; object-src 'none'; base-uri 'none'`,
    );
  });
  const auth = createAuth(store, config);
  const api = new Api(app, auth.authorize, config.validateResponses ?? true);
  const context: RouteContext = { app, api, store, config, auth, styleNonce };
  for (const routes of [
    sessionRoutes,
    operationRoutes,
    projectRoutes,
    contentRoutes,
    jobRoutes,
    releaseRoutes,
  ])
    routes(context);
  let document: ReturnType<typeof openApiDocument> | undefined;
  api.route(
    {
      method: 'GET',
      path: '/api/v1/openapi.json',
      operationId: 'openApi',
      summary: 'This API as an OpenAPI 3.1 document',
      tag: 'Service',
      access: 'public',
      response: z.record(z.string(), z.unknown()),
    },
    // Built on first use, once every endpoint, this one included, is declared.
    () => (document ??= openApiDocument(api.endpoints, VERSION)),
  );
  return app;
}
