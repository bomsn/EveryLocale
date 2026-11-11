import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectSchema, unitSchema } from '../packages/core/dist/index.js';
import { SqliteStore } from '../packages/store/dist/index.js';
import { createApp, type AppConfig } from '../packages/server/dist/app.js';

const admin = 'test-owner-token-with-at-least-32-characters';
const config: AppConfig = {
  adminToken: admin,
  sessionSecret: 'independent-test-secret-with-at-least-32-chars',
  publicOrigin: 'http://localhost:4310',
  secureCookie: false,
  providersReady: true,
  logLevel: 'silent',
  trustProxy: false,
};
const json = (body: string) => JSON.parse(body) as Record<string, unknown>;

function seeded() {
  const store = new SqliteStore(':memory:');
  store.saveProject(
    projectSchema.parse({
      id: 'site',
      name: 'Site',
      targetLocales: ['de', 'fr'],
      budgetUsd: 1,
      policies: [{ match: {}, translate: 'human', approve: 'human' }],
    }),
  );
  store.importSources('site', [
    unitSchema.parse({ id: 'legal:terms', source: 'Terms' }),
    unitSchema.parse({ id: 'common:save', source: 'Save' }),
  ]);
  const jobs = store.enqueue('site', ['legal:terms', 'common:save'], ['de', 'fr'], 'seed');
  return { store, jobs };
}

test('a reviewer token limited to locales and namespaces sees and changes only those messages', async () => {
  const { store, jobs } = seeded();
  const app = await createApp(store, config);
  try {
    const limited = store.mintToken(
      'site',
      ['read', 'review', 'approve', 'export', 'import'],
      Date.now() + 60000,
      {
        locales: ['fr'],
        namespaces: ['legal'],
      },
    );
    const headers = { authorization: `Bearer ${limited.token}` };
    const listed = json((await app.inject({ url: '/api/v1/projects/site/jobs', headers })).body);
    const records = listed.records as Array<{ locale: string; unitId: string }>;
    assert.deepEqual(
      records.map((job) => [job.unitId, job.locale]),
      [['legal:terms', 'fr']],
    );
    const summary = json(
      (await app.inject({ url: '/api/v1/projects/site/summary', headers })).body,
    );
    assert.deepEqual(
      (summary.languages as Array<{ locale: string }>).map((item) => item.locale),
      ['fr'],
    );
    const outside = jobs.find((job) => job.locale === 'de' && job.unitId === 'legal:terms');
    const inside = jobs.find((job) => job.locale === 'fr' && job.unitId === 'legal:terms');
    assert.ok(outside && inside);
    for (const [method, url, payload] of [
      ['GET', `/api/v1/projects/site/jobs/${outside.id}`, undefined],
      ['PATCH', `/api/v1/projects/site/jobs/${outside.id}`, { revision: 0, translation: 'AGB' }],
      ['POST', `/api/v1/projects/site/jobs/${outside.id}/approve`, { revision: 0 }],
      ['GET', '/api/v1/projects/site/exports/de', undefined],
    ] as const)
      assert.equal((await app.inject({ method, url, headers, payload })).statusCode, 404, url);
    assert.equal(
      (await app.inject({ url: '/api/v1/projects/site/bundle', headers })).statusCode,
      403,
    );
    const edited = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/site/jobs/${inside.id}`,
      headers,
      payload: { revision: inside.revision, translation: 'Conditions' },
    });
    assert.equal(edited.statusCode, 200);
    const imported = json(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/projects/site/translations',
          headers,
          payload: {
            locale: 'fr',
            entries: [
              { unitId: 'common:save', translation: 'Enregistrer' },
              { unitId: 'legal:terms', translation: 'Conditions' },
            ],
          },
        })
      ).body,
    );
    assert.deepEqual(imported.unchanged, ['legal:terms']);
    assert.deepEqual(imported.rejected, [{ unitId: 'common:save', reason: 'Outside this token' }]);
    const owner = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/site/tokens',
      headers: { authorization: `Bearer ${admin}` },
      payload: { scopes: ['read'], expiresAt: Date.now() + 1000, locales: ['ja'] },
    });
    assert.equal(owner.statusCode, 422, 'limits name configured locales only');
  } finally {
    await app.close();
    store.close();
  }
});

async function signIn(
  app: Awaited<ReturnType<typeof createApp>>,
  headers: Record<string, string> = {},
) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/session',
    headers: { origin: config.publicOrigin, ...headers },
    payload: { token: admin },
  });
}
const cookieOf = (response: { cookies: Array<{ name: string; value: string }> }) => {
  const cookie = response.cookies.find((item) => item.name === 'el_session');
  assert.ok(cookie);
  return `el_session=${cookie.value}`;
};

test('signing out revokes the session on the server, and the owner can revoke every session', async () => {
  const { store } = seeded();
  const app = await createApp(store, config);
  try {
    const first = cookieOf(await signIn(app));
    const second = cookieOf(await signIn(app));
    assert.equal(
      (await app.inject({ url: '/api/v1/session', headers: { cookie: first } })).statusCode,
      200,
    );
    const csrf = json(
      (await app.inject({ url: '/api/v1/session', headers: { cookie: first } })).body,
    ).csrf;
    assert.equal(typeof csrf, 'string');
    const out = await app.inject({
      method: 'DELETE',
      url: '/api/v1/session',
      headers: { cookie: first, origin: config.publicOrigin, 'x-csrf-token': String(csrf) },
    });
    assert.equal(out.statusCode, 200);
    assert.equal(
      (await app.inject({ url: '/api/v1/session', headers: { cookie: first } })).statusCode,
      401,
      'a copied cookie stops working after sign-out',
    );
    assert.equal(
      (await app.inject({ url: '/api/v1/session', headers: { cookie: second } })).statusCode,
      200,
    );
    const everywhere = await app.inject({
      method: 'DELETE',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${admin}` },
    });
    assert.deepEqual(json(everywhere.body), { revoked: 1 });
    assert.equal(
      (await app.inject({ url: '/api/v1/session', headers: { cookie: second } })).statusCode,
      401,
    );
  } finally {
    await app.close();
    store.close();
  }
});

