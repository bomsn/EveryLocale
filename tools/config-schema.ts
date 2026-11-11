import { writeFile } from 'node:fs/promises';
import { appConfigJsonSchema, CONFIG_VERSION } from '../packages/core/dist/index.js';

/** The committed schema is generated from the zod definition; a test fails when it drifts. */
export const CONFIG_SCHEMA_PATH = `packages/core/schema/config-${String(CONFIG_VERSION)}.json`;
export const configSchemaText = () => `${JSON.stringify(appConfigJsonSchema(), null, 2)}\n`;

if (process.argv[1]?.endsWith('config-schema.ts')) {
  await writeFile(CONFIG_SCHEMA_PATH, configSchemaText());
  console.log(`Wrote ${CONFIG_SCHEMA_PATH}`);
}
