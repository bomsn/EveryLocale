import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { createRequestHandler, json, type ServerBuild } from '@remix-run/node';
import { RemixServer, Meta, Outlet, Scripts, useLoaderData } from '@remix-run/react';
import {
  EveryLocaleProvider,
  Message,
  LanguageSelector,
  LocaleFlag,
  LanguageSuggestion,
} from '../packages/react/dist/index.js';
import { resolveRequest, remixMeta } from '../packages/adapters/dist/index.js';
const paths = { en: '/about', ar: '/ar/about', 'zh-Hant-TW': '/zh-tw/about', de: '/de/about' };
const messages: Record<string, string> = {
  en: 'Hello {name}',
  ar: 'مرحبًا {name}',
  'zh-Hant-TW': '你好 {name}',
  de: 'Hallo {name}',
};
function Root() {
  const data = useLoaderData<any>();
  return h(
    'html',
    { lang: data.locale, dir: data.direction },
    h('head', null, h(Meta)),
    h('body', null, h(EveryLocaleProvider, { catalog: data.catalog }, h(Outlet)), h(Scripts)),
  );
}
function Page() {
  return h('main', null, h('h1', null, h(Message, { id: 'hello', values: { name: 'Ali' } })));
}
const build: ServerBuild = {
  mode: 'production',
  entry: {
    module: {
      default(request, status, headers, context) {
        headers.set('content-type', 'text/html;charset=utf-8');
        return new Response(
          '<!doctype html>' + renderToString(h(RemixServer, { context, url: request.url })),
          { status, headers },
        );
      },
      handleError() {},
    },
  },
  routes: {
    root: {
      id: 'root',
      path: '',
      module: {
        default: Root,
        ErrorBoundary: () =>
          h(
            'html',
            { lang: 'en' },
            h(
              'body',
              null,
              h(
                'main',
                null,
                h('h1', null, 'Translation unavailable'),
                h('a', { href: '/about' }, 'Read the original page'),
              ),
            ),
          ),
        loader: ({ request }) => {
          const selected = resolveRequest(request);
          if (
            !(selected.locale in paths) ||
            new URL(request.url).pathname !== (paths as Record<string, string>)[selected.locale]
          )
            throw new Response('Translation unavailable', { status: 404 });
          return json({
            ...selected,
            catalog: {
              locale: selected.locale,
              revision: 'approved-fixture',
              messages: { hello: messages[selected.locale] },
            },
            paths,
          });
        },
        meta: ({ data }) =>
          data ? remixMeta('https://example.test', data.paths, data.locale) : [],
      },
    },
    page: { id: 'page', parentId: 'root', path: '*', module: { default: Page } },
  },
  assets: {
    version: 'fixture',
    url: '/manifest.js',
    entry: { module: '/entry.js', imports: [] },
    routes: {
      root: {
        id: 'root',
        path: '',
        module: '/root.js',
        hasAction: false,
        hasLoader: true,
        hasClientAction: false,
        hasClientLoader: false,
        hasErrorBoundary: true,
      },
      page: {
        id: 'page',
        parentId: 'root',
        path: '*',
        module: '/page.js',
        hasAction: false,
        hasLoader: false,
        hasClientAction: false,
        hasClientLoader: false,
        hasErrorBoundary: false,
      },
    },
  },
  publicPath: '/',
  assetsBuildDirectory: 'build/client',
  isSpaMode: false,
  future: {
    v3_fetcherPersist: true,
    v3_relativeSplatPath: true,
    v3_throwAbortReason: true,
    v3_lazyRouteDiscovery: false,
    v3_singleFetch: false,
  },
};
test('Remix 2 renders approved Arabic and Taiwan Chinese with request-owned ICU catalogs and reciprocal SEO', async () => {
  const handler = createRequestHandler(build, 'production');
  const [arabic, chinese, german] = await Promise.all(
    ['/ar/about', '/zh-tw/about', '/de/about'].map((path) =>
      handler(
        new Request(`https://example.test${path}`, {
          headers: { cookie: 'el_locale=en', 'accept-language': 'fr' },
        }),
      ),
    ),
  );
  assert.equal(arabic!.status, 200);
  const ar = await arabic!.text(),
    zh = await chinese!.text(),
    de = await german!.text();
  assert.match(ar, /<html lang="ar" dir="rtl"/);
  assert.match(ar, /مرحبًا Ali/);
  assert.match(zh, /你好 Ali/);
  assert.match(de, /Hallo Ali/);
  assert.match(ar, /rel="canonical" href="https:\/\/example.test\/ar\/about"/);
  assert.match(ar, /hrefLang="zh-Hant-TW"/i);
  assert.match(zh, /hrefLang="ar"/i);
  assert.match(de, /x-default/);
  assert.equal((await handler(new Request('https://example.test/fr/about'))).status, 404);
  assert.equal((await handler(new Request('https://example.test/zh-cn/about'))).status, 404);
});
test('language controls render native labels and bundled flags without changing language from country', () => {
  const markup = renderToString(
    h(LanguageSelector, { locale: 'ar', country: 'AE', onChange() {} }),
  );
  assert.match(markup, /العربية/);
  assert.match(markup, /<svg/);
  assert.match(markup, /<option value="ar"[^>]*selected/);
  assert.doesNotMatch(markup, /🇦🇪/);
  assert.ok(renderToString(h(LocaleFlag, { locale: 'zh-Hant-TW' })).includes('<svg'));
  assert.equal(renderToString(h(LanguageSuggestion, { locale: 'en', onChoose() {} })), '');
});
