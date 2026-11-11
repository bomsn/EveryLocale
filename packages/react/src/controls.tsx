import { useId, type FormEvent } from 'react';
import { flagCountry, type LocaleDefinition } from '@everylocale/core/locales';

/** Flag markup by lower-case ISO country code, from `@everylocale/react/flags/<code>`. */
export type FlagSet = Readonly<Partial<Record<string, string>>>;

/**
 * Decorates a locale with a country flag the host imported. Flags stand for countries, not
 * languages, so a locale without a region uses the trusted visitor country when one is given.
 */
export function LocaleFlag({
  locale,
  flags,
  country,
}: {
  locale: string;
  flags: FlagSet;
  country?: string | null;
}) {
  const code = flagCountry(locale, country)?.toLowerCase();
  const svg = code ? flags[code] : undefined;
  if (!svg) return null;
  return (
    <span
      aria-hidden="true"
      style={{ display: 'inline-flex', width: 24, height: 18, flexShrink: 0 }}
      // Flag markup comes from the bundled flag-icons package, never from content.
      dangerouslySetInnerHTML={{ __html: svg.replace('<svg ', '<svg width="24" height="18" ') }}
    />
  );
}

/**
 * Links to each published counterpart of the current page. They work without JavaScript,
 * are crawlable, and carry `hreflang` and `lang`. Locales without a published page are omitted.
 */
export function LanguageLinks({
  locale,
  locales,
  links,
  label,
  flags,
}: {
  locale: string;
  locales: readonly LocaleDefinition[];
  /** Published counterpart URL by locale id. */
  links: Readonly<Partial<Record<string, string>>>;
  /** Accessible name of the navigation landmark. */
  label: string;
  flags?: FlagSet;
}) {
  const available = locales.flatMap((item) => {
    const href = links[item.id];
    return href ? [{ item, href }] : [];
  });
  return (
    <nav aria-label={label}>
      <ul>
        {available.map(({ item, href }) => (
          <li key={item.id}>
            <a
              href={href}
              hrefLang={item.id}
              lang={item.id}
              aria-current={item.id === locale ? 'page' : undefined}
            >
              {flags ? <LocaleFlag locale={item.id} flags={flags} /> : null}
              <bdi>{item.label}</bdi>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * A labelled select that changes language only when submitted, so moving through options with
 * a keyboard never navigates away. The form submits to `action` with the chosen locale in
 * `name` and works without JavaScript; `onSelect` lets a hydrated app handle it instead.
 */
export function LanguageSelect({
  locale,
  locales,
  action,
  label,
  submitLabel,
  name = 'locale',
  hidden,
  onSelect,
}: {
  locale: string;
  locales: readonly LocaleDefinition[];
  action: string;
  label: string;
  submitLabel: string;
  name?: string;
  /** Extra fields the server needs, such as the page to return to. */
  hidden?: Readonly<Record<string, string>>;
  onSelect?: (locale: string) => void;
}) {
  const id = useId();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    if (!onSelect) return;
    event.preventDefault();
    const value = new FormData(event.currentTarget).get(name);
    if (typeof value === 'string') onSelect(value);
  };
  return (
    <form method="get" action={action} onSubmit={submit}>
      <label htmlFor={id}>{label}</label>{' '}
      <select id={id} name={name} defaultValue={locale}>
        {locales.map((item) => (
          <option value={item.id} key={item.id} lang={item.id}>
            {item.label}
          </option>
        ))}
      </select>{' '}
      {Object.entries(hidden ?? {}).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <button type="submit">{submitLabel}</button>
    </form>
  );
}
