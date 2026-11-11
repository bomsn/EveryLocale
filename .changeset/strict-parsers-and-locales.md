---
'@everylocale/core': minor
'@everylocale/cli': minor
'@everylocale/react': minor
'@everylocale/adapters': minor
'@everylocale/store': minor
'@everylocale/server': minor
---

Document formats now live behind one registry. `registerFormat()` adds a format from another package, and `formatIds()` lists the available ones. HTML always extracts whole sentences with protected inline markup.

Markdown and MDX front matter is parsed as YAML. Only the keys listed in the `frontMatter` option are translated (`title` and `description` by default), and every other key is copied unchanged.

Markdown, MDX and HTML segment ids are derived from content, so inserting a paragraph adds one segment and leaves the others' approvals intact. The first import after upgrading re-keys existing documents once.

Traditional Chinese script checks apply to every locale whose likely script is Traditional Han, including `zh-TW`, `zh-HK` and `zh-Hant`. Model instructions describe the target language from its locale id instead of naming specific languages.

`extract-code` no longer stores file paths in message context, so source revisions match across checkouts. A declaration whose id, default message or description is not a string literal fails with its file and line.

`LanguageSuggestion` takes `dismissed`, `onAccept`, `onDismiss` and required `labels` from the host and no longer stores anything in the browser.

The Remix 2 helper `remixMeta` is removed. Use `PublishedRegistry.metadata()` or the framework adapter for your router.
