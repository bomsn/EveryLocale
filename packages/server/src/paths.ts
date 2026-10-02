import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Environment paths keep the service's meaning when maintenance runs from the repository root. */
export function databasePath(value = process.env.EVERYLOCALE_DATABASE): string {
  return resolve(
    fileURLToPath(new URL('../', import.meta.url)),
    value ?? '../../data/everylocale.sqlite',
  );
}
