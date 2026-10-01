import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const destination = new URL('../.env', import.meta.url);
let exists = false;
try {
  await readFile(destination);
  exists = true;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (exists) throw new Error('.env already exists. Existing credentials were preserved.');
let example = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
example = example
  .replace(
    'EVERYLOCALE_ADMIN_TOKEN=',
    'EVERYLOCALE_ADMIN_TOKEN=' + randomBytes(32).toString('base64url'),
  )
  .replace(
    'EVERYLOCALE_SESSION_SECRET=',
    'EVERYLOCALE_SESSION_SECRET=' + randomBytes(32).toString('base64url'),
  );
await writeFile(destination, example, { flag: 'wx', mode: 0o600 });
console.log(
  'Created .env with independent workspace credentials. Read EVERYLOCALE_ADMIN_TOKEN in that file to sign in. Configure both model providers there before translation.',
);
