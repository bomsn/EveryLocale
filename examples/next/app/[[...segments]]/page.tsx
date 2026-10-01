import { notFound } from 'next/navigation';
import { nextMetadata, resolveRequest } from '@everylocale/adapters';
import { DEFAULT_LOCALES } from '@everylocale/core';
import { EveryLocaleProvider, Message, LocaleFlag } from '@everylocale/react';
export const dynamic = 'force-dynamic';
const pages: Record<string, { path: string; message: string; title: string }> = {
  en: { path: '/about', message: 'Hello {name}', title: 'About' },
  ar: { path: '/ar/about', message: 'مرحبًا {name}', title: 'حول التطبيق' },
  'zh-Hant-TW': { path: '/zh-tw/about', message: '你好 {name}', title: '關於' },
  de: { path: '/de/about', message: 'Hallo {name}', title: 'Über uns' },
};
async function pageData(params: Promise<{ segments?: string[] }>) {
  const { segments = [] } = await params;
  const path = '/' + segments.join('/');
  const selected = resolveRequest(new Request('https://example.test' + path));
  const page = pages[selected.locale];
  if (!page || page.path !== path) notFound();
  return { selected, page };
}
export async function generateMetadata({ params }: { params: Promise<{ segments?: string[] }> }) {
  const { selected, page } = await pageData(params);
  return {
    title: page.title,
    ...nextMetadata(
      'https://example.test',
      Object.fromEntries(Object.entries(pages).map(([locale, item]) => [locale, item.path])),
      selected.locale,
    ),
  };
}
export default async function Page({ params }: { params: Promise<{ segments?: string[] }> }) {
  const { selected, page } = await pageData(params);
  return (
    <main lang={selected.locale} dir={selected.direction}>
      <h1>{page.title}</h1>
      <EveryLocaleProvider
        catalog={{
          locale: selected.locale,
          revision: 'approved-fixture',
          messages: { greeting: page.message },
        }}
      >
        <p>
          <Message id="greeting" values={{ name: 'Ali' }} />
        </p>
        <LocaleFlag locale={selected.locale} />
      </EveryLocaleProvider>
      <nav aria-label="Language">
        {DEFAULT_LOCALES.filter((locale) => pages[locale.id]).map((locale) => (
          <a key={locale.id} href={pages[locale.id]!.path} lang={locale.id}>
            {locale.label}{' '}
          </a>
        ))}
      </nav>
    </main>
  );
}
