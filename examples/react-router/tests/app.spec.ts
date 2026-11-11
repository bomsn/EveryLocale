import { readdir, readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

type Case = {
  prefix: string;
  lang: string;
  dir: 'ltr' | 'rtl';
  heading: string;
  /** Rendered plural messages for 0, 1, 2 and 1,000,000; group separators match loosely. */
  files: [string, string, string, RegExp];
};

const CASES: Case[] = [
  {
    prefix: '',
    lang: 'en',
    dir: 'ltr',
    heading: 'Welcome, Ana!',
    files: ['0 files', '1 file', '2 files', /^1,000,000 files$/],
  },
  {
    prefix: '/es',
    lang: 'es',
    dir: 'ltr',
    heading: '¡Hola, Ana!',
    files: ['0 archivos', '1 archivo', '2 archivos', /^1\.000\.000 de archivos$/],
  },
  {
    prefix: '/fr-ca',
    lang: 'fr-CA',
    dir: 'ltr',
    heading: 'Bienvenue, Ana!',
    files: ['0 fichier', '1 fichier', '2 fichiers', /^1\s000\s000 de fichiers$/],
  },
  {
    prefix: '/zh-tw',
    lang: 'zh-TW',
    dir: 'ltr',
    heading: '歡迎，Ana！',
    files: ['0 個檔案', '1 個檔案', '2 個檔案', /^1,000,000 個檔案$/],
  },
  {
    prefix: '/ar',
    lang: 'ar',
    dir: 'rtl',
    heading: 'مرحبًا، Ana!',
    files: ['لا توجد ملفات', 'ملف واحد', 'ملفان', /^1,000,000 ملف$/],
  },
  {
    prefix: '/de',
    lang: 'de',
    dir: 'ltr',
    heading: 'Willkommen, Ana!',
    files: ['0 Dateien', '1 Datei', '2 Dateien', /^1\.000\.000 Dateien$/],
  },
];

/** Collects console errors and warnings and page errors, including hydration mismatches. */
function watch(page: Page) {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  return problems;
}

/** React attaches its root to the document once hydration has run. */
const hydrated = (page: Page) =>
  page.waitForFunction(() =>
    Object.keys(document).some((key) => key.startsWith('__reactContainer')),
  );

const axeViolations = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations.map(
    (violation) => `${violation.id}: ${violation.nodes.map((node) => node.html).join(' ')}`,
  );

for (const item of CASES) {
  test(`${item.lang}: server HTML, hydration, plurals and accessibility`, async ({
    page,
    request,
  }) => {
    const html = await (await request.get(`${item.prefix}/`)).text();
    expect(html).toContain(`<html lang="${item.lang}" dir="${item.dir}">`);

    const problems = watch(page);
    await page.goto(`${item.prefix}/`);
    await hydrated(page);
    await expect(page.locator('html')).toHaveAttribute('lang', item.lang);
    await expect(page.locator('html')).toHaveAttribute('dir', item.dir);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(item.heading);
    const [zero, one, two, million] = item.files;
    const expected: Array<[number, string | RegExp]> = [
      [0, zero],
      [1, one],
      [2, two],
      [1_000_000, million],
    ];
    for (const [count, text] of expected)
      await expect(page.locator(`li[data-count="${String(count)}"]`)).toHaveText(text);
    expect(await axeViolations(page)).toEqual([]);
    expect(problems).toEqual([]);
  });
}

test('client navigation brings the next route and its messages without a reload', async ({
  page,
}) => {
  const problems = watch(page);
  await page.goto('/de/');
  await hydrated(page);
  const documents: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'document') documents.push(request.url());
  });
  await page.getByRole('link', { name: 'Infoseite' }).click();
  await expect(page).toHaveURL(/\/de\/about$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Über diese Website');
  await expect(page).toHaveTitle('Über diese Website');
  expect(documents, 'the page changed without a full reload').toEqual([]);
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  expect(await axeViolations(page)).toEqual([]);
  expect(problems).toEqual([]);
});

test('language links are crawlable and the head carries canonical, hreflang and x-default', async ({
  page,
}) => {
  await page.goto('/zh-tw/about');
  const links = page.getByRole('navigation', { name: '其他語言' }).getByRole('link');
  await expect(links).toHaveCount(6);
  const arabic = links.filter({ hasText: 'العربية' });
  await expect(arabic).toHaveAttribute('href', '/ar/about');
  await expect(arabic).toHaveAttribute('hreflang', 'ar');
  await expect(arabic).toHaveAttribute('lang', 'ar');
  await expect(links.filter({ hasText: '中文' })).toHaveAttribute('aria-current', 'page');
  const head = page.locator('head');
  await expect(head.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'http://localhost:4316/zh-tw/about',
  );
  await expect(head.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute(
    'href',
    'http://localhost:4316/about',
  );
  await expect(head.locator('link[rel="alternate"]')).toHaveCount(7);
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the language form switches language and remembers the choice', async ({
    page,
    context,
  }) => {
    await page.goto('/about');
    await page.getByLabel('Language', { exact: true }).selectOption('ar');
    await page.getByRole('button', { name: 'Change language' }).click();
    await expect(page).toHaveURL(/\/ar\/about$/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('حول هذا الموقع');
    const cookies = await context.cookies();
    expect(cookies.find((cookie) => cookie.name === 'el_locale')?.value).toBe('ar');
  });
});

test('unknown prefixes answer 404, other letter case redirects, and the form refuses bad input', async ({
  request,
}) => {
  expect((await request.get('/xx/about')).status()).toBe(404);
  const folded = await request.get('/DE/about', { maxRedirects: 0 });
  expect(folded.status()).toBe(308);
  expect(folded.headers().location).toBe('/de/about');
  expect((await request.get('/language?locale=xx&path=/about')).status()).toBe(400);
  expect((await request.get('/language?locale=de&path=//evil.example/')).status()).toBe(400);
});

test('the client bundle ships without the ICU parser and within its budget', async () => {
  const directory = 'build/client/assets';
  let total = 0;
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.js')) continue;
    const text = await readFile(join(directory, name), 'utf8');
    // Both strings exist only in the parser's error codes.
    expect(text, name).not.toContain('MALFORMED_ARGUMENT');
    expect(text, name).not.toContain('EXPECT_ARGUMENT_CLOSING_BRACE');
    total += gzipSync(text).length;
  }
  expect(total).toBeLessThan(120_000);
});
