import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveRequest,
  nextMetadata,
  switchPage,
  PublishedRegistry,
} from '../packages/adapters/dist/index.js';
import { defineLocales } from '../packages/core/dist/index.js';

const locales = defineLocales('en', [
  'ar',
  { id: 'zh-Hant-TW', prefix: 'zh-tw' },
  'de',
  'es',
  'fr',
]);

test('request resolution and Next.js metadata agree on URL ownership and published alternates', () => {
  const request = new Request('https://example.test/de/pricing', {
    headers: { cookie: 'el_locale=fr' },
  });
  assert.deepEqual(resolveRequest(request, { profileLocale: 'en', locales }), {
    locale: 'de',
    direction: 'ltr',
    pathname: '/pricing',
  });
  const paths = { en: '/pricing', de: '/de/pricing' };
  const next = nextMetadata('https://example.test', paths, 'de', 'en');
  assert.equal(next.alternates.canonical, 'https://example.test/de/pricing');
  assert.equal(next.alternates.languages['x-default'], 'https://example.test/pricing');
  assert.throws(() => nextMetadata('https://example.test', paths, 'fr', 'en'));
  assert.equal(switchPage('/blog/source', 'fr', locales, paths), null);
  const simultaneous = ['ar', 'de', 'fr', 'zh-tw'].map((prefix) =>
    resolveRequest(new Request(`https://example.test/${prefix}/pricing`), { locales }),
  );
  assert.deepEqual(
    simultaneous.map((x) => x.locale),
    ['ar', 'de', 'fr', 'zh-Hant-TW'],
  );
});

test('one immutable published snapshot owns strict routes, metadata, structured data and sitemap membership', () => {
  const pages = [
    {
      id: 'article',
      variants: [
        { locale: 'en', path: '/blog/article', title: 'Article', approvalRevision: 'source-1' },
        {
          locale: 'de',
          path: '/de/blog/artikel',
          title: 'Artikel',
          approvalRevision: 'approval-2',
        },
      ],
    },
  ];
  const registry = new PublishedRegistry('https://example.test', pages, locales);
  pages[0]!.variants[1]!.path = '/de/changed';
  assert.equal(registry.resolve('/de/blog/artikel')?.variant.title, 'Artikel');
  assert.equal(registry.resolve('/fr/blog/article'), null);
  assert.equal(registry.resolve('/zh-cn/blog/article'), null);
  assert.equal(registry.switch('article', 'fr'), null);
  assert.equal(registry.original('article'), '/blog/article');
  assert.equal(
    registry.link('/blog/article?utm_source=email#facts', 'de'),
    '/de/blog/artikel?utm_source=email#facts',
  );
  assert.equal(registry.link('/blog/article', 'fr'), '/blog/article');
  assert.equal(
    registry.link('https://elsewhere.test/blog/article', 'de'),
    'https://elsewhere.test/blog/article',
  );
  assert.deepEqual(registry.structuredData('article', 'de', { '@type': 'Article' }), {
    '@type': 'Article',
    url: 'https://example.test/de/blog/artikel',
    inLanguage: 'de',
    name: 'Artikel',
  });
  const sitemap = registry.sitemap();
  assert.equal((sitemap.match(/<url>/g) ?? []).length, 2);
  assert.equal((sitemap.match(/hreflang="x-default"/g) ?? []).length, 2);
  assert.doesNotMatch(sitemap, /hreflang="fr"/);
  assert.throws(
    () =>
      new PublishedRegistry(
        'https://example.test',
        [
          {
            id: 'x',
            variants: [
              { locale: 'en', path: '//evil.test/article', title: 'Title', approvalRevision: '1' },
            ],
          },
        ],
        locales,
      ),
  );
  assert.throws(
    () =>
      new PublishedRegistry(
        'https://example.test',
        [
          {
            id: 'x',
            variants: [{ locale: 'de', path: '/article', title: 'Title', approvalRevision: '1' }],
          },
        ],
        locales,
      ),
  );
  const arabic = new PublishedRegistry(
    'https://example.test',
    [
      {
        id: 'arabic',
        variants: [
          { locale: 'en', path: '/report', title: 'Report', approvalRevision: '1' },
          { locale: 'ar', path: '/ar/تقارير', title: 'تقارير', approvalRevision: '2' },
        ],
      },
    ],
    locales,
  );
  assert.equal(arabic.resolve('/ar/تقارير')?.variant.locale, 'ar');
  assert.equal(
    arabic.metadata('arabic', 'ar').canonical,
    'https://example.test/ar/' + encodeURIComponent('تقارير'),
  );
});
