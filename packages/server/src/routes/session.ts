import { z } from 'zod';
import type { RouteContext } from '../http/context.js';
import { localeSchema, okSchema, sessionSchema } from '../http/schemas.js';
import { suggestedLocales } from '../locales.js';

export function sessionRoutes({ app, api, auth, config, store }: RouteContext) {
  app.get('/', async (request, reply) => reply.sendFile('index.html'));
  api.route(
    {
      method: 'GET',
      path: '/health',
      operationId: 'health',
      summary: 'Liveness',
      description:
        'Touches no database or provider, so it answers while dependencies recover. `/api/v1/operations` reports their state.',
      tag: 'Service',
      access: 'public',
      response: z.object({ status: z.literal('healthy') }),
    },
    // Liveness only: no database or provider access.
    () => ({ status: 'healthy' as const }),
  );
  api.route(
    {
      method: 'GET',
      path: '/api/v1/locales',
      operationId: 'suggestedLocales',
      summary: 'Suggested locales with native names, directions and flags',
      tag: 'Service',
      access: 'public',
      response: z.array(localeSchema),
    },
    () => suggestedLocales(),
  );
  api.route(
    {
      method: 'POST',
      path: '/api/v1/session',
      operationId: 'signIn',
      summary: 'Start a workspace session',
      description:
        'Exchanges a token for an HTTP-only session cookie. Failed attempts are rate limited per client address.',
      tag: 'Session',
      access: 'public',
      body: z.object({ token: z.string().max(500) }),
      response: z.object({ csrf: z.string() }),
    },
    ({ body }, request, reply) => auth.signIn(request, reply, body.token),
  );
  api.route(
    {
      method: 'GET',
      path: '/api/v1/session',
      operationId: 'session',
      summary: 'The calling credential and its limits',
      tag: 'Session',
      access: 'signed-in',
      response: sessionSchema,
    },
    ({ user }) => {
      return {
        owner: user.owner,
        scopes: [...user.scopes],
        locales: user.locales,
        namespaces: user.namespaces,
        csrf: user.csrf ?? null,
        providersReady: config.providersReady,
      };
    },
  );
  api.route(
    {
      method: 'DELETE',
      path: '/api/v1/session',
      operationId: 'signOut',
      summary: 'End this session',
      tag: 'Session',
      access: 'signed-in',
      response: okSchema,
    },
    ({ user }, _request, reply) => {
      auth.signOut(reply, user);
      return { ok: true as const };
    },
  );
  api.route(
    {
      method: 'DELETE',
      path: '/api/v1/sessions',
      operationId: 'signOutEverywhere',
      summary: 'Revoke every session the owner has open',
      tag: 'Session',
      access: 'owner',
      ownerAction: 'sign out every session',
      response: z.object({ revoked: z.number().int() }),
    },
    ({ user }, _request, reply) => {
      const revoked = store.revokeSessions(user.actor);
      auth.signOut(reply, user);
      return { revoked };
    },
  );
}
