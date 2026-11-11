import { writeFile } from 'node:fs/promises';
import { SqliteStore } from '../packages/store/dist/index.js';
import { createApp } from '../packages/server/dist/app.js';

/** The committed document is what the service serves; a test fails when they differ. */
export const OPENAPI_PATH = 'docs/openapi.json';

export async function openApiText(): Promise<string> {
  const store = new SqliteStore(':memory:');
  const app = await createApp(store, {
    adminToken: 'owner-token-for-the-openapi-document-only',
    sessionSecret: 'session-secret-for-the-openapi-document-only',
    publicOrigin: 'http://127.0.0.1:4310',
    secureCookie: false,
    providersReady: false,
    logLevel: 'silent',
    trustProxy: false,
  });
  try {
    const response = await app.inject({ method: 'GET', url: '/api/v1/openapi.json' });
    return `${JSON.stringify(response.json(), null, 2)}\n`;
  } finally {
    await app.close();
    store.close();
  }
}

if (process.argv[1]?.endsWith('openapi.ts')) {
  await writeFile(OPENAPI_PATH, await openApiText());
  console.log(`Wrote ${OPENAPI_PATH}`);
}
