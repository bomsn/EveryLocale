import Database from 'better-sqlite3';
import { SCHEMA_VERSION } from './migrations.js';

export type DatabaseCheck = { schemaVersion: number; current: boolean };

/**
 * Checks a database file without changing it: no migration, no journal mode change, no
 * writes. Used for backups and restores, which must be verified exactly as stored.
 */
export function verifyDatabase(path: string): DatabaseCheck {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    if (db.pragma('quick_check', { simple: true }) !== 'ok')
      throw new Error('Database integrity check failed');
    if ((db.pragma('foreign_key_check') as unknown[]).length)
      throw new Error('Database foreign key check failed');
    const schemaVersion = db.pragma('user_version', { simple: true }) as number;
    if (schemaVersion > SCHEMA_VERSION)
      throw new Error('Database schema is newer than this release');
    return { schemaVersion, current: schemaVersion === SCHEMA_VERSION };
  } finally {
    db.close();
  }
}
