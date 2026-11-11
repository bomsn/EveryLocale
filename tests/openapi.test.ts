import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { findingSchema, type Finding } from '../packages/core/dist/index.js';
import { SqliteStore } from '../packages/store/dist/index.js';
import { createApp } from '../packages/server/dist/app.js';
import { Api, ResponseContractError } from '../packages/server/dist/http/contract.js';
import { OPENAPI_PATH, openApiText } from '../tools/openapi.ts';

type Document = {
  openapi: string;
  paths: Record<
    string,
    Record<
      string,
      {
        operationId: string;
        parameters?: Array<{ name: string; in: string }>;
        security?: unknown[];
      }
    >
  >;
  components: { schemas: Record<string, unknown> };
};

test('the committed OpenAPI document is the one the service serves', async () => {
  assert.equal(
    await readFile(OPENAPI_PATH, 'utf8'),
    await openApiText(),
    'Run pnpm codegen and commit docs/openapi.json',
  );
});

test('every operation is unique, declares its path parameters and resolves its references', async () => {
  const document = JSON.parse(await readFile(OPENAPI_PATH, 'utf8')) as Document;
  assert.equal(document.openapi, '3.1.0');
  const ids = new Set<string>();
  for (const [path, operations] of Object.entries(document.paths))
    for (const [method, operation] of Object.entries(operations)) {
      assert.ok(!ids.has(operation.operationId), operation.operationId);
      ids.add(operation.operationId);
      const declared = (operation.parameters ?? [])
        .filter((parameter) => parameter.in === 'path')
        .map((parameter) => parameter.name)
        .sort();
      const templated = [...path.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
      assert.deepEqual(declared, templated, `${method} ${path}`);
    }
  const text = JSON.stringify(document);
  for (const [, name] of text.matchAll(/"#\/components\/schemas\/(\w+)"/g))
    assert.ok(name && document.components.schemas[name], `missing component ${String(name)}`);
  assert.doesNotMatch(text, /#\/\$defs\//);
  assert.deepEqual(document.paths['/health']?.get?.security, [], 'public endpoints need nothing');
  assert.ok(ids.has('exportBundle') && ids.has('openApi'));
});

test('a response outside its declared schema fails instead of reaching the client', async () => {
  let handler: ((request: unknown, reply: unknown) => Promise<unknown>) | undefined;
  const host = {
    route: (options: { handler: (request: unknown, reply: unknown) => Promise<unknown> }) => {
      handler = options.handler;
    },
  };
  const api = new Api(host as never, () => undefined, true);
  api.route(
    {
      method: 'GET',
      path: '/drift',
      operationId: 'drift',
      summary: 'Returns a value its contract does not allow',
      tag: 'Test',
      access: 'public',
      response: findingSchema,
    },
    // The handler type forbids this; the cast stands in for a store that drifted at runtime.
    () => ({ severity: 'fatal', code: 'x', message: 'y' }) as unknown as Finding,
  );
  assert.ok(handler);
  await assert.rejects(
    handler({ params: {}, query: {}, headers: {} }, {}),
    (error: unknown) =>
      error instanceof ResponseContractError &&
      /drift returned a response outside its contract: severity/.test(error.message),
  );
});

test('credentials are checked before a body is validated', async () => {
  const store = new SqliteStore(':memory:');
  const app = await createApp(store, {
    adminToken: 'owner-token-with-at-least-32-characters',
    sessionSecret: 'session-secret-with-at-least-32-characters',
    publicOrigin: 'http://127.0.0.1:4310',
    secureCookie: false,
    providersReady: true,
    logLevel: 'silent',
    trustProxy: false,
  });
  try {
    const anonymous = await app.inject({
      method: 'PUT',
      url: '/api/v1/projects/shop',
      payload: { name: '' },
    });
    assert.equal(anonymous.statusCode, 401, 'no validation detail for anonymous callers');
    const owner = await app.inject({
      method: 'PUT',
      url: '/api/v1/projects/shop',
      headers: { authorization: 'Bearer owner-token-with-at-least-32-characters' },
      payload: { name: '' },
    });
    assert.equal(owner.statusCode, 422);
    assert.ok(owner.json<{ error: { fields: string[] } }>().error.fields.includes('name'));
  } finally {
    await app.close();
    store.close();
  }
});
