import type { ReactNode } from 'react';
import '@everylocale/react/fonts.css';
import { resolveRequest } from '@everylocale/adapters';
import { localization, ORIGIN } from '../i18n';

export default async function Layout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ segments?: string[] }>;
}) {
  const { segments = [] } = await params;
  const { locales } = await localization;
  const locale = resolveRequest(new Request(`${ORIGIN}/${segments.join('/')}`), { locales });
  return (
    <html lang={locale.locale} dir={locale.direction}>
      <body>{children}</body>
    </html>
  );
}
