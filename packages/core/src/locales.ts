/** ISO 15924 scripts written right to left. */
const RTL_SCRIPTS: ReadonlySet<string> = new Set([
  'Adlm',
  'Arab',
  'Hebr',
  'Mand',
  'Mend',
  'Nkoo',
  'Rohg',
  'Samr',
  'Syrc',
  'Thaa',
  'Yezi',
]);

export type LocaleTraits = {
  language: string;
  /** Explicit or likely script, so `zh-TW` and `zh-Hant-TW` both report `Hant`. */
  script: string | undefined;
  region: string | undefined;
  direction: 'ltr' | 'rtl';
};
/** Script, region and direction come from CLDR likely subtags, never from string prefixes. */
export function localeTraits(id: string): LocaleTraits {
  const locale = new Intl.Locale(id);
  const likely = locale.maximize();
  return {
    language: locale.language,
    script: likely.script,
    region: locale.region ?? likely.region,
    direction: likely.script && RTL_SCRIPTS.has(likely.script) ? 'rtl' : 'ltr',
  };
}

export type LocaleStatus = 'live' | 'draft';
/** A locale as a host declares it; everything but the id has a derived default. */
export type LocaleInput = {
  id: string;
  /** Live locales must be complete; draft locales may be published partially or not at all. */
  status?: LocaleStatus;
  /** Name shown in language controls. Defaults to the CLDR name in the language itself. */
  label?: string;
  /** URL segment. Defaults to the lower-cased id; the source locale defaults to no prefix. */
  prefix?: string;
  direction?: 'ltr' | 'rtl';
};
export type LocaleDefinition = Required<LocaleInput>;

export function canonicalLocale(input: string): string | null {
  try {
    return Intl.getCanonicalLocales(input.replaceAll('_', '-'))[0] ?? null;
  } catch {
    return null;
  }
}

/** The language's own name for itself, with the first letter capitalized for menus. */
export function nativeLanguageName(id: string): string {
  const name = new Intl.DisplayNames([id], { type: 'language' }).of(id) ?? id;
  const [first = ''] = name;
  return first.toLocaleUpperCase(id) + name.slice(first.length);
}

/**
 * Builds the locale registry every package reads: the source locale first, then the targets.
 * Ids are canonicalized, and duplicate ids or URL prefixes are rejected.
 */
export function defineLocales(
  source: string | LocaleInput,
  targets: readonly (string | LocaleInput)[],
): readonly LocaleDefinition[] {
  const entries = [source, ...targets].map((entry) =>
    typeof entry === 'string' ? { id: entry } : entry,
  );
  const definitions = entries.map((entry, index): LocaleDefinition => {
    const id = canonicalLocale(entry.id);
    if (!id) throw new Error(`Invalid locale id: ${entry.id}`);
    const prefix = entry.prefix ?? (index === 0 ? '' : id.toLowerCase());
    if (!/^(?:[a-z0-9]+(?:-[a-z0-9]+)*)?$/.test(prefix))
      throw new Error(`Invalid URL prefix for ${id}: ${prefix}`);
    return {
      id,
      status: entry.status ?? 'live',
      label: entry.label ?? nativeLanguageName(id),
      prefix,
      direction: entry.direction ?? localeTraits(id).direction,
    };
  });
  const ids = new Set(definitions.map((item) => item.id));
  const prefixes = new Set(definitions.map((item) => item.prefix));
  if (ids.size !== definitions.length) throw new Error('Locale ids must be unique');
  if (prefixes.size !== definitions.length) throw new Error('Locale URL prefixes must be unique');
  return Object.freeze(definitions.map((item) => Object.freeze(item)));
}

/**
 * Finds the configured locale for a browser or account preference: the exact locale first,
 * then the same language, script and region, then the same language and script. Script
 * matching keeps a Simplified Chinese preference away from Traditional Chinese.
 */
export function matchLocale(input: string, locales: readonly LocaleDefinition[]): string | null {
  const canonical = canonicalLocale(input);
  if (!canonical) return null;
  const exact = locales.find((item) => item.id.toLowerCase() === canonical.toLowerCase());
  if (exact) return exact.id;
  const wanted = new Intl.Locale(canonical).maximize();
  const candidates = locales.filter((item) => {
    const available = new Intl.Locale(item.id).maximize();
    return available.language === wanted.language && available.script === wanted.script;
  });
  return (
    candidates.find((item) => new Intl.Locale(item.id).maximize().region === wanted.region)?.id ??
    candidates[0]?.id ??
    null
  );
}

