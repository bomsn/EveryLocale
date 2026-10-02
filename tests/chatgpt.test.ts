import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore } from '../packages/store/dist/index.js';
import { ChatGptConnection } from '../packages/server/dist/chatgpt.js';
import { modelCall, ProviderError } from '../packages/core/dist/index.js';

test('ChatGPT registers through PKCE, validates identity, encrypts tokens and serializes rotating refresh across processes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'everylocale-chatgpt-'));
  assert.ok(directory.startsWith(join(tmpdir(), 'everylocale-chatgpt-')));
  const store = new SqliteStore(join(directory, 'test.sqlite'));
  const second = new SqliteStore(join(directory, 'test.sqlite'));
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const clientId = 'oaiapp_disposable_fixture',
    secret = '9a'.repeat(32);
  let authorization: URL,
    refreshCalls = 0,
    revocationCalls = 0,
    refreshError = false,
    streamMode = 'complete',
    scope = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  const fixture = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    if (request.url?.endsWith('/jwks.json')) {
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test', alg: 'RS256', use: 'sig' }],
        }),
      );
      return;
    }
    if (request.url?.endsWith('/oauth/revoke')) {
      revocationCalls++;
      response.end();
      return;
    }
    if (request.url?.endsWith('/oauth/token')) {
      const body = Object.fromEntries(new URLSearchParams(raw));
      assert.equal(body.client_id, clientId);
      assert.equal(body.resource, 'https://api.openai.com/v1');
      if (body.grant_type === 'refresh_token') {
        refreshCalls++;
        assert.equal(body.refresh_token, 'disposable-refresh-credential');
        assert.equal(body.scope, undefined);
        if (refreshError) {
          response
            .writeHead(400, { 'content-type': 'application/json' })
            .end(JSON.stringify({ error: 'invalid_grant' }));
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        response.end(
          JSON.stringify({
            access_token: 'disposable-rotated-access',
            refresh_token: 'disposable-rotated-refresh',
            token_type: 'Bearer',
            expires_in: 3600,
            scope,
          }),
        );
        return;
      }
      assert.equal(body.redirect_uri, authorization!.searchParams.get('redirect_uri'));
      assert.equal(
        createHash('sha256').update(body.code_verifier!).digest('base64url'),
        authorization!.searchParams.get('code_challenge'),
      );
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test' })).toString(
        'base64url',
      );
      const payload = Buffer.from(
        JSON.stringify({
          iss: 'https://auth.openai.com',
          aud: clientId,
          exp: Math.floor(Date.now() / 1000) + 300,
          nonce: authorization!.searchParams.get('nonce'),
          sub: 'verified-subject',
          email: 'fixture@example.invalid',
        }),
      ).toString('base64url');
      const jwt = `${header}.${payload}.${sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url')}`;
      response.end(
        JSON.stringify({
          access_token: 'disposable-access-credential',
          refresh_token: 'disposable-refresh-credential',
          id_token: jwt,
          token_type: 'Bearer',
          expires_in: 1,
          scope,
        }),
      );
      return;
    }
    if (request.url === '/v1/models') {
      response.end(
        JSON.stringify({
          models: [
            { slug: 'discovered-model', display_name: 'Discovered model', visibility: 'list' },
            { slug: 'hidden-model', display_name: 'Hidden', visibility: 'hidden' },
          ],
        }),
      );
      return;
    }
    if (request.url === '/v1/responses') {
      const body = JSON.parse(raw);
      requests.push({ path: request.url, body });
      assert.equal(body.store, false);
      assert.equal(body.stream, true);
      assert.equal(body.model, 'discovered-model');
      for (const forbidden of [
        'max_output_tokens',
        'temperature',
        'top_p',
        'previous_response_id',
        'background',
      ])
        assert.equal(body[forbidden], undefined);
      response.setHeader('content-type', 'text/event-stream');
      response.write(
        'data: ' +
          JSON.stringify({ type: 'response.output_text.delta', delta: 'partial invalid text' }) +
          '\n\n',
      );
      if (streamMode === 'complete')
        response.end(
          'data: ' +
            JSON.stringify({
              type: 'response.completed',
              response: {
                output: [
                  {
                    type: 'message',
                    content: [{ type: 'output_text', text: '{"translation":"Willkommen"}' }],
                  },
                ],
                usage: { input_tokens: 20, output_tokens: 10 },
              },
            }) +
            '\n\n',
        );
      else if (streamMode === 'quota')
        response.end(
          'data: ' +
            JSON.stringify({
              type: 'response.failed',
              response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } },
            }) +
            '\n\n',
        );
      else response.end();
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(fixture.address() as { port: number }).port}`;
  const request: typeof fetch = (input, init) => {
    const url = new URL(String(input));
    assert.ok(['auth.openai.com', 'api.openai.com'].includes(url.hostname));
    return fetch(origin + url.pathname, init);
  };
  const connection = new ChatGptConnection(store, secret, request),
    other = new ChatGptConnection(second, secret, request);
  const connect = async (accountId?: string) =>
    connection.connect({
      accountId,
      label: 'Fixture account',
      show: async (value) => {
        authorization = new URL(value);
        assert.equal(authorization.origin, 'https://auth.openai.com');
        assert.equal(
          authorization.searchParams.get('client_id'),
          accountId ?? 'dynamic_agent_client',
        );
        assert.equal(authorization.searchParams.has('id_token_hint'), false);
        const callback = new URL(authorization.searchParams.get('redirect_uri')!);
        callback.searchParams.set('code', 'disposable-code');
        callback.searchParams.set('client_id', clientId);
        callback.searchParams.set('state', 'invalid');
        assert.equal((await fetch(callback)).status, 400);
        callback.searchParams.set('state', authorization.searchParams.get('state')!);
        assert.equal((await fetch(callback)).status, 200);
      },
    });
  try {
    const registered = await connect();
    assert.equal(registered.enabled, true);
    assert.equal(registered.firstUse, true);
    assert.equal(connection.hostId(), other.hostId());
    assert.deepEqual(
      await Promise.all([connection.accessToken(clientId), other.accessToken(clientId)]),
      ['disposable-rotated-access', 'disposable-rotated-access'],
    );
    assert.equal(refreshCalls, 1);
    assert.equal((await connection.models(clientId)).length, 1);
    assert.equal(
      (
        await modelCall(connection.provider(clientId, 'discovered-model'), 'Translate', {
          source: 'Welcome',
        })
      ).value instanceof Object,
      true,
    );
    assert.equal(requests.length, 1);
    streamMode = 'interrupted';
    await assert.rejects(
      modelCall(connection.provider(clientId, 'discovered-model'), 'Translate', {}),
      /without confirmed completion/,
    );
    streamMode = 'quota';
    await assert.rejects(
      modelCall(connection.provider(clientId, 'discovered-model'), 'Translate', {}),
      /usage_limit_exceeded/,
    );
    assert.equal(other.available(clientId), false);
    await connection.resume(clientId);
    assert.equal(connection.available(clientId), true);
    assert.equal((await connect(clientId)).firstUse, false);
    refreshError = true;
    await assert.rejects(connection.accessToken(clientId), /invalid_grant/);
    assert.equal(connection.accounts()[0]!.connected, false);
    assert.equal(connection.accounts()[0]!.id, clientId);
    refreshError = false;
    scope = 'openid profile email offline_access';
    await connect(clientId);
    assert.equal(connection.available(clientId), false);
    await assert.rejects(connection.accessToken(clientId), /disabled/);
    assert.equal((await connection.disconnect(clientId)).revoked, true);
    assert.equal(revocationCalls, 1);
    assert.equal(connection.accounts().length, 1);
    assert.throws(() => new ChatGptConnection(store, 'ab'.repeat(32)).accounts(), /decrypted/);
    await store.backup(join(directory, 'backup.sqlite'));
    const bytes = await readFile(join(directory, 'backup.sqlite'));
    assert.equal(bytes.includes(Buffer.from('disposable-access-credential')), false);
    assert.equal(bytes.includes(Buffer.from('fixture@example.invalid')), false);
    assert.equal(bytes.includes(Buffer.from('verified-subject')), false);
  } finally {
    store.close();
    second.close();
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
