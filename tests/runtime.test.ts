import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { compileMessage } from '../packages/core/dist/index.js';
import { createFormatter, MissingMessageError } from '../packages/runtime/dist/index.js';
import { EveryLocaleProvider, Message, useMessages } from '../packages/react/dist/index.js';

const messages = {
  'app:calls': compileMessage(
    'icu',
    '{count, plural, one {# call} many {# calls (many)} other {# calls}}',
  ),
  'app:terms': compileMessage('icu', 'Read the <link>terms</link>, {name}.'),
  'app:literal': compileMessage('text', 'Braces {stay} text'),
};

test('precompiled messages format with CLDR plural categories and keep text literal', () => {
  const french = createFormatter({ locale: 'fr-CA', messages });
  assert.equal(french.format('app:calls', { count: 1 }), '1 call');
  // The grouping separator is a locale-specific space, so only the plural branch is compared.
  assert.match(french.format('app:calls', { count: 1_000_000 }), /^1\s000\s000 calls \(many\)$/);
  assert.equal(french.format('app:calls', { count: 2 }), '2 calls');
  const chinese = createFormatter({ locale: 'zh-TW', messages });
  assert.equal(chinese.format('app:calls', { count: 1 }), '1 calls', 'Chinese has only other');
  assert.equal(french.format('app:literal'), 'Braces {stay} text');
});

test('a missing message is reported once, or fails when the caller asks it to', () => {
  const reports: string[] = [];
  const formatter = createFormatter({
    locale: 'de',
    messages,
    onMissing: (id, locale) => reports.push(`${locale}:${id}`),
  });
  assert.equal(formatter.format('app:gone'), 'app:gone');
  assert.equal(formatter.format('app:gone'), 'app:gone');
  assert.deepEqual(reports, ['de:app:gone']);
  const strict = createFormatter({ locale: 'de', messages, missing: 'throw' });
  assert.throws(() => strict.format('app:gone'), MissingMessageError);
});

test('React renders rich text, the formatter hook, and identical markup on every render', () => {
  function Count() {
    return h('span', null, useMessages().format('app:calls', { count: 3 }));
  }
  const tree = () =>
    h(EveryLocaleProvider, {
      locale: 'es',
      messages,
      children: [
        h(Message, {
          key: 'terms',
          id: 'app:terms',
          values: {
            name: 'Ana',
            link: (chunks: ReactNode[]) => h('a', { href: '/terms' }, ...chunks),
          },
        }),
        h(Count, { key: 'count' }),
      ],
    });
  const first = renderToString(tree());
  assert.equal(first, 'Read the <a href="/terms">terms</a>, Ana.<span>3 calls</span>');
  assert.equal(renderToString(tree()), first, 'server and client render the same text');
  assert.throws(() => renderToString(h(Count)), /need an EveryLocaleProvider/);
});
