import {
  alternates,
  DEFAULT_LOCALES,
  localeFromPath,
  type LocaleDefinition,
} from '@everylocale/core/locales';

export type PublishedVariant = {
  locale: string;
  path: string;
  approvalRevision: string;
  title: string;
  description?: string;
  updatedAt?: string;
};
export type PublishedPage = { id: string; variants: readonly PublishedVariant[] };
const xml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

/** One immutable publication snapshot owns routing, metadata, links, and sitemap membership.
 * Hosts construct it from approved artifacts and swap snapshots atomically on release.
 */
export class PublishedRegistry {
  private readonly pages = new Map<string, PublishedPage>();
  private readonly routes = new Map<string, { pageId: string; variant: PublishedVariant }>();
  readonly origin: string;

  constructor(
    origin: string,
    pages: readonly PublishedPage[],
    private readonly locales: readonly LocaleDefinition[] = DEFAULT_LOCALES,
    readonly sourceLocale = 'en',
  ) {
    const base = new URL(origin);
    if (
      !['http:', 'https:'].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.pathname !== '/' ||
      base.search ||
      base.hash
    )
      throw new Error('Expected an HTTP origin');
    this.origin = base.origin;
    for (const input of pages) {
      if (!input.id || this.pages.has(input.id))
        throw new Error('Duplicate or empty publication identifier');
      const variants = input.variants.map((item) => {
        const url = new URL(item.path, base);
        if (
          !item.path.startsWith('/') ||
          item.path.startsWith('//') ||
          url.origin !== base.origin ||
          url.search ||
          url.hash ||
          /[\u0000-\u001f\u007f]/u.test(item.path)
        )
          throw new Error('Published paths must be same-origin paths without queries or fragments');
        return Object.freeze({ ...item, path: url.pathname });
      });
      const seen = new Set<string>();
      for (const item of variants) {
        const url = new URL(item.path, base);
        if (url.origin !== base.origin || url.search || url.hash)
          throw new Error('Published paths must be same-origin paths without queries or fragments');
        if (
          !locales.some((locale) => locale.id === item.locale) ||
          seen.has(item.locale) ||
          localeFromPath(item.path, locales).locale !== item.locale
        )
          throw new Error('Published locale and URL do not agree');
        if (!item.approvalRevision || !item.title.trim() || this.routes.has(item.path))
          throw new Error('Published variants need approval, a title, and a unique route');
        if (item.updatedAt && !Number.isFinite(Date.parse(item.updatedAt)))
          throw new Error('Invalid publication date');
        seen.add(item.locale);
        this.routes.set(item.path, Object.freeze({ pageId: input.id, variant: item }));
      }
      if (!seen.has(sourceLocale))
        throw new Error('A publication needs its original-language variant');
      this.pages.set(input.id, Object.freeze({ id: input.id, variants: Object.freeze(variants) }));
    }
  }

  resolve(pathname: string) {
    if (!pathname.startsWith('/') || pathname.startsWith('//')) return null;
    return this.routes.get(new URL(pathname, this.origin).pathname) ?? null;
  }
  paths(pageId: string): Record<string, string> {
    const page = this.pages.get(pageId);
    if (!page) throw new Error('Publication unavailable');
    return Object.fromEntries(page.variants.map((item) => [item.locale, item.path]));
  }
  original(pageId: string): string {
    return this.paths(pageId)[this.sourceLocale]!;
  }
  switch(pageId: string, locale: string): string | null {
    return this.paths(pageId)[locale] ?? null;
  }
  /** Only known, published same-origin counterparts may replace an internal link. */
  link(href: string, locale: string): string {
    if (href.startsWith('#') || href.startsWith('?')) return href;
    let url: URL;
    try {
      url = new URL(href, this.origin);
    } catch {
      return href;
    }
    if (url.origin !== this.origin) return href;
    const publication = this.resolve(url.pathname);
    const path = publication ? this.switch(publication.pageId, locale) : null;
    if (!path) return href;
    const localized = path + url.search + url.hash;
    return /^https?:/i.test(href) ? this.origin + localized : localized;
  }
  metadata(pageId: string, locale: string) {
    const variant = this.pages.get(pageId)?.variants.find((item) => item.locale === locale);
    if (!variant) throw new Error('Translation unavailable');
    return {
      title: variant.title,
      description: variant.description,
      canonical: new URL(variant.path, this.origin).href,
      alternates: alternates(this.origin, this.paths(pageId), this.sourceLocale),
    };
  }
  structuredData(pageId: string, locale: string, data: Record<string, unknown>) {
    const metadata = this.metadata(pageId, locale);
    return {
      ...data,
      url: metadata.canonical,
      inLanguage: locale,
      name: metadata.title,
      ...(metadata.description ? { description: metadata.description } : {}),
    };
  }
  sitemap(): string {
    const entries = [...this.pages.values()].flatMap((page) =>
      page.variants.map((variant) => {
        const metadata = this.metadata(page.id, variant.locale);
        return `<url><loc>${xml(metadata.canonical)}</loc>${variant.updatedAt ? `<lastmod>${xml(new Date(variant.updatedAt).toISOString())}</lastmod>` : ''}${metadata.alternates.map((link) => `<xhtml:link rel="alternate" hreflang="${xml(link.hreflang)}" href="${xml(link.href)}"/>`).join('')}</url>`;
      }),
    );
    return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${entries.join('')}</urlset>`;
  }
}
