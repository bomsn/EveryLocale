import { notFound } from 'next/navigation';
import { nextMetadata, resolveRequest } from '@everylocale/adapters';
import { createFormatter, localizePath } from '@everylocale/runtime';
import { EveryLocaleProvider, LanguageLinks, LocaleFlag, Message } from '@everylocale/react';
import tw from '@everylocale/react/flags/tw';
import { localization, ORIGIN } from '../i18n';

export const dynamic = 'force-dynamic';

/**
 * The one page, `/about`, in every served locale. Anything else, including the prefix of a
 * draft or unknown locale, is a 404 rather than English under a foreign URL.
 */
async function pageData(params: Promise<{ segments?: string[] }>) {
  const { segments = [] } = await params;
  const path = '/' + segments.join('/');
  const l10n = await localization;
  const selected = resolveRequest(new Request(ORIGIN + path), { locales: l10n.locales });
  const paths = Object.fromEntries(
    l10n.locales.map((item) => [item.id, localizePath('/about', item.id, l10n.locales)]),
  );
  if (paths[selected.locale] !== path) notFound();
  const messages = l10n.messages(selected.locale, ['about']);
  const { format } = createFormatter({ locale: selected.locale, messages });
  return { l10n, selected, paths, messages, format };
}

export async function generateMetadata({ params }: { params: Promise<{ segments?: string[] }> }) {
  const { l10n, selected, paths, format } = await pageData(params);
  return {
    title: format('about:title'),
    ...nextMetadata(ORIGIN, paths, selected.locale, l10n.sourceLocale),
  };
}

export default async function Page({ params }: { params: Promise<{ segments?: string[] }> }) {
  const { l10n, selected, paths, messages, format } = await pageData(params);
  return (
    <main>
      <h1>{format('about:title')}</h1>
      {/* The client provider receives exactly the messages this page rendered with. */}
      <EveryLocaleProvider locale={selected.locale} messages={messages}>
        <p>
          <Message id="about:greeting" values={{ name: 'Ali' }} />
        </p>
        <LocaleFlag locale={selected.locale} flags={{ tw }} />
      </EveryLocaleProvider>
      <LanguageLinks
        locale={selected.locale}
        locales={l10n.locales}
        label={format('about:languages')}
        links={paths}
      />
    </main>
  );
}
