import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import {
  createStaticHandler,
  createStaticRouter,
  StaticRouterProvider,
  useOutlet,
  type RouteObject,
} from 'react-router';
import { parseAppConfig } from '../packages/core/dist/config.js';
import { ReleaseError } from '../packages/runtime/dist/server.js';
import { Message, useMessages } from '../packages/react/dist/index.js';
import { createI18n, I18nConfigError } from '../packages/react-router/dist/server.js';
import {
  EveryLocaleRouterProvider,
  formatterOf,
  languageMeta,
  languagePaths,
  useLocaleData,
} from '../packages/react-router/dist/index.js';
import { releaseFromFiles, withLocalService } from '../tools/local-service.js';

/**
 * The example app's catalogs plus a draft French locale with one translated message, released
 * through the real service and CLI.
 */
const app = await mkdtemp(join(tmpdir(), 'everylocale-react-router-'));
after(() => rm(app, { recursive: true, force: true }));
await cp('examples/react-router/locales', join(app, 'locales'), { recursive: true });
const config = JSON.parse(
  await readFile('examples/react-router/everylocale.config.json', 'utf8'),
) as { locales: Array<{ id: string; status?: string }>; $schema?: string };
delete config.$schema;
config.locales.push({ id: 'fr', status: 'draft' });
const configPath = join(app, 'everylocale.config.json');
await writeFile(configPath, JSON.stringify(config));
await cp(join(app, 'locales/fr-CA'), join(app, 'locales/fr'), { recursive: true });
await writeFile(join(app, 'locales/fr/home.json'), '{}');
await writeFile(join(app, 'locales/fr/about.json'), '{}');
await withLocalService(parseAppConfig(config), (service) =>
  releaseFromFiles(service, app, parseAppConfig(config)),
);

const origin = 'https://files.example';
const args = (path: string, locale?: string) => ({
  request: new Request(`${origin}${path}`),
  params: { locale },
});
const thrown = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
  assert.fail('expected a response to be thrown');
};

