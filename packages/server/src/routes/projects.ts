import { z } from 'zod';
import { PIPELINE_REVISION, projectSchema, type Project } from '@everylocale/core';
import { SCOPES } from '@everylocale/store';
import { projectItemParams, projectParams, type RouteContext } from '../http/context.js';
import { okSchema, projectResponseSchema, tokenListSchema } from '../http/schemas.js';
import { projectLocales } from '../locales.js';

const withLocales = <T extends Project>(project: T) => ({
  ...project,
  locales: projectLocales(project.sourceLocale, project.targetLocales),
});

export function projectRoutes({ api, store }: RouteContext) {
  api.route(
    {
      method: 'GET',
      path: '/api/v1/projects',
      operationId: 'listProjects',
      summary: 'Projects the credential can read',
      tag: 'Projects',
      access: 'read',
      response: z.array(
        projectResponseSchema.extend({ spentUsd: z.number(), reservedUsd: z.number() }),
      ),
    },
    ({ user }) => {
      return store
        .listProjects()
        .filter((project) => user.owner || project.id === user.projectId)
        .map(withLocales);
    },
  );
  api.route(
    {
      method: 'GET',
      path: '/api/v1/projects/{project}',
      operationId: 'getProject',
      summary: 'Project configuration',
      tag: 'Projects',
      access: 'read',
      params: projectParams,
      response: projectResponseSchema.extend({ pipelineRevision: z.string() }),
    },
    ({ params }) => {
      return {
        ...withLocales(store.getProject(params.project)),
        pipelineRevision: PIPELINE_REVISION,
      };
    },
  );
  api.route(
    {
      method: 'PUT',
      path: '/api/v1/projects/{project}',
      operationId: 'saveProject',
      summary: 'Create or replace a project',
      description: 'The path id wins over any id in the body.',
      tag: 'Projects',
      access: 'owner',
      ownerAction: 'configure projects',
      params: projectParams,
      body: projectSchema.omit({ id: true }),
      response: projectResponseSchema,
    },
    ({ params, body, user }) => {
      return withLocales(store.saveProject({ ...body, id: params.project }, user.actor));
    },
  );
  api.route(
    {
      method: 'POST',
      path: '/api/v1/projects/{project}/tokens',
      operationId: 'mintToken',
      summary: 'Issue a project token',
      description:
        'The secret is returned once. `locales` and `namespaces` limit what the token can see and change.',
      tag: 'Projects',
      access: 'owner',
      ownerAction: 'issue tokens',
      params: projectParams,
      body: z
        .object({
          scopes: z.array(z.enum(SCOPES)).min(1),
          expiresAt: z.number().describe('Milliseconds since the Unix epoch'),
          locales: z.array(z.string().min(2).max(40)).min(1).max(100).optional(),
          namespaces: z.array(z.string().min(1).max(240)).min(1).max(100).optional(),
        })
        .strict(),
      response: z.object({ id: z.string(), token: z.string(), expiresAt: z.number() }),
    },
    ({ params, body, user }) => {
      return store.mintToken(
        params.project,
        body.scopes,
        body.expiresAt,
        { locales: body.locales ?? null, namespaces: body.namespaces ?? null },
        user.actor,
      );
    },
  );
  api.route(
    {
      method: 'GET',
      path: '/api/v1/projects/{project}/tokens',
      operationId: 'listTokens',
      summary: 'Issued tokens, without their secrets',
      tag: 'Projects',
      access: 'owner',
      ownerAction: 'inspect tokens',
      params: projectParams,
      response: tokenListSchema,
    },
    ({ params }) => store.tokens(params.project),
  );
  api.route(
    {
      method: 'DELETE',
      path: '/api/v1/projects/{project}/tokens/{id}',
      operationId: 'revokeToken',
      summary: 'Revoke a token immediately',
      tag: 'Projects',
      access: 'owner',
      ownerAction: 'revoke tokens',
      params: projectItemParams,
      response: okSchema,
    },
    ({ params, user }) => {
      store.revokeToken(params.project, params.id, user.actor);
      return { ok: true as const };
    },
  );
  api.route(
    {
      method: 'GET',
      path: '/api/v1/projects/{project}/audit',
      operationId: 'auditLog',
      summary: 'Who changed what, newest first',
      tag: 'Projects',
      access: 'read',
      params: projectParams,
      response: z.array(
        z.object({
          actor: z.string(),
          action: z.string(),
          entity_id: z.string(),
          detail: z.string().describe('JSON text'),
          created_at: z.number(),
        }),
      ),
    },
    ({ params }) => store.auditLog(params.project),
  );
}
