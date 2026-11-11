# Runtime integration

This guide is for the developer who makes an app display its prepared translations. Complete [the first translation](GETTING-STARTED.md), then follow [package installation and a first React message](CONNECT.md#react-and-nextjs) before implementing the routing below.

The request decides which language file to use. For example, `/de/pricing` must show German when shared with an English-speaking account. A private dashboard follows the person's saved choice instead. Your server and browser must use the same approved file for a page, so it does not appear in one language and switch during loading.

## Choose the integration you need

- **Existing localization library:** use the CLI to render files in your app's current format. You do not need EveryLocale's React runtime.
- **React interface:** display declared messages with `EveryLocaleProvider` and `Message`; choose the approved catalog on the server.
- **Server-rendered public pages:** add locale-aware routes and metadata to the same server rendering path.
- **Content pages:** record which translated pages are published and use that record for navigation and search metadata.

The following sections explain the helpers and the host application's responsibilities. Keep account storage and deployment in the application that already owns them.

## React

Build the locale registry once with `defineLocales(sourceLocale, targets)` from `@everylocale/core/locales`, and pass the same registry to every helper and control. Each target is a BCP 47 id or an object with `status`, `label`, `prefix` and `direction`; labels default to the language's own name and direction to its script. URL prefixes default to the lower-cased id, and the source locale is unprefixed.

Mount `EveryLocaleProvider` with the catalog chosen on the server for that request. Serialize that exact catalog into the hydration data; avoid a second browser-side language decision. Use `Message` or `useEveryLocale` for explicit ICU declarations.

`LanguageLinks` renders a navigation landmark with a link to each published counterpart of the page, marked with `hreflang` and `lang`; it works without JavaScript. `LanguageSelect` is a labelled select inside a GET form with an explicit submit button, so browsing options never navigates away; your server handles the submitted locale, saves the explicit preference, and redirects. Pass `onSelect` to handle the choice in the browser instead. `LanguageSuggestion` reads browser preferences after hydration and offers a dismissible suggestion. The host passes `dismissed`, `onAccept` and `onDismiss`, and decides where a dismissal is remembered. `LocaleFlag` shows a flag only for flags you import, such as `import tw from '@everylocale/react/flags/tw'`, so a page bundles only those flags. It uses the locale's region, then a trusted visitor `country`, then the language's likely region. Flags stand for countries, not languages; prefer language names alone where a country could be misread. For right-to-left languages, set direction on the HTML document and use logical CSS properties in layouts. Use `isolateIdentifier` or `<bdi dir="auto">` around mixed-direction identifiers. Use fonts with Arabic and CJK coverage in browser screens, PDF generation, emails, and exports.

Localize control copy through the same approved catalog as the application; the controls have no built-in English text. `LanguageLinks` takes `label`, `LanguageSelect` takes `label` and `submitLabel`, and `LanguageSuggestion` requires `labels` with `region` (the accessible name), `dismiss`, and two renderers, `prompt(language)` and `accept(language)`. The renderers can use rich ICU messages; the language-name argument already carries language and direction isolation.

## Arabic and Taiwan Chinese fonts

Import `@everylocale/react/fonts.css` for optional, self-hosted Noto Sans Arabic and Noto Sans TC coverage. Set the document or translated element's `lang` to `ar` or `zh-Hant-TW`. The full Taiwan font is about 5.4 MB; it is a separate asset and loads only where used. A host can instead supply its own appropriately licensed fonts or subsets. Font licenses ship beside the assets.

For browser-generated PDF reports, load the selected fonts and await `document.fonts.ready` before exporting. Preserve `lang`, `dir`, logical layout, and `<bdi>` boundaries in the report template. For a native PDF renderer, use compatible font files and an Arabic shaping/bidirectional engine; font coverage alone does not implement shaping. Verify the actual host renderer's output, including embedded fonts and copied text.

## Server-rendered React

A server loader or route handler resolves `resolveRequest(request, {locales, profileLocale, privateSurface})` with the Fetch API `Request` your framework provides. Public pages select the catalog by URL; authenticated private surfaces use account preference, then explicit cookie, then English. Set `<html lang={locale} dir={direction}>` in the root. Build canonical and alternate links from `registry.metadata(pageId, locale)` and combine them with localized title, description and structured data from the same published registry.

An optional language segment in the route keeps existing English URLs stable. Validate recognized prefixes and published page availability before rendering. Throw a 404 response for unknown locales or missing translations. The unavailable screen can offer the original-language link. Do not put English content under `/ar` or `/zh-tw` as fallback.

## Next.js

`examples/next` is a Next.js App Router example. Its optional catch-all route keeps English unprefixed. The root layout receives route parameters and renders matching `lang/dir`; `generateMetadata` uses `nextMetadata` with the same published paths as page rendering.

The adapter functions are independent of Next.js version. A host chooses its routing structure, published registry, and metadata. Avoid middleware redirects based on geography or browser language. Use a suggestion and a consistently available selector instead.

## Generic HTTP and files

`EveryLocaleClient` is a server-side HTTP client. It imports sources, submits jobs with an idempotency key, reads progress, and exports approved catalogs. Any stack can use the documented HTTP API or consume catalog/document files from the CLI.

Public applications should load a versioned artifact set into a fresh immutable map, validate completeness, then atomically switch the serving reference. Keep the previous map for rollback. Never mutate a global locale variable or per-request preference in shared state. Catalog caches include project, locale, and approved revision. HTML page caches include locale and publication revision; country decoration and account-specific data stay outside them.

Emails resolve account language explicitly when a send is queued. Generated reports can call the core pipeline in a private background job for explanatory fields only, preserving quoted answers, evidence, measurements, and user content. A private consumer may use independently reviewed output without an editorial publication step; it must never feed that path into public artifacts. Cache by explanation source, locale, and pipeline revision. The public artifact API accepts only approved revisions; projects choose automatic approval after clean validation/review or an optional human gate.

## Publication and search

Store published page records by translation group and locale, including approved revision, title, description, structured data, localized slug, and URL. Generate internal language links, self-canonical, reciprocal hreflang, English x-default, and sitemap entries from those same records. Include only published counterparts. Redirect previous approved slugs when they change. Keep language separate from currency, timezone, measured prompt language, and billing amounts.

`PublishedRegistry(origin, pages, locales)` creates an immutable publication snapshot. Each variant needs its locale, path, approval revision, and localized title. Its `resolve`, `switch`, `metadata`, `structuredData`, and `sitemap` methods use that same snapshot. Missing routes return `null`; the host returns a real 404 and uses `original(pageId)` for the original-language link. Registry membership must be constructed from your approved release, never pending jobs. Structured-data fields beyond name, description, URL, and language remain the host's responsibility.

Render internal links with `registry.link(href, locale)`. It replaces only known same-origin published counterparts, preserves query strings and anchors, and leaves unavailable or external links unchanged. Translation protects link destinations; this explicit rendering step handles localized navigation using approved publication data.

For approved HTML or Gutenberg documents, use `rewriteHtmlLinks(content, href => registry.link(href, locale))`. This changes only anchor destinations while retaining block comments, code, and the original markup. The WordPress adapter performs the same publication-aware step when rendering article content and REST responses.

The WordPress plugin automates linked drafts, approved publishing, source changes, withdrawal delivery, localized permalinks, alternate links, and old-slug redirects. Connect `everylocale_translation_published` to your product's cache invalidation/outbox; an authenticated downstream consumer must make delivery replay-safe. WordPress requires a reliable system cron to run scheduled translation synchronization and withdrawal retries.

## Extension points

Locales come from one host registry built with `defineLocales`. Project target languages use standard BCP 47 identifiers; parsers and job contracts contain no language-specific branches except script and plural checks derived from CLDR data. Document formats implement `DocumentFormat` and are added with `registerFormat`. New OpenAI-compatible providers require endpoint/model/prices configuration. A non-compatible vendor needs a transport adapter implementing the same model-call and reservation contract.

`TranslationStore` defines the engine storage interface; `LocalizationStore` adds project, review, document, and token management for the service and worker. Storage implementations must preserve transactional approval, lease, idempotency, and budget invariants.
