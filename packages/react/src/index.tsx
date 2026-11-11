'use client';

import { IntlProvider, FormattedMessage, useIntl } from 'react-intl';
import type { ReactNode } from 'react';
import type { ApprovedCatalog } from '@everylocale/core/types';

export type RuntimeCatalog = Pick<ApprovedCatalog, 'locale' | 'messages' | 'revision'>;
/** Request-owned catalog data is serialized by the host for identical SSR/hydration. */
export function EveryLocaleProvider({
  catalog,
  children,
  onError,
}: {
  catalog: RuntimeCatalog;
  children: ReactNode;
  onError?: (error: Error) => void;
}) {
  return (
    <IntlProvider
      locale={catalog.locale}
      messages={catalog.messages}
      defaultLocale="en"
      onError={onError}
    >
      {children}
    </IntlProvider>
  );
}
export { FormattedMessage as Message, useIntl as useEveryLocale };
export { LocaleFlag, LanguageLinks, LanguageSelect, type FlagSet } from './controls.js';
export { LanguageSuggestion, type LanguageSuggestionLabels } from './suggestion.js';
