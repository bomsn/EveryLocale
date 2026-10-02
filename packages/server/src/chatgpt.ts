import {
  randomBytes,
  randomUUID,
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  createHash,
  verify,
  timingSafeEqual,
} from 'node:crypto';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { ProviderError, type ProviderConfig, type ModelResult } from '@everylocale/core';
import type { SqliteStore } from '@everylocale/store';

const ISSUER = 'https://auth.openai.com';
const API = 'https://api.openai.com/v1';
const AUTH = `${ISSUER}/api/accounts/authorize`;
const TOKEN = `${ISSUER}/api/accounts/oauth/token`;
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const credentialsSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  id_token: z.string().optional(),
  token_type: z.literal('Bearer'),
  expires_in: z.number().positive(),
  scope: z.string(),
  earliest_refresh_at: z.number().optional(),
});
type Credentials = z.infer<typeof credentialsSchema> & { expiresAt: number };
type Account = {
  id: string;
  subject: string;
  email: string;
  label: string;
  hostId: string;
  credentials?: Credentials;
  paused?: string;
  welcomed?: boolean;
};
type Fetcher = typeof fetch;
const safeCode = (value: unknown) =>
  typeof value === 'string' && /^[a-z0-9_]{1,100}$/.test(value) ? value : 'unknown_error';
const terminalRefresh = new Set([
  'invalid_grant',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'refresh_token_reused',
]);