export function languageSuggestion(
  preferences: readonly string[],
  current: string,
  locales: readonly LocaleDefinition[],
): string | null {
  for (const preference of preferences) {
    const matched = matchLocale(preference, locales);
    if (matched) return matched === current ? null : matched;
  }
  return null;
}

/** Country decoration for a locale: its explicit region, else a trusted visitor country, else the likely region. */
export function flagCountry(locale: string, country?: string | null): string | undefined {
  const parsed = new Intl.Locale(locale);
  if (parsed.region) return parsed.region;
  if (country && /^[A-Za-z]{2}$/.test(country)) return country.toUpperCase();
  return parsed.maximize().region;
}

const sourceLocaleOf = (locales: readonly LocaleDefinition[]) => {
  const [source] = locales;
  if (!source) throw new Error('The locale registry is empty');
  return source;
};

export function localeFromPath(
  pathname: string,
  locales: readonly LocaleDefinition[],
): { locale: string; pathname: string; explicit: boolean } {
  const first = pathname.split('/')[1] ?? '';
  const found = locales.find(
    (item) => item.prefix && item.prefix.toLowerCase() === first.toLowerCase(),
  );
  if (found)
    return { locale: found.id, pathname: pathname.slice(first.length + 1) || '/', explicit: true };
  const unprefixed = locales.find((item) => !item.prefix) ?? sourceLocaleOf(locales);
  return { locale: unprefixed.id, pathname, explicit: false };
}

export function localizePath(
  pathname: string,
  locale: string,
  locales: readonly LocaleDefinition[],
): string {
  if (!pathname.startsWith('/') || pathname.startsWith('//'))
    throw new Error('Expected a same-origin pathname');
  const definition = locales.find((item) => item.id === locale);
  if (!definition) throw new Error(`Locale ${locale} is not configured`);
  const unprefixed = localeFromPath(pathname, locales).pathname;
  return definition.prefix
    ? `/${definition.prefix}${unprefixed === '/' ? '' : unprefixed}`
    : unprefixed;
}

/** Cookie name for an explicit language choice. */
export const LOCALE_COOKIE = 'el_locale';
export function readLocaleCookie(header: string | null): string | null {
  const raw = header
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${LOCALE_COOKIE}=`))
    ?.slice(LOCALE_COOKIE.length + 1);
  if (!raw) return null;
  try {
    return canonicalLocale(decodeURIComponent(raw));
  } catch {
    return null;
  }
}
export function localeCookie(locale: string, secure: boolean, domain?: string): string {
  const canonical = canonicalLocale(locale);
  if (!canonical) throw new Error('Invalid locale');
  if (domain && !/^\.?[a-z0-9.-]+$/i.test(domain)) throw new Error('Invalid cookie domain');
  return `${LOCALE_COOKIE}=${encodeURIComponent(canonical)}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? '; Secure' : ''}${domain ? `; Domain=${domain}` : ''}`;
}

/**
 * Public pages take their language from the URL, so a shared link shows the same language to
 * everyone. Private surfaces use the saved account preference, then the explicit cookie, then
 * the source locale. Country, currency and time zone are never inputs.
 */
export function resolveLocale(options: {
  pathname: string;
  privateSurface: boolean;
  profile?: string | null;
  cookie?: string | null;
  locales: readonly LocaleDefinition[];
}): string {
  const { locales } = options;
  if (!options.privateSurface) return localeFromPath(options.pathname, locales).locale;
  for (const preference of [options.profile, options.cookie]) {
    const matched = preference ? matchLocale(preference, locales) : null;
    if (matched) return matched;
  }
  return sourceLocaleOf(locales).id;
}

export function alternates(
  origin: string,
  paths: Readonly<Record<string, string>>,
  sourceLocale: string,
): Array<{ hreflang: string; href: string }> {
  const base = new URL(origin);
  const result = Object.entries(paths).map(([hreflang, path]) => ({
    hreflang,
    href: new URL(path, base).href,
  }));
  const source = result.find((item) => item.hreflang === sourceLocale);
  if (source) result.push({ hreflang: 'x-default', href: source.href });
  return result;
}
