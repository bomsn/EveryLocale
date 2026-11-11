import { z } from 'zod';
import {
  ContractError,
  documentPreview,
  isFormat,
  localeTraits,
  previewArguments,
  previewMessage,
  unitSchema,
} from '@everylocale/core';
import { documentOptionsSchema } from '@everylocale/store';
import { projectParams, type RouteContext } from '../http/context.js';
import { documentSchema, okSchema, sourceImportSchema } from '../http/schemas.js';

const MAX_UNITS = 5000;
const namespaceParams = projectParams.extend({ namespace: z.string().min(1).max(160) });

export function contentRoutes({ api, auth, store, styleNonce }: RouteContext) {
  api.route(
    {
      method: 'POST',
      path: '/api/v1/projects/{project}/sources',
      operationId: 'importSources',
      summary: 'Add or update source messages',
      description: 'Changed messages make their translations stale; identical ones are no-ops.',
      tag: 'Content',
      access: 'import',
      params: projectParams,
      body: z.object({ units: z.array(unitSchema).min(1).max(MAX_UNITS) }),
      response: sourceImportSchema,
    },
    ({ params, body }) => store.importSources(params.project, body.units),
  );
  api.route(
    {
      method: 'POST',
      path: '/api/v1/projects/{project}/documents',
      operationId: 'importDocument',
      summary: 'Add or replace a source document of a registered format',
      tag: 'Content',
      access: 'import',
      params: projectParams,
      body: z.object({
        content: z.string(),
        format: z.string().refine(isFormat, 'Unsupported document format'),
        namespace: z.string().min(1).max(160),
        options: documentOptionsSchema.default({}),
      }),
      response: sourceImportSchema.extend({
        units: z.array(z.string()),
        sourceRevision: z.string(),
      }),
    },
    ({ params, body }) =>
      store.importDocument(params.project, body.namespace, body.format, body.content, body.options),
  );
  api.route(
    {
      method: 'GET',
      path: '/api/v1/projects/{project}/documents',
      operationId: 'listDocuments',
      summary: 'Source documents and the messages extracted from each',
      tag: 'Content',
      access: 'read',
      params: projectParams,
      response: z.array(documentSchema),
    },
    ({ params }) => store.documents(params.project),
  );
  api.route(
    {
      method: 'GET',
      path: '/api/v1/projects/{project}/documents/{id}/export/{locale}',
      operationId: 'exportDocument',
      summary: 'A document rendered with its approved translations',
      tag: 'Content',
      access: 'export',
      params: projectParams.extend({
        id: z.string().describe('Document namespace'),
        locale: z.string(),
      }),
      response: z.object({
        namespace: z.string(),
        locale: z.string(),
        sourceRevision: z.string(),
        revision: z.string(),
        content: z.string(),
      }),
    },
    ({ params, user }) => {
      auth.requireLocale(user, params.locale);
      return store.exportDocument(params.project, params.id, params.locale);
    },
  );
  api.route(
    {
      method: 'DELETE',
      path: '/api/v1/projects/{project}/documents/{namespace}',
      operationId: 'removeDocument',
      summary: 'Withdraw a document and its messages',
      description: 'Published revisions stay available until replaced.',
      tag: 'Content',
      access: 'import',
      params: namespaceParams,
      response: okSchema,
    },
    ({ params, user }) => {
      store.removeDocument(params.project, params.namespace, user.actor);
      return { ok: true as const };
    },
  );
  api.route(
    {
      method: 'POST',
      path: '/api/v1/projects/{project}/withdraw',
      operationId: 'withdrawSources',
      summary: 'Withdraw source messages',
      tag: 'Content',
      access: 'import',
      params: projectParams,
      body: z.object({ unitIds: z.array(z.string()).max(MAX_UNITS) }),
      response: okSchema,
    },
    ({ params, body, user }) => {
      store.withdraw(params.project, body.unitIds, user.actor);
      return { ok: true as const };
    },
  );
  api.route(
    {
      method: 'POST',
      path: '/api/v1/projects/{project}/preview',
      operationId: 'previewMessage',
      summary: 'Format a message in a locale with sample values',
      tag: 'Content',
      access: 'read',
      params: projectParams,
      body: z.object({
        locale: z.string(),
        message: z.string().max(100000),
        values: z
          .record(z.string(), z.union([z.string().max(1000), z.number(), z.boolean()]))
          .default({}),
      }),
      response: z.object({
        text: z.string(),
        arguments: z.array(
          z.object({
            name: z.string(),
            type: z.enum(['text', 'number']),
            value: z.union([z.string(), z.number()]).describe('Sample value used for the preview'),
          }),
        ),
      }),
    },
    ({ params, body, user }) => {
      auth.requireLocale(user, body.locale);
      if (!store.getProject(params.project).targetLocales.includes(body.locale))
        throw new ContractError('locale', 'Locale is not configured', 422);
      try {
        const argumentsList = previewArguments(body.message);
        const values = {
          ...Object.fromEntries(argumentsList.map((argument) => [argument.name, argument.value])),
          ...body.values,
        };
        return {
          text: previewMessage(body.message, body.locale, values),
          arguments: argumentsList,
        };
      } catch {
        throw new ContractError(
          'preview',
          'Provide values for all message variables and preserve valid ICU syntax',
          422,
        );
      }
    },
  );
  api.route(
    {
      method: 'GET',
      path: '/api/v1/projects/{project}/documents/{namespace}/preview/{locale}',
      operationId: 'previewDocument',
      summary: 'Source and translated document as sandboxed HTML',
      tag: 'Content',
      access: 'read',
      params: namespaceParams.extend({ locale: z.string() }),
      response: z.object({
        isPreview: z.literal(true),
        pendingUnits: z.array(z.string()),
        sourceRevision: z.string(),
        source: z.string().describe('HTML document'),
        translation: z.string().describe('HTML document'),
      }),
    },
    ({ params, user }) => {
      auth.requireLocale(user, params.locale);
      const preview = store.previewDocument(params.project, params.namespace, params.locale);
      const frame = (content: string, language: string) =>
        `<!doctype html><html lang="${language}" dir="${localeTraits(language).direction}"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${styleNonce}'; base-uri 'none'; form-action 'none'"><style nonce="${styleNonce}">body{font:16px/1.7 system-ui,sans-serif;padding:20px;color:#26322e;overflow-wrap:anywhere}table{border-collapse:collapse}td,th{border:1px solid #bbc9bd;padding:8px}pre{white-space:pre-wrap}blockquote{border-inline-start:3px solid #bbc9bd;padding-inline-start:16px}</style></head><body>${documentPreview(content, preview.format)}</body></html>`;
      return {
        isPreview: true as const,
        pendingUnits: preview.pendingUnits,
        sourceRevision: preview.sourceRevision,
        source: frame(preview.source, preview.sourceLocale),
        translation: frame(preview.translation, params.locale),
      };
    },
  );
}
