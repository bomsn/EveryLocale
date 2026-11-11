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
import { itemId, projectId, type RouteContext } from '../http/context.js';

const MAX_UNITS = 5000;

export function contentRoutes({ app, auth, store, styleNonce }: RouteContext) {
  app.post('/api/v1/projects/:project/sources', async (request) => {
    const id = projectId(request);
    auth.access(request, id, 'import');
    const { units } = z
      .object({ units: z.array(unitSchema).min(1).max(MAX_UNITS) })
      .parse(request.body);
    return store.importSources(id, units);
  });
  app.post('/api/v1/projects/:project/documents', async (request) => {
    const id = projectId(request);
    auth.access(request, id, 'import');
    const body = z
      .object({
        content: z.string(),
        format: z.string().refine(isFormat, 'Unsupported document format'),
        namespace: z.string().min(1).max(160),
      })
      .parse(request.body);
    return store.importDocument(id, body.namespace, body.format, body.content);
  });
  app.get('/api/v1/projects/:project/documents', async (request) => {
    const id = projectId(request);
    auth.access(request, id, 'read');
    return store.documents(id);
  });
  app.get('/api/v1/projects/:project/documents/:id/export/:locale', async (request) => {
    const id = projectId(request);
    const user = auth.access(request, id, 'export');
    const { locale } = z.object({ locale: z.string() }).parse(request.params);
    auth.requireLocale(user, locale);
    return store.exportDocument(id, itemId(request), locale);
  });
  app.post('/api/v1/projects/:project/withdraw', async (request) => {
    const id = projectId(request);
    const user = auth.access(request, id, 'import');
    const { unitIds } = z
      .object({ unitIds: z.array(z.string()).max(MAX_UNITS) })
      .parse(request.body);
    store.withdraw(id, unitIds, user.actor);
    return { ok: true };
  });
  app.post('/api/v1/projects/:project/preview', async (request) => {
    const id = projectId(request);
    const user = auth.access(request, id, 'read');
    const body = z
      .object({
        locale: z.string(),
        message: z.string().max(100000),
        values: z
          .record(z.string(), z.union([z.string().max(1000), z.number(), z.boolean()]))
          .default({}),
      })
      .parse(request.body);
    auth.requireLocale(user, body.locale);
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
    const user = auth.access(request, id, 'read');
    const { namespace, locale } = z
      .object({ namespace: z.string(), locale: z.string() })
      .parse(request.params);
    auth.requireLocale(user, locale);
    const preview = store.previewDocument(id, namespace, locale);
    const frame = (content: string, language: string) =>
      `<!doctype html><html lang="${language}" dir="${localeTraits(language).direction}"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${styleNonce}'; base-uri 'none'; form-action 'none'"><style nonce="${styleNonce}">body{font:16px/1.7 system-ui,sans-serif;padding:20px;color:#26322e;overflow-wrap:anywhere}table{border-collapse:collapse}td,th{border:1px solid #bbc9bd;padding:8px}pre{white-space:pre-wrap}blockquote{border-inline-start:3px solid #bbc9bd;padding-inline-start:16px}</style></head><body>${documentPreview(content, preview.format)}</body></html>`;
    return {
      isPreview: true,
      pendingUnits: preview.pendingUnits,
      sourceRevision: preview.sourceRevision,
      source: frame(preview.source, preview.sourceLocale),
      translation: frame(preview.translation, locale),
    };
  });
}
