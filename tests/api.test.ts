import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteStore } from '../packages/store/src/index.js';
import { createApp } from '../packages/server/src/app.js';
import { projectSchema } from '../packages/core/src/index.js';

const admin = 'test-owner-token-with-at-least-32-characters';
const config = {
  adminToken: admin,
  sessionSecret: 'independent-test-secret-with-at-least-32-chars',
  publicOrigin: 'http://localhost:4310',
  secureCookie: false,
  providersReady: true,
};
test('HTTP authorization isolates projects and enforces individual token scopes', async () => {
  const store = new SqliteStore(':memory:');
  store.saveProject(
    projectSchema.parse({ id: 'first', name: 'First', targetLocales: ['de'], budgetUsd: 1 }),
  );
  store.saveProject(
    projectSchema.parse({ id: 'second', name: 'Second', targetLocales: ['de'], budgetUsd: 1 }),
  );
  const token = store.mintToken('first', ['read', 'export'], Date.now() + 10000);
  const app = await createApp(store, config);
  try {
    assert.equal((await app.inject('/api/v1/projects')).statusCode, 401);
    const headers = { authorization: `Bearer ${token.token}` };
    assert.equal(
      (await app.inject({ url: '/api/v1/projects/first/jobs', headers })).statusCode,
      200,
    );
    assert.equal(
      (await app.inject({ url: '/api/v1/projects/second/jobs', headers })).statusCode,
      404,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/projects/first/sources',
          headers,
          payload: { units: [] },
        })
      ).statusCode,
      403,
    );
    const projects = (await app.inject({ url: '/api/v1/projects', headers })).json();
    assert.equal(projects.length, 1);
    store.revokeToken('first', token.id, 'owner');
    assert.equal(
      (await app.inject({ url: '/api/v1/projects/first/jobs', headers })).statusCode,
      401,
    );
  } finally {
    await app.close();
    store.close();
  }
});
test('review sessions require same-origin login and CSRF protection for mutations', async () => {
  const store = new SqliteStore(':memory:'),
    app = await createApp(store, config);
  try {
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/v1/session', payload: { token: admin } }))
        .statusCode,
      403,
    );
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/session',
      headers: { origin: config.publicOrigin },
      payload: { token: admin },
    });
    assert.equal(login.statusCode, 200);
    const session = login.cookies[0]!,
      cookie = `${session.name}=${session.value}`;
    const project = { name: 'Test', targetLocales: ['de'], budgetUsd: 1 };
    assert.equal(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/v1/projects/test',
          headers: { cookie, origin: config.publicOrigin },
          payload: project,
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/v1/projects/test',
          headers: { cookie, origin: config.publicOrigin, 'x-csrf-token': login.json().csrf },
          payload: project,
        })
      ).statusCode,
      200,
    );
    assert.match(String(login.headers['set-cookie']), /HttpOnly/);
    assert.equal((await app.inject('/')).statusCode, 200);
    const result = await app.inject({ url: '/api/v1/session', headers: { cookie } });
    assert.equal(result.headers['cache-control'], 'no-store');
  } finally {
    await app.close();
    store.close();
  }
});
