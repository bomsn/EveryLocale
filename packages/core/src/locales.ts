export type LocaleDefinition = {
  id: string;
  label: string;
  direction: 'ltr' | 'rtl';
  prefix: string;
  flag: string | null;
};
export const DEFAULT_LOCALES: readonly LocaleDefinition[] = [
  { id: 'en', label: 'English', direction: 'ltr', prefix: '', flag: null },
  { id: 'ar', label: 'العربية', direction: 'rtl', prefix: 'ar', flag: 'sa' },
  { id: 'zh-Hant-TW', label: '繁體中文 (台灣)', direction: 'ltr', prefix: 'zh-tw', flag: 'tw' },
  { id: 'de', label: 'Deutsch', direction: 'ltr', prefix: 'de', flag: 'de' },
  { id: 'es', label: 'Español', direction: 'ltr', prefix: 'es', flag: 'es' },
  { id: 'fr', label: 'Français', direction: 'ltr', prefix: 'fr', flag: 'fr' },
];
export const ARABIC_COUNTRY_CODES: readonly string[] = [
  'DZ',
  'BH',
  'KM',
  'DJ',
  'EG',
  'IQ',
  'JO',
  'KW',
  'LB',
  'LY',
  'MR',
  'MA',
  'OM',
  'PS',
  'QA',
  'SA',
  'SO',
  'SD',
  'SY',
  'TN',
  'AE',
  'YE',
];
const ARABIC_COUNTRIES = new Set(ARABIC_COUNTRY_CODES);

export function canonicalLocale(input: string): string | null {
  try {
    return Intl.getCanonicalLocales(input.replaceAll('_', '-'))[0] ?? null;
  } catch {
    return null;
  }
}
/** Script matching must not turn a Simplified Chinese preference into Taiwan Chinese. */
export function matchLocale(input: string, locales = DEFAULT_LOCALES): string | null {
  const canonical = canonicalLocale(input);
  if (!canonical) return null;
  const exact = locales.find((x) => x.id.toLowerCase() === canonical.toLowerCase());
  if (exact) return exact.id;
  const locale = new Intl.Locale(canonical).maximize();
  return (
    locales.find((x) => {
      const available = new Intl.Locale(x.id).maximize();
      return available.language === locale.language && available.script === locale.script;
    })?.id ?? null
  );
}
export function languageSuggestion(
  preferences: readonly string[],
  current: string,
  locales = DEFAULT_LOCALES,
): string | null {
  for (const preference of preferences) {
    const matched = matchLocale(preference, locales);
    if (matched) return matched === current ? null : matched;
  }
  return null;
}
export function arabicFlag(country: string | null): string {
  const normalized = country?.toUpperCase() ?? '';
  return ARABIC_COUNTRIES.has(normalized) ? normalized.toLowerCase() : 'sa';
}
export function localeFromPath(
  pathname: string,
  locales = DEFAULT_LOCALES,
): { locale: string; pathname: string; explicit: boolean } {
  const first = pathname.split('/')[1] ?? '';
  const found = locales.find((x) => x.prefix && x.prefix.toLowerCase() === first.toLowerCase());
  return found
    ? { locale: found.id, pathname: pathname.slice(first.length + 1) || '/', explicit: true }
    : { locale: locales.find((x) => !x.prefix)?.id ?? 'en', pathname, explicit: false };
}
export function localizePath(pathname: string, locale: string, locales = DEFAULT_LOCALES): string {
  if (!pathname.startsWith('/') || pathname.startsWith('//'))
    throw new Error('Expected a same-origin pathname');
  const definition = locales.find((x) => x.id === locale);
  if (!definition) throw new Error('Unsupported locale');
  const unprefixed = localeFromPath(pathname, locales).pathname;
  return definition.prefix
    ? `/${definition.prefix}${unprefixed === '/' ? '' : unprefixed}`
    : unprefixed;
}
export function readLocaleCookie(header: string | null): string | null {
  const raw = header
    ?.split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith('el_locale='))
    ?.slice(10);
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
  return `el_locale=${encodeURIComponent(canonical)}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? '; Secure' : ''}${domain ? `; Domain=${domain}` : ''}`;
}
export function resolveLocale(options: {
  pathname: string;
  privateSurface: boolean;
  profile?: string | null;
  cookie?: string | null;
  locales?: readonly LocaleDefinition[];
}): string {
  const locales = options.locales ?? DEFAULT_LOCALES;
  if (!options.privateSurface) return localeFromPath(options.pathname, locales).locale;
  return (
    [options.profile, options.cookie]
      .map((x) => (x ? matchLocale(x, locales) : null))
      .find(Boolean) ??
    locales.find((x) => !x.prefix)?.id ??
    'en'
  );
}
export function alternates(
  origin: string,
  paths: Record<string, string>,
  sourceLocale = 'en',
): Array<{ hreflang: string; href: string }> {
  const base = new URL(origin);
  const result = Object.entries(paths).map(([hreflang, path]) => ({
    hreflang,
    href: new URL(path, base).href,
  }));
  const source = result.find((x) => x.hreflang === sourceLocale);
  if (source) result.push({ hreflang: 'x-default', href: source.href });
  return result;
}
