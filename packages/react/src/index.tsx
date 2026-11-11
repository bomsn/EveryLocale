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
import { useState, useId, useSyncExternalStore } from 'react';
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
  errorMessage = 'The language could not be changed. Please try again.',
}: {
  locale: string;
  onChange: (locale: string) => void | Promise<void>;
  country?: string | null;
  locales?: readonly LocaleDefinition[];
  label?: string;
  errorMessage?: string;
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
        onChange={(event) => {
          const target = event.target.value;
          setPending(true);
          setError('');
          void (async () => {
            try {
              await onChange(target);
            } catch {
              setError(errorMessage);
            } finally {
              setPending(false);
            }
          })();
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

const subscribeToLanguages = (onChange: () => void) => {
  window.addEventListener('languagechange', onChange);
  return () => {
    window.removeEventListener('languagechange', onChange);
  };
};
// Joined so the snapshot is a stable primitive; server rendering and hydration see no preference.
const browserLanguages = () => navigator.languages.join(',');
const noLanguages = () => '';

export type LanguageSuggestionLabels = {
  /** Accessible name of the suggestion region. */
  region: string;
  /** Renders the prompt; `language` is the suggested language's native name, already isolated. */
  prompt: (language: ReactNode) => ReactNode;
  accept: (language: ReactNode) => ReactNode;
  dismiss: string;
};

/**
 * Suggests the visitor's browser language after hydration. It never redirects and never saves a
 * preference: the host decides what `onAccept` does and where a dismissal is remembered.
 */
export function LanguageSuggestion({
  locale,
  locales = DEFAULT_LOCALES,
  dismissed,
  onAccept,
  onDismiss,
  labels,
}: {
  locale: string;
  locales?: readonly LocaleDefinition[];
  dismissed: boolean;
  onAccept: (locale: string) => void;
  onDismiss: () => void;
  labels: LanguageSuggestionLabels;
}) {
  const preferences = useSyncExternalStore(subscribeToLanguages, browserLanguages, noLanguages);
  if (dismissed || !preferences) return null;
  const suggestion = languageSuggestion(preferences.split(','), locale, locales);
  if (!suggestion) return null;
  const name = (
    <bdi lang={suggestion}>
      {locales.find((item) => item.id === suggestion)?.label ?? suggestion}
    </bdi>
  );
  return (
    <aside aria-label={labels.region}>
      {labels.prompt(name)}{' '}
      <button
        type="button"
        onClick={() => {
          onAccept(suggestion);
        }}
      >
        {labels.accept(name)}
      </button>{' '}
      <button type="button" onClick={onDismiss}>
        {labels.dismiss}
      </button>
    </aside>
  );
}
