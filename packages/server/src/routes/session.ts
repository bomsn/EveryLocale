import { z } from 'zod';
import type { RouteContext } from '../http/context.js';
import { suggestedLocales } from '../locales.js';

export function sessionRoutes({ app, auth, config, store }: RouteContext) {
  // Liveness only: no database or provider access, so it answers while dependencies recover.
  app.get('/health', async () => ({ status: 'healthy' }));
  app.get('/', async (request, reply) => reply.sendFile('index.html'));
  app.get('/api/v1/locales', async () => suggestedLocales());

  app.post('/api/v1/session', async (request, reply) => {
    const { token } = z.object({ token: z.string().max(500) }).parse(request.body);
    return auth.signIn(request, reply, token);
  });
  app.get('/api/v1/session', async (request) => {
    const user = auth.identity(request);
    return {
      owner: user.owner,
      scopes: user.scopes,
      locales: user.locales,
      namespaces: user.namespaces,
      csrf: user.csrf ?? null,
      providersReady: config.providersReady,
    };
  });
  app.delete('/api/v1/session', async (request, reply) => {
    auth.signOut(reply, auth.identity(request));
    return { ok: true };
  });
  app.delete('/api/v1/sessions', async (request, reply) => {
    const user = auth.owner(request, 'sign out every session');
    const revoked = store.revokeSessions(user.actor);
    auth.signOut(reply, user);
    return { revoked };
  });
}