test('startup refuses a missing config, a missing release, an uncovered locale and a bad origin', async () => {
  await assert.rejects(createI18n({ config: join(app, 'none.json'), origin }), I18nConfigError);
  const empty = await mkdtemp(join(tmpdir(), 'everylocale-empty-'));
  try {
    await writeFile(join(empty, 'everylocale.config.json'), JSON.stringify(config));
    await assert.rejects(
      createI18n({ config: join(empty, 'everylocale.config.json'), origin }),
      ReleaseError,
    );
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
  const extra = join(app, 'extra.config.json');
  await writeFile(extra, JSON.stringify({ ...config, locales: [...config.locales, { id: 'it' }] }));
  await assert.rejects(createI18n({ config: extra, origin }), /has no it; run everylocale pull/);
  const other = join(app, 'other.config.json');
  await writeFile(
    other,
    JSON.stringify({ ...config, sourceLocale: 'de', locales: [{ id: 'en' }] }),
  );
  await assert.rejects(createI18n({ config: other, origin }), /source locale en/);
  await assert.rejects(createI18n({ config: configPath, origin: 'ftp://files.example' }), /origin/);
});

test('the URL decides the locale on public pages, and unknown or unserved prefixes are 404', async () => {
  const i18n = await createI18n({ config: configPath, origin });
  assert.deepEqual(
    i18n.locales.map((item) => item.id),
    ['en', 'es', 'fr-CA', 'zh-TW', 'ar', 'de'],
    'the draft locale is not served',
  );
  const german = i18n.root(args('/de/about', 'de'), ['app']);
  assert.equal(german.locale, 'de');
  assert.equal(german.pathname, '/about');
  assert.equal(german.origin, origin);
  assert.ok(german.messages['app:site'], 'root namespaces are compiled in');
  assert.equal(i18n.root(args('/ar', 'ar')).direction, 'rtl');
  assert.equal(i18n.root(args('/about')).locale, 'en');
  assert.equal(thrown(() => i18n.root(args('/xx/about', 'xx'))).status, 404);
  assert.equal(thrown(() => i18n.root(args('/fr/about', 'fr'))).status, 404, 'draft');
  assert.equal(thrown(() => i18n.messages(args('/fr/about'), ['about'])).status, 404, 'no param');
  const folded = thrown(() => i18n.root(args('/ZH-TW/about?tab=1', 'ZH-TW')));
  assert.equal(folded.status, 308);
  assert.equal(folded.headers.get('location'), '/zh-tw/about?tab=1');
  assert.throws(() => i18n.messages(args('/de', 'de'), ['nothing']), ReleaseError);
  assert.equal(thrown(() => i18n.requirePublished(args('/es', 'es'), ['en', 'de'])).status, 404);
  i18n.requirePublished(args('/de', 'de'), ['en', 'de']);
});

test('signed-in pages follow the saved preference instead of the URL', async () => {
  const i18n = await createI18n({ config: configPath, origin });
  const surface = { privateSurface: true, profileLocale: 'de-AT' };
  assert.equal(i18n.root(args('/about'), [], surface).locale, 'de');
  assert.equal(i18n.root(args('/about'), [], { privateSurface: true }).locale, 'en');
});

test('preview deployments serve drafts with source text for missing messages', async () => {
  const reports: Array<{ locale: string; missing: readonly string[] }> = [];
  const i18n = await createI18n({
    config: configPath,
    origin,
    drafts: true,
    onFallback: (report) => reports.push(report),
  });
  assert.deepEqual(
    reports.map((item) => item.locale),
    ['fr'],
  );
  assert.ok(reports[0]?.missing.includes('about:heading'));
  const french = i18n.messages(args('/fr/about', 'fr'), ['app', 'about']);
  const english = i18n.messages(args('/about'), ['app', 'about']);
  assert.deepEqual(french['about:heading'], english['about:heading'], 'source fallback');
  assert.notDeepEqual(french['app:site'], english['app:site'], 'approved translation');
});

test('the language form redirects to the chosen locale, stores the choice and refuses bad input', async () => {
  const i18n = await createI18n({ config: configPath, origin });
  const response = i18n.switchLocale(args('/language?locale=zh-TW&path=/de/about?x=1'));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/zh-tw/about?x=1');
  assert.match(response.headers.get('set-cookie') ?? '', /^el_locale=zh-TW; Path=\/;.*; Secure$/);
  for (const query of [
    'locale=xx&path=/about',
    'locale=fr&path=/about',
    'locale=de&path=//evil.example/',
    'locale=de&path=/%5Cevil.example/',
    'locale=de&path=https://evil.example/',
  ])
    assert.equal(i18n.switchLocale(args(`/language?${query}`)).status, 400, query);
});

test('server rendering merges the messages of every matched route under the root locale', async () => {
  const i18n = await createI18n({ config: configPath, origin });
  function Root() {
    // React Router's declarations resolve the React 19 types the examples hoist, while these
    // tests compile against React 18; at runtime both are the same React.
    return h(EveryLocaleRouterProvider, { missing: 'throw', children: useOutlet() as ReactNode });
  }
  function About() {
    const { format } = useMessages();
    const data = useLocaleData();
    return h(
      'main',
      null,
      h('h1', null, h(Message, { id: 'about:heading' })),
      h('p', null, format('app:site')),
      h('p', null, Object.values(data ? languagePaths(data) : {}).join(' ')),
    );
  }
  const routes: RouteObject[] = [
    {
      id: 'root',
      path: '/',
      loader: (loaderArgs) => i18n.root(loaderArgs, ['app']),
      Component: Root,
      children: [
        {
          path: ':locale?/about',
          loader: (loaderArgs) => ({ messages: i18n.messages(loaderArgs, ['about']) }),
          Component: About,
        },
      ],
    },
  ];
  const handler = createStaticHandler(routes);
  const render = async (path: string) => {
    const context = await handler.query(new Request(`${origin}${path}`));
    assert.ok(!(context instanceof Response));
    const router = createStaticRouter(handler.dataRoutes, context);
    return {
      html: renderToString(h(StaticRouterProvider, { router, context, hydrate: false })),
      matches: context.matches.map((match) => ({ loaderData: context.loaderData[match.route.id] })),
    };
  };
  const german = await render('/de/about');
  assert.match(german.html, /<h1>Über diese Website<\/h1><p>Dateibibliothek<\/p>/);
  assert.match(
    german.html,
    /\/about \/es\/about \/fr-ca\/about \/zh-tw\/about \/ar\/about \/de\/about/,
  );
  assert.equal(formatterOf(german.matches)?.format('about:heading'), 'Über diese Website');
  assert.deepEqual(languageMeta(german.matches, ['en', 'de']), [
    { tagName: 'link', rel: 'canonical', href: `${origin}/de/about` },
    { tagName: 'link', rel: 'alternate', hrefLang: 'en', href: `${origin}/about` },
    { tagName: 'link', rel: 'alternate', hrefLang: 'de', href: `${origin}/de/about` },
    { tagName: 'link', rel: 'alternate', hrefLang: 'x-default', href: `${origin}/about` },
  ]);
  const arabic = await render('/ar/about');
  assert.match(arabic.html, /<h1>حول هذا الموقع<\/h1><p>مكتبة الملفات<\/p>/);
  // A failed root loader leaves no locale data; meta helpers then return nothing.
  assert.deepEqual(languageMeta([undefined]), []);
  assert.equal(formatterOf([{ loaderData: undefined }]), undefined);
});
