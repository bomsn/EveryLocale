import { z } from 'zod';
import { ContractError, PIPELINE_REVISION, projectSchema, type Project } from '@everylocale/core';
import type { Scope } from '@everylocale/store';
import { itemId, projectId, type RouteContext } from '../http/context.js';
import { ALL_SCOPES } from '../http/auth.js';
import { projectLocales } from '../locales.js';

const withLocales = <T extends Project>(project: T) => ({
  ...project,
  locales: projectLocales(project.sourceLocale, project.targetLocales),
});

const tokenSchema = z
  .object({
    scopes: z.array(z.enum(ALL_SCOPES as [Scope, ...Scope[]])).min(1),
    expiresAt: z.number(),
    locales: z.array(z.string().min(2).max(40)).min(1).max(100).optional(),
    namespaces: z.array(z.string().min(1).max(240)).min(1).max(100).optional(),
  })
  .strict();

export function projectRoutes({ app, auth, store }: RouteContext) {
  app.get('/api/v1/projects', async (request) => {
    const user = auth.identity(request);
    if (!user.scopes.includes('read'))
      throw new ContractError('forbidden', 'This token cannot read project configuration', 403);
    return store
      .listProjects()
      .filter((project) => user.owner || project.id === user.projectId)
      .map(withLocales);
  });
  app.get('/api/v1/projects/:project', async (request) => {
    const id = projectId(request);
    auth.access(request, id, 'read');
    return { ...withLocales(store.getProject(id)), pipelineRevision: PIPELINE_REVISION };
  });
  app.put('/api/v1/projects/:project', async (request) => {
    const user = auth.owner(request, 'configure projects');
    const project = projectSchema.parse({ ...(request.body as object), id: projectId(request) });
    return withLocales(store.saveProject(project, user.actor));
  });
  app.post('/api/v1/projects/:project/tokens', async (request) => {
    const user = auth.owner(request, 'issue tokens');
    const body = tokenSchema.parse(request.body);
    return store.mintToken(
      projectId(request),
      body.scopes,
      body.expiresAt,
      { locales: body.locales ?? null, namespaces: body.namespaces ?? null },
      user.actor,
    );
  });
  app.get('/api/v1/projects/:project/tokens', async (request) => {
    auth.owner(request, 'inspect tokens');
    return store.tokens(projectId(request));
  });
  app.delete('/api/v1/projects/:project/tokens/:id', async (request) => {
    const user = auth.owner(request, 'revoke tokens');
    store.revokeToken(projectId(request), itemId(request), user.actor);
    return { ok: true };
  });
  app.get('/api/v1/projects/:project/audit', async (request) => {
    const id = projectId(request);
    auth.access(request, id, 'read');
    return store.auditLog(id);
  });
}
