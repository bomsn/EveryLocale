import type { ReactNode } from 'react';
import { resolveRequest } from '@everylocale/adapters';
export default async function Layout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ segments?: string[] }>;
}) {
  const { segments = [] } = await params;
  const locale = resolveRequest(new Request('https://example.test/' + segments.join('/')));
  return (
    <html lang={locale.locale} dir={locale.direction}>
      <body>{children}</body>
    </html>
  );
}
