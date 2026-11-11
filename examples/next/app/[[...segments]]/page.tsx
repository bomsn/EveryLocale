import { notFound } from 'next/navigation';
import { nextMetadata, resolveRequest } from '@everylocale/adapters';
import { EveryLocaleProvider, Message, LanguageLinks, LocaleFlag } from '@everylocale/react';
import tw from '@everylocale/react/flags/tw';
import { locales } from '../locales';
export const dynamic = 'force-dynamic';
const pages: Partial<Record<string, { path: string; message: string; title: string }>> = {
  en: { path: '/about', message: 'Hello {name}', title: 'About' },
  ar: { path: '/ar/about', message: 'مرحبًا {name}', title: 'حول التطبيق' },
  'zh-Hant-TW': { path: '/zh-tw/about', message: '你好 {name}', title: '關於' },
  de: { path: '/de/about', message: 'Hallo {name}', title: 'Über uns' },
};
async function pageData(params: Promise<{ segments?: string[] }>) {
  const { segments = [] } = await params;
  const path = '/' + segments.join('/');
  const selected = resolveRequest(new Request('https://example.test' + path), { locales });
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
      Object.fromEntries(
        Object.entries(pages).flatMap(([locale, item]) => (item ? [[locale, item.path]] : [])),
      ),
      selected.locale,
      'en',
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
        <LocaleFlag locale={selected.locale} flags={{ tw }} />
      </EveryLocaleProvider>
      <LanguageLinks
        locale={selected.locale}
        locales={locales}
        label="Language"
        links={Object.fromEntries(
          Object.entries(pages).flatMap(([locale, item]) => (item ? [[locale, item.path]] : [])),
        )}
      />
    </main>
  );
}
