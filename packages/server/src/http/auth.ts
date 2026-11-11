import type { FastifyReply, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { ContractError } from '@everylocale/core';
import {
  SCOPES,
  withinLimits,
  type LocalizationStore,
  type Scope,
  type TokenLimits,
} from '@everylocale/store';
import type { AppConfig } from './context.js';
import type { Authorize } from './contract.js';

const ALL_SCOPES: readonly Scope[] = SCOPES;
const SESSION_COOKIE = 'el_session';
const SESSION_TTL_MS = 8 * 3600000;
const UNLIMITED: TokenLimits = { locales: null, namespaces: null };
/** Failed sign-ins allowed per client address within the window before it is refused. */
const LOGIN_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 60000;

export type Identity = TokenLimits & {
  owner: boolean;
  actor: string;
  projectId?: string;
  scopes: readonly Scope[];
  /** The session secret for browser sessions, so sign-out can revoke exactly this session. */
  session?: string;
  csrf?: string;
};

const equal = (a: string, b: string) =>
  Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export type Auth = ReturnType<typeof createAuth>;

/** One place decides who a request is and what it may touch. */
export function createAuth(store: LocalizationStore, config: AppConfig) {
  const attempts = new Map<string, { count: number; until: number }>();

  const sessionSecret = (request: FastifyRequest) => {
    const signed = request.cookies[SESSION_COOKIE];
    const verified = signed ? request.unsignCookie(signed) : null;
    return verified?.valid && verified.value ? verified.value : null;
  };

  const identity = (request: FastifyRequest): Identity => {
    const authorization = request.headers.authorization;
    if (authorization?.startsWith('Bearer ')) {
      const token = authorization.slice(7);
      if (equal(token, config.adminToken))
        return { owner: true, actor: 'owner', scopes: ALL_SCOPES, ...UNLIMITED };
      const scoped = store.authenticate(token);
      if (scoped) return { owner: false, ...scoped };
      throw new ContractError('unauthorized', 'Authentication required', 401);
    }
    const secret = sessionSecret(request);
    const session = secret ? store.session(secret) : null;
    if (!secret || !session)
      throw new ContractError('unauthorized', 'Authentication required', 401);
    if (session === 'expired') throw new ContractError('unauthorized', 'Session expired', 401);
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      (request.headers.origin !== config.publicOrigin ||
        request.headers['x-csrf-token'] !== session.csrf)
    )
      throw new ContractError('csrf', 'Refresh the workspace before making changes', 403);
    const browser = { session: secret, csrf: session.csrf };
    if (!session.tokenId)
      return { owner: true, actor: 'owner-session', scopes: ALL_SCOPES, ...UNLIMITED, ...browser };
    const scoped = store.authenticateId(session.tokenId);
    if (!scoped)
      throw new ContractError('unauthorized', 'Session access was revoked or expired', 401);
    return { owner: false, ...scoped, ...browser };
  };

  /** A project operation: the caller owns the service or holds a token for this project and scope. */
  const access = (request: FastifyRequest, project: string, scope: Scope): Identity => {
    const user = identity(request);
    if (!user.owner && user.projectId !== project)
      throw new ContractError('not_found', 'Project not found', 404);
    if (!user.scopes.includes(scope))
      throw new ContractError('forbidden', 'This token cannot perform that operation', 403);
    return user;
  };
  const owner = (request: FastifyRequest, action: string): Identity => {
    const user = identity(request);
    if (!user.owner) throw new ContractError('forbidden', `Only the owner can ${action}`, 403);
    return user;
  };
  return {
    identity,
    access,
    owner,
    /** Enforces the access an endpoint declares, before its query or body is read. */
    authorize: ((request, endpoint, params) => {
      switch (endpoint.access) {
        case 'public':
          return undefined;
        case 'signed-in':
          return identity(request);
        case 'owner':
          return owner(request, endpoint.ownerAction ?? 'do this');
        default: {
          if (typeof params?.project === 'string')
            return access(request, params.project, endpoint.access);
          const user = identity(request);
          if (!user.scopes.includes(endpoint.access))
            throw new ContractError('forbidden', 'This token cannot perform that operation', 403);
          return user;
        }
      }
    }) satisfies Authorize,
    /** Limited reviewer tokens see only their locales and namespaces; anything else is not found. */
    allows: (user: Identity, locale: string, unitId: string) => withinLimits(user, locale, unitId),
    requireAllowed(user: Identity, locale: string, unitId: string) {
      if (!withinLimits(user, locale, unitId))
        throw new ContractError('not_found', 'Translation not found', 404);
    },
    requireLocale(user: Identity, locale: string) {
      if (user.locales !== null && !user.locales.includes(locale))
        throw new ContractError('not_found', 'Locale not found', 404);
    },
    requireUnlimited(user: Identity) {
      if (user.locales !== null || user.namespaces !== null)
        throw new ContractError('forbidden', 'A limited token cannot export every locale', 403);
    },
    signIn(request: FastifyRequest, reply: FastifyReply, token: string) {
      const now = Date.now();
      for (const [address, entry] of attempts) if (entry.until <= now) attempts.delete(address);
      const attempt = attempts.get(request.ip);
      if (attempt && attempt.count >= LOGIN_ATTEMPTS)
        throw new ContractError('rate_limit', 'Too many sign-in attempts; wait a minute', 429);
      if (request.headers.origin !== config.publicOrigin)
        throw new ContractError('origin', 'Unexpected workspace origin', 403);
      const owner = equal(token, config.adminToken);
      const scoped = owner ? null : store.authenticate(token);
      if (!owner && !scoped?.scopes.includes('read')) {
        attempts.set(request.ip, {
          count: (attempt?.count ?? 0) + 1,
          until: attempt?.until ?? now + LOGIN_WINDOW_MS,
        });
        request.log.warn({ event: 'sign_in_failed' }, 'workspace sign-in failed');
        throw new ContractError('unauthorized', 'Invalid workspace token', 401);
      }
      attempts.delete(request.ip);
      const created = store.createSession(
        scoped ? scoped.actor.slice('token:'.length) : null,
        SESSION_TTL_MS,
      );
      reply.setCookie(SESSION_COOKIE, created.secret, {
        signed: true,
        httpOnly: true,
        secure: config.secureCookie,
        sameSite: 'strict',
        path: '/',
        maxAge: SESSION_TTL_MS / 1000,
      });
      return { csrf: created.csrf };
    },
    signOut(reply: FastifyReply, user: Identity) {
      if (user.session) store.revokeSession(user.session);
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
    },
  };
}