test('sign-in limits count the real client behind a trusted proxy and ignore spoofed headers otherwise', async () => {
  const failures = async (app: Awaited<ReturnType<typeof createApp>>, client: string) => {
    let last = 0;
    for (let attempt = 0; attempt < 11; attempt++)
      last = (
        await app.inject({
          method: 'POST',
          url: '/api/v1/session',
          remoteAddress: '127.0.0.1',
          headers: { origin: config.publicOrigin, 'x-forwarded-for': client },
          payload: { token: 'wrong-token' },
        })
      ).statusCode;
    return last;
  };
  const { store } = seeded();
  const proxied = await createApp(store, { ...config, trustProxy: '127.0.0.1' });
  const direct = await createApp(store, config);
  try {
    assert.equal(await failures(proxied, '203.0.113.7'), 429);
    const other = await signIn(proxied, { 'x-forwarded-for': '198.51.100.9' });
    assert.equal(other.statusCode, 200, 'another visitor behind the same proxy is unaffected');
    assert.equal(await failures(direct, '203.0.113.7'), 429);
    const spoofed = await signIn(direct, { 'x-forwarded-for': '198.51.100.9' });
    assert.equal(spoofed.statusCode, 429, 'without a trusted proxy the header changes nothing');
  } finally {
    await proxied.close();
    await direct.close();
    store.close();
  }
});

test('an unexpected server failure returns its request id and never the internal message', async () => {
  const { store } = seeded();
  const app = await createApp(store, config);
  store.close();
  try {
    const response = await app.inject({
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${admin}`, 'x-request-id': 'trace-12345678' },
    });
    assert.equal(response.statusCode, 500);
    assert.equal(response.headers['x-request-id'], 'trace-12345678');
    assert.deepEqual(json(response.body), {
      error: {
        code: 'internal',
        message: 'The request could not be completed',
        requestId: 'trace-12345678',
      },
    });
  } finally {
    await app.close();
  }
});
