import type { ReactNode } from 'react';
import { useSyncExternalStore } from 'react';
import { languageSuggestion, type LocaleDefinition } from '@everylocale/core/locales';

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
  locales,
  dismissed,
  onAccept,
  onDismiss,
  labels,
}: {
  locale: string;
  locales: readonly LocaleDefinition[];
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
