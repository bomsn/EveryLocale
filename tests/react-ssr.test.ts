import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import {
  EveryLocaleProvider,
  Message,
  LanguageLinks,
  LanguageSelect,
  LocaleFlag,
  LanguageSuggestion,
} from '../packages/react/dist/index.js';
import tw from '../packages/react/flags/tw.js';
import { resolveRequest, PublishedRegistry } from '../packages/adapters/dist/index.js';
import { compileMessage, defineLocales } from '../packages/core/dist/index.js';

const locales = defineLocales('en', [
  'ar',
  { id: 'zh-Hant-TW', prefix: 'zh-tw' },
  'de',
  'es',
  'fr',
]);

const registry = new PublishedRegistry(
  'https://example.test',
  [
    {
      id: 'about',
      variants: [
        { locale: 'en', path: '/about', approvalRevision: 'r1', title: 'About' },
        { locale: 'ar', path: '/ar/about', approvalRevision: 'r1', title: 'حول' },
        { locale: 'zh-Hant-TW', path: '/zh-tw/about', approvalRevision: 'r1', title: '關於' },
        { locale: 'de', path: '/de/about', approvalRevision: 'r1', title: 'Über uns' },
      ],
    },
  ],
  locales,
);
const approved: Record<string, string> = {
  en: 'Hello {name}',
  ar: 'مرحبًا {name}',
  'zh-Hant-TW': '你好 {name}',
  de: 'Hallo {name}',
};

/** One request: the URL chooses the locale, the catalog and the metadata, nothing else. */
function render(url: string) {
  const request = new Request(url, {
    headers: { cookie: 'el_locale=en', 'accept-language': 'fr' },
  });
  const selected = resolveRequest(request, { locales });
  const page = registry.resolve(new URL(url).pathname);
  const message = approved[selected.locale];
  if (!page || page.variant.locale !== selected.locale || message === undefined)
    return { status: 404, html: '' };
  const metadata = registry.metadata(page.pageId, selected.locale);
  const html = renderToString(
    h(
      'html',
      { lang: selected.locale, dir: selected.direction },
      h(
        'head',
        null,
        h('link', { rel: 'canonical', href: metadata.canonical }),
        ...metadata.alternates.map((link) =>
          h('link', {
            key: link.hreflang,
            rel: 'alternate',
            hrefLang: link.hreflang,
            href: link.href,
          }),
        ),
      ),
      h(
        'body',
        null,
        h(EveryLocaleProvider, {
          locale: selected.locale,
          messages: { hello: compileMessage('icu', message) },
          children: h('h1', null, h(Message, { id: 'hello', values: { name: 'Ali' } })),
        }),
      ),
    ),
  );
  return { status: 200, html };
}

test('server rendering uses the request-owned catalog and reciprocal metadata for each locale', () => {
  const [ar, zh, de] = ['/ar/about', '/zh-tw/about', '/de/about'].map((path) =>
    render(`https://example.test${path}`),
  );
  assert.ok(ar && zh && de);
  assert.match(ar.html, /<html lang="ar" dir="rtl"/);
  assert.match(ar.html, /مرحبًا Ali/);
  assert.match(zh.html, /你好 Ali/);
  assert.match(de.html, /Hallo Ali/);
  assert.match(ar.html, /rel="canonical" href="https:\/\/example.test\/ar\/about"/);
  assert.match(ar.html, /hrefLang="zh-Hant-TW"/);
  assert.match(zh.html, /hrefLang="ar"/);
  assert.match(de.html, /hrefLang="x-default" href="https:\/\/example.test\/about"/);
  assert.equal(render('https://example.test/fr/about').status, 404);
  assert.equal(render('https://example.test/zh-cn/about').status, 404);
});

test('language links are crawlable, mark the current page and skip unpublished locales', () => {
  const markup = renderToString(
    h(LanguageLinks, {
      locale: 'ar',
      locales,
      label: 'Languages',
      links: { en: '/about', ar: '/ar/about', 'zh-Hant-TW': '/zh-tw/about' },
      flags: { tw },
    }),
  );
  assert.match(markup, /<nav aria-label="Languages">/);
  assert.ok(markup.includes('href="/ar/about" hrefLang="ar" lang="ar" aria-current="page"'));
  assert.match(markup, /hrefLang="zh-Hant-TW"[^>]*><span aria-hidden="true"[^>]*><svg/);
  assert.doesNotMatch(markup, /lang="de"/, 'German has no published counterpart');
  assert.match(markup, /العربية/);
});

test('the language select changes language only on submit and works as a plain form', () => {
  const markup = renderToString(
    h(LanguageSelect, {
      locale: 'de',
      locales,
      action: '/language',
      label: 'Sprache',
      submitLabel: 'Wechseln',
      hidden: { return: '/de/about' },
    }),
  );
  // React 18 and 19 order form attributes differently.
  assert.match(markup, /<form (?=[^>]*method="get")(?=[^>]*action="\/language")[^>]*>/);
  for (const fragment of [
    '<option value="de" lang="de" selected="">Deutsch</option>',
    '<input type="hidden" name="return" value="/de/about"/>',
    '<button type="submit">Wechseln</button>',
  ])
    assert.ok(markup.includes(fragment), fragment);
  assert.doesNotMatch(markup, /onchange/i);
});

test('flags render only when the host supplies them, and country never changes the language', () => {
  assert.equal(renderToString(h(LocaleFlag, { locale: 'zh-Hant-TW', flags: {} })), '');
  assert.match(renderToString(h(LocaleFlag, { locale: 'zh-Hant-TW', flags: { tw } })), /<svg/);
  assert.match(
    renderToString(h(LocaleFlag, { locale: 'ar', country: 'MA', flags: { ma: '<svg id="ma">' } })),
    /id="ma"/,
  );
  assert.equal(
    renderToString(
      h(LanguageSuggestion, {
        locale: 'en',
        locales,
        dismissed: false,
        onAccept() {},
        onDismiss() {},
        labels: {
          region: 'Language',
          prompt: (name) => name,
          accept: (name) => name,
          dismiss: 'No',
        },
      }),
    ),
    '',
    'browser languages are unknown during server rendering, so no suggestion is rendered',
  );
});