/** Credentials are encrypted at rest; SQLite leases serialize rotating refreshes across processes. */
export class ChatGptConnection {
  private key: Buffer;
  constructor(
    private store: SqliteStore,
    secret: string,
    private request: Fetcher = fetch,
  ) {
    if (!/^[a-f0-9]{64}$/i.test(secret))
      throw new Error('ChatGPT credential key must be 32 random bytes encoded as hex');
    this.key = Buffer.from(secret, 'hex');
  }
  private read<T>(id: string): T | undefined {
    const row = this.store.db.prepare('SELECT data FROM auth_vault WHERE id=?').get(id) as
      | { data: string }
      | undefined;
    if (!row) return;
    try {
      const data = Buffer.from(row.data, 'base64');
      const cipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12));
      cipher.setAAD(Buffer.from(id));
      cipher.setAuthTag(data.subarray(12, 28));
      return JSON.parse(
        Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8'),
      ) as T;
    } catch {
      throw new Error(
        'ChatGPT credentials could not be decrypted; retain the original encryption key',
      );
    }
  }
  private write(id: string, value: unknown) {
    const nonce = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(Buffer.from(id));
    const encoded = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    const data = Buffer.concat([nonce, cipher.getAuthTag(), encoded]).toString('base64');
    this.store.db
      .prepare(
        'INSERT INTO auth_vault(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      )
      .run(id, data);
  }
  hostId() {
    return this.store.db
      .transaction(() => {
        let id = this.read<string>('host');
        if (!id) {
          id = `urn:uuid:${randomUUID()}`;
          this.write('host', id);
        }
        return id;
      })
      .immediate();
  }
  private account(id: string): Account {
    const account = this.read<Account>(`account:${id}`);
    if (!account)
      throw new ProviderError('Choose a saved ChatGPT account or continue with ChatGPT');
    return account;
  }
  accounts() {
    const rows = this.store.db
      .prepare("SELECT id FROM auth_vault WHERE id LIKE 'account:%' ORDER BY id")
      .all() as { id: string }[];
    return rows.map(({ id }) => {
      const account = this.account(id.slice(8));
      return {
        id: account.id,
        label: account.label,
        email: account.email,
        connected: Boolean(account.credentials),
        enabled:
          account.credentials?.scope.split(' ').includes('chatgpt.tokens.use.direct') ?? false,
        paused: account.paused ?? null,
      };
    });
  }
  available(id: string) {
    const account = this.account(id);
    return Boolean(
      account.credentials?.scope.split(' ').includes('chatgpt.tokens.use.direct') &&
      !account.paused,
    );
  }
  private async locked<T>(id: string, operation: (token: string) => Promise<T>) {
    const token = randomUUID(),
      deadline = Date.now() + 20000;
    for (;;) {
      const acquired = this.store.db
        .prepare(
          `INSERT INTO auth_locks(id,token,expires_at) VALUES(?,?,?)
        ON CONFLICT(id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE auth_locks.expires_at<=?`,
        )
        .run(id, token, Date.now() + 90000, Date.now());
      if (acquired.changes) break;
      if (Date.now() >= deadline)
        throw new ProviderError('ChatGPT connection is busy; retry later', true, 1000);
      await delay(100);
    }
    try {
      return await operation(token);
    } finally {
      this.store.db.prepare('DELETE FROM auth_locks WHERE id=? AND token=?').run(id, token);
    }
  }
  private saveLocked(id: string, token: string, account: Account) {
    this.store.db
      .transaction(() => {
        const lock = this.store.db
          .prepare('SELECT token FROM auth_locks WHERE id=? AND expires_at>?')
          .get(id, Date.now()) as { token: string } | undefined;
        if (lock?.token !== token)
          throw new ProviderError('ChatGPT credential lease expired; restart the connection');
        this.write(`account:${id}`, account);
      })
      .immediate();
  }
  private async form(url: string, body: Record<string, string>) {
    let response: Response;
    try {
      response = await this.request(url, {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new ProviderError('ChatGPT connection is temporarily unavailable', true, 2000);
    }
    const data = await this.json(response);
    if (!response.ok) {
      const code = safeCode((data as { error?: unknown }).error);
      throw new ProviderError(`ChatGPT authorization: ${code}`, response.status >= 500, 2000);
    }
    return credentialsSchema.parse(data);
  }
  private async json(response: Response): Promise<unknown> {
    const reader = response.body?.getReader();
    let size = 0;
    const parts: Uint8Array[] = [];
    try {
      if (reader)
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 1000000) {
            await reader.cancel();
            throw new Error('size');
          }
          parts.push(part.value);
        }
      return JSON.parse(Buffer.concat(parts).toString('utf8'));
    } catch {
      throw new ProviderError('ChatGPT returned an invalid response', response.status >= 500);
    }
  }
  async accessToken(id: string) {
    return this.locked(id, async (lease) => {
      const account = this.account(id),
        saved = account.credentials;
      if (!saved || account.paused || !saved.scope.split(' ').includes('chatgpt.tokens.use.direct'))
        throw new ProviderError(
          'ChatGPT plan usage is disabled or paused; check connection settings',
        );
      if (saved.expiresAt > Date.now() + 60000) return saved.access_token;
      try {
        const tokens = await this.form(TOKEN, {
          grant_type: 'refresh_token',
          client_id: account.id,
          refresh_token: saved.refresh_token,
          resource: API,
        });
        account.credentials = {
          ...tokens,
          id_token: tokens.id_token ?? saved.id_token,
          expiresAt: Date.now() + tokens.expires_in * 1000,
        };
        this.saveLocked(id, lease, account);
        return tokens.access_token;
      } catch (error) {
        if (
          error instanceof ProviderError &&
          terminalRefresh.has(error.message.replace('ChatGPT authorization: ', ''))
        ) {
          delete account.credentials;
          account.paused = 'sign_in_required';
          this.saveLocked(id, lease, account);
        }
        throw error;
      }
    });
  }
  private async identity(jwt: string, clientId: string, nonce: string) {
    if (jwt.length > 32000) throw new Error('Invalid identity token');
    const parts = jwt.split('.');
    if (parts.length !== 3) throw new Error('Invalid identity token');
    const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8')) as {
      alg: string;
      kid: string;
    };
    const claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as {
      iss: string;
      aud: string | string[];
      exp: number;
      nbf?: number;
      nonce: string;
      sub: string;
      email?: string;
    };
    if (header.alg !== 'RS256' || typeof header.kid !== 'string')
      throw new Error('Unsupported identity signature');
    const response = await this.request(`${ISSUER}/.well-known/jwks.json`, {
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('Identity verification temporarily unavailable');
    const keys = (await this.json(response)) as {
      keys: Array<{ kid: string; kty: string; use?: string; alg?: string; n: string; e: string }>;
    };
    const jwk = keys.keys.find(
      (key) =>
        key.kid === header.kid &&
        key.kty === 'RSA' &&
        (!key.use || key.use === 'sig') &&
        (!key.alg || key.alg === 'RS256'),
    );
    if (
      !jwk ||
      !verify(
        'RSA-SHA256',
        Buffer.from(`${parts[0]}.${parts[1]}`),
        createPublicKey({ key: jwk, format: 'jwk' }),
        Buffer.from(parts[2]!, 'base64url'),
      )
    )
      throw new Error('Identity signature could not be verified');
    if (
      claims.iss !== ISSUER ||
      !(Array.isArray(claims.aud) ? claims.aud : [claims.aud]).includes(clientId) ||
      !Number.isFinite(claims.exp) ||
      claims.exp <= Date.now() / 1000 ||
      claims.nonce !== nonce ||
      typeof claims.sub !== 'string' ||
      !claims.sub ||
      (claims.nbf !== undefined && claims.nbf > Date.now() / 1000 + 30)
    )
      throw new Error('Identity token does not match this sign-in');
    return claims;
  }
  async connect(options: {
    accountId?: string;
    label?: string;
    consent?: boolean;
    port?: number;
    show: (url: string) => void | Promise<void>;
  }) {
    if (
      options.port !== undefined &&
      (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535)
    )
      throw new Error('Callback port must be between 1024 and 65535');
    const existing = options.accountId ? this.account(options.accountId) : undefined;
    const state = randomBytes(32).toString('base64url'),
      nonce = randomBytes(32).toString('base64url'),
      verifier = randomBytes(32).toString('base64url');
    let used = false;
    let settle!: (value: { id: string; enabled: boolean; firstUse: boolean }) => void,
      reject!: (error: Error) => void;
    const completed = new Promise<{ id: string; enabled: boolean; firstUse: boolean }>(
      (yes, no) => {
        settle = yes;
        reject = no;
      },
    );
    // Callback failures may arrive before an asynchronous authorization display finishes.
    void completed.catch(() => {});
    let redirect = '';
    const server = createServer(async (request, response) => {
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
      try {
        const url = new URL(request.url ?? '', redirect);
        if (request.method !== 'GET' || url.pathname !== '/auth/callback' || used) {
          response.writeHead(404).end('Not found');
          return;
        }
        const actual = url.searchParams.get('state') ?? '';
        if (
          Buffer.byteLength(actual) !== Buffer.byteLength(state) ||
          !timingSafeEqual(Buffer.from(actual), Buffer.from(state))
        ) {
          response.writeHead(400).end('Invalid sign-in state');
          return;
        }
        used = true;
        if (url.searchParams.has('error'))
          throw new Error('ChatGPT sign-in was declined. Your existing connection was preserved.');
        const id = url.searchParams.get('client_id') ?? existing?.id;
        const code = url.searchParams.get('code');
        if (
          !id ||
          !/^oaiapp_[A-Za-z0-9_-]+$/.test(id) ||
          !code ||
          code.length > 16000 ||
          (existing && id !== existing.id)
        )
          throw new Error('Incomplete or mismatched ChatGPT registration');
        const tokens = await this.form(TOKEN, {
          grant_type: 'authorization_code',
          client_id: id,
          code,
          code_verifier: verifier,
          redirect_uri: redirect,
          resource: API,
        });
        if (!tokens.id_token) throw new Error('ChatGPT did not return a verifiable identity');
        const identity = await this.identity(tokens.id_token, id, nonce);
        const previous = this.read<Account>(`account:${id}`);
        if (
          (existing && existing.subject !== identity.sub) ||
          (previous && previous.subject !== identity.sub)
        )
          throw new Error('ChatGPT identity differs from the selected account');
        const enabled = tokens.scope.split(' ').includes('chatgpt.tokens.use.direct'),
          firstUse = enabled && !previous?.welcomed;
        await this.locked(id, async (lease) => {
          this.saveLocked(id, lease, {
            id,
            subject: identity.sub,
            email: identity.email ?? '',
            label: options.label?.slice(0, 120) ?? previous?.label ?? `ChatGPT ${id.slice(-8)}`,
            hostId: this.hostId(),
            credentials: { ...tokens, expiresAt: Date.now() + tokens.expires_in * 1000 },
            welcomed: enabled || previous?.welcomed,
          });
        });
        response
          .writeHead(200)
          .end(
            enabled
              ? 'Connected. Eligible requests use your ChatGPT plan. Manage usage at https://chatgpt.com/settings/usage. You may close this tab.'
              : 'Signed in. ChatGPT plan usage is disabled. Enable permission or use another provider. You may close this tab.',
          );
        settle({ id, enabled, firstUse });
      } catch {
        response.writeHead(400).end('Sign-in could not be completed. Return to EveryLocale.');
        reject(
          new Error('ChatGPT sign-in could not be completed; existing accounts were preserved'),
        );
      }
    });
    await new Promise<void>((yes, no) => {
      server.once('error', no);
      server.listen(options.port ?? 0, '127.0.0.1', yes);
    });
    redirect = `http://127.0.0.1:${(server.address() as { port: number }).port}/auth/callback`;
    const timer = setTimeout(() => reject(new Error('ChatGPT sign-in timed out')), 300000);
    try {
      const url = new URL(AUTH);
      const parameters = {
        client_id: existing?.id ?? 'dynamic_agent_client',
        ext_agent_host_id: this.hostId(),
        response_type: 'code',
        redirect_uri: redirect,
        scope: SCOPES,
        resource: API,
        state,
        nonce,
        code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        ...(!existing ? { agent_name_hint: 'EveryLocale' } : {}),
        ...(options.consent ? { prompt: 'consent' } : {}),
      };
      for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
      // No ID-token hint appears in this URL, so terminal output cannot disclose credentials.
      await options.show(url.toString());
      return await completed;
    } finally {
      clearTimeout(timer);
      server.closeAllConnections();
      await new Promise<void>((yes) => server.close(() => yes()));
    }
  }
  async models(id: string) {
    const response = await this.request(`${API}/models`, {
      redirect: 'error',
      headers: { authorization: `Bearer ${await this.accessToken(id)}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new ProviderError(
        `ChatGPT model discovery returned HTTP ${response.status}`,
        response.status >= 500,
      );
    const data = z
      .object({
        models: z.array(
          z.object({ slug: z.string().min(1), display_name: z.string(), visibility: z.string() }),
        ),
      })
      .parse(await this.json(response));
    return data.models.filter((model) => model.visibility === 'list');
  }
  async disconnect(id: string) {
    return this.locked(id, async (lease) => {
      const account = this.account(id);
      let revoked = !account.credentials;
      if (account.credentials)
        try {
          const response = await this.request(`${ISSUER}/api/accounts/oauth/revoke`, {
            method: 'POST',
            redirect: 'error',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              token: account.credentials.refresh_token,
              token_type_hint: 'refresh_token',
              client_id: id,
            }),
            signal: AbortSignal.timeout(15000),
          });
          revoked = response.status === 200;
          await response.body?.cancel();
        } catch {}
      delete account.credentials;
      account.paused = 'sign_in_required';
      this.saveLocked(id, lease, account);
      return { revoked };
    });
  }
  async resume(id: string) {
    await this.locked(id, async (lease) => {
      const account = this.account(id);
      delete account.paused;
      this.saveLocked(id, lease, account);
    });
  }
  private async failure(
    id: string,
    status: number,
    code: unknown,
    uncertain = false,
    requestId?: string | null,
  ): Promise<never> {
    const safe = safeCode(code);
    if (
      status === 401 ||
      [
        'subscription_sharing_usage_limit_exceeded',
        'subscription_sharing_user_not_eligible',
      ].includes(safe)
    )
      await this.locked(id, async (lease) => {
        const account = this.account(id);
        account.paused = safe;
        this.saveLocked(id, lease, account);
      });
    const retryable =
      status >= 500 ||
      ['server_error', 'service_unavailable', 'temporarily_unavailable'].includes(safe);
    const diagnostic =
      requestId && /^[A-Za-z0-9_-]{1,120}$/.test(requestId) ? `; request ${requestId}` : '';
    throw new ProviderError(
      `ChatGPT ${safe} (HTTP ${status}${diagnostic}); manage usage at https://chatgpt.com/settings/usage`,
      retryable,
      2000,
      uncertain,
    );
  }
  provider(id: string, model: string): ProviderConfig {
    this.account(id);
    return {
      baseUrl: API,
      model,
      inputPrice: 0,
      outputPrice: 0,
      available: () => this.available(id),
      transport: async (system, payload, signal) => {
        const access = await this.accessToken(id),
          timeout = AbortSignal.timeout(55000);
        let response: Response;
        try {
          response = await this.request(`${API}/responses`, {
            method: 'POST',
            redirect: 'error',
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
            headers: { 'content-type': 'application/json', authorization: `Bearer ${access}` },
            body: JSON.stringify({
              model,
              instructions: system,
              input: [{ role: 'user', content: JSON.stringify(payload) }],
              store: false,
              stream: true,
            }),
          });
        } catch {
          throw new ProviderError('ChatGPT request interrupted', true, 2000, true);
        }
        if (!response.ok) {
          let code: unknown;
          try {
            code = ((await this.json(response)) as { error?: { code?: unknown } }).error?.code;
          } catch {}
          return this.failure(
            id,
            response.status,
            code,
            response.status >= 500,
            response.headers.get('x-request-id'),
          );
        }
        if (!response.body) throw new ProviderError('ChatGPT stream is missing', true, 2000, true);
        const reader = response.body.getReader(),
          decoder = new TextDecoder();
        let pending = '',
          size = 0,
          completed: ModelResult | undefined;
        const process = (block: string) => {
          const data = block
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
          if (!data || data === '[DONE]') return;
          const event = JSON.parse(data) as {
            type: string;
            response?: {
              error?: { code?: unknown };
              output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>;
              usage?: { input_tokens: number; output_tokens: number };
            };
            error?: { code?: unknown };
            code?: unknown;
          };
          if (event.type === 'response.failed' || event.type === 'error')
            return { failure: event.response?.error?.code ?? event.error?.code ?? event.code };
          if (event.type === 'response.incomplete')
            throw new ProviderError('ChatGPT response is incomplete', false, 0, true);
          if (event.type === 'response.completed') {
            const output =
              event.response?.output
                ?.filter((item) => item.type === 'message')
                .flatMap((item) => item.content ?? [])
                .filter((item) => item.type === 'output_text')
                .map((item) => item.text ?? '')
                .join('') ?? '';
            if (!output) throw new ProviderError('ChatGPT completed without translation text');
            completed = {
              value: JSON.parse(output),
              costUsd: 0,
              inputTokens: event.response?.usage?.input_tokens ?? 0,
              outputTokens: event.response?.usage?.output_tokens ?? 0,
            };
          }
        };
        try {
          for (;;) {
            const next = await reader.read();
            pending += next.done ? decoder.decode() : decoder.decode(next.value, { stream: true });
            size += next.value?.length ?? 0;
            if (size > 1000000)
              throw new ProviderError('ChatGPT stream exceeds size limit', false, 0, true);
            pending = pending.replaceAll('\r\n', '\n');
            for (let boundary; (boundary = pending.indexOf('\n\n')) >= 0; ) {
              const block = pending.slice(0, boundary);
              pending = pending.slice(boundary + 2);
              const result = process(block);
              if (result)
                return await this.failure(
                  id,
                  response.status,
                  result.failure,
                  true,
                  response.headers.get('x-request-id'),
                );
            }
            if (next.done) {
              if (pending.trim()) {
                const result = process(pending);
                if (result)
                  return await this.failure(
                    id,
                    response.status,
                    result.failure,
                    true,
                    response.headers.get('x-request-id'),
                  );
              }
              break;
            }
          }
        } catch (error) {
          if (error instanceof ProviderError) throw error;
          throw new ProviderError('ChatGPT stream was interrupted or malformed', true, 2000, true);
        } finally {
          await reader.cancel().catch(() => {});
        }
        if (!completed)
          throw new ProviderError(
            'ChatGPT stream ended without confirmed completion',
            true,
            2000,
            true,
          );
        return completed;
      },
    };
  }
}
