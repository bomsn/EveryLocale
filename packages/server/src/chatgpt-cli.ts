#!/usr/bin/env node
import { resolve } from 'node:path';
import { SqliteStore } from '@everylocale/store';
import { ChatGptConnection } from './chatgpt.js';

const [command, ...args] = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? undefined : args[index + 1];
};
const store = new SqliteStore(
  resolve(process.env.EVERYLOCALE_DATABASE ?? 'data/everylocale.sqlite'),
);
try {
  const connection = new ChatGptConnection(store, process.env.EVERYLOCALE_CHATGPT_SECRET ?? '');
  const account = option('account');
  if (command === 'connect') {
    console.log('Continue with ChatGPT. Open the official sign-in link on this computer:');
    const result = await connection.connect({
      accountId: account,
      label: option('label'),
      port: option('callback-port') ? Number(option('callback-port')) : undefined,
      consent: args.includes('--enable-usage'),
      show: (url) => {
        console.log(url);
      },
    });
    console.log(
      `Saved account ${result.id}. ${result.enabled ? 'Eligible requests use your ChatGPT plan. Manage usage at https://chatgpt.com/settings/usage.' : 'Plan usage is disabled. Enable it or select another provider.'}`,
    );
    if (result.enabled) console.log(JSON.stringify(await connection.models(result.id), null, 2));
  } else if (command === 'accounts') console.log(JSON.stringify(connection.accounts(), null, 2));
  else if (command === 'models' && account)
    console.log(JSON.stringify(await connection.models(account), null, 2));
  else if (command === 'disconnect' && account) {
    const result = await connection.disconnect(account);
    console.log(
      result.revoked
        ? 'Disconnected.'
        : 'Disconnected locally. Remote revocation was not confirmed; disconnect EveryLocale in ChatGPT settings.',
    );
  } else if (command === 'resume' && account) {
    await connection.resume(account);
    console.log('Connection resumed.');
  } else
    throw new Error(
      'Commands: connect [--account ID] [--label NAME] [--enable-usage], accounts, models --account ID, disconnect --account ID, resume --account ID',
    );
} catch (error) {
  console.error(error instanceof Error ? error.message : 'ChatGPT connection failed');
  process.exitCode = 1;
} finally {
  store.close();
}
