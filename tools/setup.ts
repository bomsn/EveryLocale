import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

const destination = new URL('../.env', import.meta.url);
const example = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
const secret = () => randomBytes(32).toString('base64url');
const content = example
  .replace('EVERYLOCALE_ADMIN_TOKEN=', `EVERYLOCALE_ADMIN_TOKEN=${secret()}`)
  .replace('EVERYLOCALE_SESSION_SECRET=', `EVERYLOCALE_SESSION_SECRET=${secret()}`);
try {
  await writeFile(destination, content, { flag: 'wx', mode: 0o600 });
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'EEXIST')
    throw new Error('.env already exists. Existing credentials were preserved.');
  throw error;
}
console.log(
  'Created .env with independent workspace credentials. Read EVERYLOCALE_ADMIN_TOKEN in that file to sign in. Configure both model providers there before translation.',
);
