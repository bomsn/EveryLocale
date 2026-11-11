#!/usr/bin/env node
import { resolve } from 'node:path';
import { access, copyFile, constants } from 'node:fs/promises';
import { SqliteStore, verifyDatabase } from '@everylocale/store';
import { databasePath } from './paths.js';

const USAGE =
  'Commands: backup --output FILE [--database FILE], restore --input FILE --output FILE, check [--database FILE]';
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
const describe = (check: ReturnType<typeof verifyDatabase>) =>
  `schema version ${String(check.schemaVersion)}${check.current ? '' : ', upgraded when the service next opens it'}`;

async function run() {
  const databaseOption = option('database');
  const database = databaseOption ? resolve(databaseOption) : databasePath();
  switch (command) {
    case 'check': {
      // Checks are read-only, so a backup is verified exactly as it was written.
      console.log(`Database integrity checks passed (${describe(verifyDatabase(database))}).`);
      return;
    }
    case 'backup': {
      const output = required('output');
      if (output === database) throw new Error('Choose a separate destination');
      await access(database);
      verifyDatabase(database);
      const store = new SqliteStore(database);
      try {
        await store.backup(output);
      } finally {
        store.close();
      }
      verifyDatabase(output);
      console.log('Verified database snapshot created. Destinations must be new files.');
      return;
    }
    case 'restore': {
      const input = required('input');
      const output = required('output');
      verifyDatabase(input);
      await copyFile(input, output, constants.COPYFILE_EXCL);
      console.log(
        `Restored a verified copy (${describe(verifyDatabase(output))}). Start the service with EVERYLOCALE_DATABASE set to this file.`,
      );
      return;
    }
    default:
      throw new Error(USAGE);
  }
}
run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Database maintenance failed');
  process.exitCode = 1;
});
