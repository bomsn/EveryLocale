import type { SqliteStore } from './index.js';
import { ContractError, hash } from '@everylocale/core';
import { decodeScopes, tokenRow, SCOPES } from './decode.js';
import type { Scope } from './decode.js';
import { randomBytes, randomUUID } from 'node:crypto';

export function mintToken(
  store: SqliteStore,
  projectId: string,
  scopes: Scope[],
  expiresAt: number,
) {
  store.getProject(projectId);
  if (
    !scopes.length ||
    scopes.some((x) => !SCOPES.includes(x)) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= store.now()
  )
    throw new ContractError('token', 'Valid scopes and future expiry are required', 422);
  const token = randomBytes(32).toString('base64url'),
    id = randomUUID();
  store.db
    .prepare(
      'INSERT INTO access_tokens(id,project_id,token_hash,scopes,created_at,expires_at) VALUES(?,?,?,?,?,?)',
    )
    .run(id, projectId, hash(token), JSON.stringify(scopes), store.now(), expiresAt);
  return { id, token, expiresAt };
}

export function authenticate(
  store: SqliteStore,
  token: string,
): { projectId: string; scopes: Scope[]; actor: string } | null {
  const row = store.db
    .prepare(
      'SELECT id,project_id,scopes FROM access_tokens WHERE token_hash=? AND revoked=0 AND expires_at>?',
    )
    .get(hash(token), store.now()) as
    | { id: string; project_id: string; scopes: string }
    | undefined;
  return row
    ? { projectId: row.project_id, scopes: decodeScopes(row.scopes), actor: `token:${row.id}` }
    : null;
}

export function authenticateId(
  store: SqliteStore,
  id: string,
): { projectId: string; scopes: Scope[]; actor: string } | null {
  const row = store.db
    .prepare(
      'SELECT id,project_id,scopes FROM access_tokens WHERE id=? AND revoked=0 AND expires_at>?',
    )
    .get(id, store.now()) as { id: string; project_id: string; scopes: string } | undefined;
  return row
    ? { projectId: row.project_id, scopes: decodeScopes(row.scopes), actor: `token:${row.id}` }
    : null;
}

export function tokens(store: SqliteStore, projectId: string) {
  store.getProject(projectId);
  return store.db
    .prepare(
      'SELECT id,scopes,created_at,expires_at,revoked FROM access_tokens WHERE project_id=? ORDER BY created_at DESC',
    )
    .all(projectId)
    .map((row) => {
      const token = tokenRow(row);
      return { ...token, scopes: decodeScopes(token.scopes) };
    });
}

export function revokeToken(store: SqliteStore, projectId: string, id: string, actor: string) {
  store.db
    .prepare('UPDATE access_tokens SET revoked=1 WHERE project_id=? AND id=?')
    .run(projectId, id);
  store.audit(projectId, actor, 'token.revoke', id);
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
