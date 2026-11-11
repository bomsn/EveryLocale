import { randomBytes } from 'node:crypto';
import { hash } from '@everylocale/core';
import type { SqliteStore } from './index.js';

export type Session = { csrf: string; tokenId: string | null; expiresAt: number };

/** Expired sessions are kept briefly so a late request reports expiry rather than an unknown id. */
const RETENTION_MS = 24 * 3600000;

/**
 * Workspace sessions live in the database, so signing out or revoking all sessions takes effect
 * immediately. The browser holds only a random secret; the database stores its hash.
 */
export function createSession(store: SqliteStore, tokenId: string | null, ttlMs: number) {
  const secret = randomBytes(32).toString('base64url');
  const csrf = randomBytes(24).toString('base64url');
  const now = store.now();
  store.transaction(() => {
    store.db.prepare('DELETE FROM sessions WHERE expires_at<?').run(now - RETENTION_MS);
    store.db
      .prepare('INSERT INTO sessions(id,token_id,csrf,created_at,expires_at) VALUES(?,?,?,?,?)')
      .run(hash(secret), tokenId, csrf, now, now + ttlMs);
  });
  return { secret, csrf, expiresAt: now + ttlMs };
}

export function session(store: SqliteStore, secret: string): Session | 'expired' | null {
  const row = store.db
    .prepare('SELECT token_id,csrf,expires_at,revoked FROM sessions WHERE id=?')
    .get(hash(secret)) as
    | { token_id: string | null; csrf: string; expires_at: number; revoked: number }
    | undefined;
  if (!row || row.revoked) return null;
  if (row.expires_at <= store.now()) return 'expired';
  return { csrf: row.csrf, tokenId: row.token_id, expiresAt: row.expires_at };
}

export function revokeSession(store: SqliteStore, secret: string) {
  store.db.prepare('UPDATE sessions SET revoked=1 WHERE id=?').run(hash(secret));
}

/** Signs out every browser, including the caller's. */
export function revokeSessions(store: SqliteStore, actor: string): number {
  return store.transaction(() => {
    const { changes } = store.db
      .prepare('UPDATE sessions SET revoked=1 WHERE revoked=0 AND expires_at>?')
      .run(store.now());
    store.audit('*', actor, 'session.revoke_all', '*', { sessions: changes });
    return changes;
  });
}
