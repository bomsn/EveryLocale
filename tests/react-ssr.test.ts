import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import {
  EveryLocaleProvider,
  Message,
  LanguageSelector,
  LocaleFlag,
  LanguageSuggestion,
} from '../packages/react/dist/index.js';
import { resolveRequest, PublishedRegistry } from '../packages/adapters/dist/index.js';

const registry = new PublishedRegistry('https://example.test', [
  {
    id: 'about',
    variants: [
      { locale: 'en', path: '/about', approvalRevision: 'r1', title: 'About' },
      { locale: 'ar', path: '/ar/about', approvalRevision: 'r1', title: 'حول' },
      { locale: 'zh-Hant-TW', path: '/zh-tw/about', approvalRevision: 'r1', title: '關於' },
      { locale: 'de', path: '/de/about', approvalRevision: 'r1', title: 'Über uns' },
    ],
  },
]);
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
  const selected = resolveRequest(request);
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
          catalog: { locale: selected.locale, revision: 'fixture', messages: { hello: message } },
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

test('language controls render native labels and bundled flags without changing language from country', () => {
  const markup = renderToString(
    h(LanguageSelector, { locale: 'ar', country: 'AE', onChange() {} }),
  );
  assert.match(markup, /العربية/);
  assert.match(markup, /<svg/);
  assert.match(markup, /<option value="ar"[^>]*selected/);
  assert.ok(renderToString(h(LocaleFlag, { locale: 'zh-Hant-TW' })).includes('<svg'));
  assert.equal(
    renderToString(
      h(LanguageSuggestion, {
        locale: 'en',
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
