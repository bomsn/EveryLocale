#!/usr/bin/env node
import { resolve } from 'node:path';
import { access } from 'node:fs/promises';
import { SqliteStore } from '@everylocale/store';
import { databasePath } from './paths.js';

const [command, ...args] = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? undefined : args[index + 1];
};
const required = (name: string) => {
  const value = option(name);
  if (!value) throw new Error(`--${name} is required`);
  return resolve(value);
};
async function run() {
  if (!['backup', 'restore', 'check'].includes(command ?? ''))
    throw new Error(
      'Commands: backup --output FILE [--database FILE], restore --input FILE --output FILE, check [--database FILE]',
    );
  const database =
    command === 'restore'
      ? required('input')
      : option('database')
        ? resolve(option('database')!)
        : databasePath();
  await access(database);
  const store = new SqliteStore(database);
  try {
    if (
      store.db.pragma('quick_check', { simple: true }) !== 'ok' ||
      (store.db.pragma('foreign_key_check') as unknown[]).length
    )
      throw new Error('Database integrity verification failed');
    if (command !== 'check') {
      const output = required('output');
      if (output === database) throw new Error('Choose a separate destination');
      await store.backup(output);
      console.log(
        'Verified database snapshot created. Restore destinations must be new; start the service with the restored database path.',
      );
    } else console.log('Database integrity checks passed.');
  } finally {
    store.close();
  }
}
run().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Database maintenance failed');
  process.exitCode = 1;
});
