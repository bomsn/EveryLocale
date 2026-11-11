import type { SqliteStore } from './index.js';
import { ContractError, hash, matchesGlob, splitUnitId } from '@everylocale/core';
import { decodeScopes, decodeStrings, tokenRow, SCOPES } from './decode.js';
import type { Scope } from './decode.js';
import { randomBytes, randomUUID } from 'node:crypto';

/** Optional limits on a token; `null` means every locale or namespace in the project. */
export type TokenLimits = { locales: string[] | null; namespaces: string[] | null };
export type TokenIdentity = TokenLimits & { projectId: string; scopes: Scope[]; actor: string };

/** Whether a limited token may see or act on one message in one locale. */
export function withinLimits(limits: TokenLimits, locale: string, unitId: string): boolean {
  const { namespace } = splitUnitId(unitId);
  return (
    (limits.locales === null || limits.locales.includes(locale)) &&
    (limits.namespaces === null ||
      limits.namespaces.some((pattern) => matchesGlob(namespace, pattern)))
  );
}

export function mintToken(
  store: SqliteStore,
  projectId: string,
  scopes: Scope[],
  expiresAt: number,
  limits: Partial<TokenLimits> = {},
  actor = 'owner',
) {
  const project = store.getProject(projectId);
  if (
    !scopes.length ||
    scopes.some((x) => !SCOPES.includes(x)) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= store.now()
  )
    throw new ContractError('token', 'Valid scopes and future expiry are required', 422);
  const locales = limits.locales ?? null;
  const namespaces = limits.namespaces ?? null;
  if (locales?.some((locale) => !project.targetLocales.includes(locale)))
    throw new ContractError('token', 'Token locales must be target locales of the project', 422);
  if (locales?.length === 0 || namespaces?.length === 0)
    throw new ContractError('token', 'Omit a limit instead of passing an empty list', 422);
  const token = randomBytes(32).toString('base64url'),
    id = randomUUID();
  store.transaction(() => {
    store.db
      .prepare(
        'INSERT INTO access_tokens(id,project_id,token_hash,scopes,created_at,expires_at,locales,namespaces) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        projectId,
        hash(token),
        JSON.stringify(scopes),
        store.now(),
        expiresAt,
        locales && JSON.stringify(locales),
        namespaces && JSON.stringify(namespaces),
      );
    store.audit(projectId, actor, 'token.mint', id, { scopes, expiresAt, locales, namespaces });
  });
  return { id, token, expiresAt };
}

type IdentityRow = {
  id: string;
  project_id: string;
  scopes: string;
  locales: string | null;
  namespaces: string | null;
};
const identity = (row: IdentityRow | undefined): TokenIdentity | null =>
  row
    ? {
        projectId: row.project_id,
        scopes: decodeScopes(row.scopes),
        actor: `token:${row.id}`,
        locales: row.locales === null ? null : decodeStrings(row.locales),
        namespaces: row.namespaces === null ? null : decodeStrings(row.namespaces),
      }
    : null;

export function authenticate(store: SqliteStore, token: string): TokenIdentity | null {
  return identity(
    store.db
      .prepare(
        'SELECT id,project_id,scopes,locales,namespaces FROM access_tokens WHERE token_hash=? AND revoked=0 AND expires_at>?',
      )
      .get(hash(token), store.now()) as IdentityRow | undefined,
  );
}

export function authenticateId(store: SqliteStore, id: string): TokenIdentity | null {
  return identity(
    store.db
      .prepare(
        'SELECT id,project_id,scopes,locales,namespaces FROM access_tokens WHERE id=? AND revoked=0 AND expires_at>?',
      )
      .get(id, store.now()) as IdentityRow | undefined,
  );
}

export function tokens(store: SqliteStore, projectId: string) {
  store.getProject(projectId);
  return store.db
    .prepare(
      'SELECT id,scopes,created_at,expires_at,revoked,locales,namespaces FROM access_tokens WHERE project_id=? ORDER BY created_at DESC',
    )
    .all(projectId)
    .map((row) => {
      const token = tokenRow(row);
      return {
        ...token,
        scopes: decodeScopes(token.scopes),
        locales: token.locales === null ? null : decodeStrings(token.locales),
        namespaces: token.namespaces === null ? null : decodeStrings(token.namespaces),
      };
    });
}

export function revokeToken(store: SqliteStore, projectId: string, id: string, actor: string) {
  store.transaction(() => {
    const result = store.db
      .prepare('UPDATE access_tokens SET revoked=1 WHERE project_id=? AND id=?')
      .run(projectId, id);
    if (!result.changes) throw new ContractError('not_found', 'Token not found', 404);
    store.audit(projectId, actor, 'token.revoke', id);
  });
}

export function auditLog(store: SqliteStore, projectId: string) {
  return store.db
    .prepare(
      'SELECT actor,action,entity_id,detail,created_at FROM audit WHERE project_id=? ORDER BY seq DESC LIMIT 200',
    )
    .all(projectId) as Array<{
    actor: string;
    action: string;
    entity_id: string;
    detail: string;
    created_at: number;
  }>;
}
