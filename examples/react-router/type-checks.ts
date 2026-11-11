/**
 * Compile-time proof that generated declarations type message ids and values. `pnpm
 * typecheck` fails if any expected error below stops being an error.
 */
import { createFormatter } from '@everylocale/runtime';

const { format } = createFormatter({ locale: 'en', messages: {} });

format('home:files', { count: 2 });
format('app:site');
// @ts-expect-error a misspelled id is not a message
format('home:filez', { count: 2 });
// @ts-expect-error a plural argument is a number
format('home:files', { count: 'two' });
// @ts-expect-error the heading needs its name
format('home:heading');
// @ts-expect-error a message without arguments takes no values
format('app:site', { name: 'Ana' });
