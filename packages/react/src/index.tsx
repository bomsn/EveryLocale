'use client';

import { IntlProvider, FormattedMessage, useIntl } from 'react-intl';
import type { ReactNode } from 'react';
import type { ApprovedCatalog } from '@everylocale/core/types';
import {
  DEFAULT_LOCALES,
  arabicFlag,
  languageSuggestion,
  type LocaleDefinition,
} from '@everylocale/core/locales';
import { useState, useEffect, useId } from 'react';
import { FLAGS } from './flags.js';

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

export function LocaleFlag({
  locale,
  country,
  locales = DEFAULT_LOCALES,
}: {
  locale: string;
  country?: string | null;
  locales?: readonly LocaleDefinition[];
}) {
  const code =
    locale === 'ar'
      ? arabicFlag(country ?? null)
      : locales.find((item) => item.id === locale)?.flag;
  const svg = code ? FLAGS[code] : null;
  return svg ? (
    <span
      aria-hidden="true"
      style={{ display: 'inline-flex', width: 24, height: 18, flexShrink: 0 }}
      dangerouslySetInnerHTML={{ __html: svg.replace('<svg ', '<svg width="24" height="18" ') }}
    />
  ) : null;
}

/** The host persists explicit selections; country only decorates the current language. */
export function LanguageSelector({
  locale,
  onChange,
  country,
  locales = DEFAULT_LOCALES,
  label = 'Language',
}: {
  locale: string;
  onChange: (locale: string) => void | Promise<void>;
  country?: string | null;
  locales?: readonly LocaleDefinition[];
  label?: string;
}) {
  const id = useId();
  const [pending, setPending] = useState(false),
    [error, setError] = useState('');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <label htmlFor={id}>{label}</label>
      <LocaleFlag locale={locale} country={country} locales={locales} />
      <select
        id={id}
        value={locale}
        disabled={pending}
        aria-busy={pending}
        onChange={async (event) => {
          const target = event.target.value;
          setPending(true);
          setError('');
          try {
            await onChange(target);
          } catch {
            setError('The language could not be changed. Please try again.');
          } finally {
            setPending(false);
          }
        }}
      >
        {locales.map((item) => (
          <option value={item.id} key={item.id} lang={item.id}>
            {item.label}
          </option>
        ))}
      </select>
      {error ? <span role="alert">{error}</span> : null}
    </div>
  );
}

/** Browser preferences produce a dismissible suggestion, never a redirect or preference write. */
export function LanguageSuggestion({
  locale,
  onChoose,
  locales = DEFAULT_LOCALES,
}: {
  locale: string;
  onChoose: (locale: string) => void;
  locales?: readonly LocaleDefinition[];
}) {
  const [suggestion, setSuggestion] = useState<string | null>(null);
  useEffect(() => {
    try {
      if (sessionStorage.getItem('everylocale-suggestion-dismissed')) return;
    } catch {}
    setSuggestion(languageSuggestion(navigator.languages, locale, locales));
  }, [locale, locales]);
  if (!suggestion) return null;
  const label = locales.find((item) => item.id === suggestion)?.label ?? suggestion;
  return (
    <aside aria-label="Language suggestion">
      <span>{label}?</span>{' '}
      <button
        onClick={() => {
          onChoose(suggestion);
          setSuggestion(null);
        }}
      >
        Use {label}
      </button>{' '}
      <button
        aria-label="Dismiss language suggestion"
        onClick={() => {
          setSuggestion(null);
          try {
            sessionStorage.setItem('everylocale-suggestion-dismissed', '1');
          } catch {}
        }}
      >
        Dismiss
      </button>
    </aside>
  );
}
