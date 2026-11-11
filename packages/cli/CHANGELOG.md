# @everylocale/cli

## 0.3.0

### Minor Changes

- d56e2e8: The CLI works from `everylocale.config.json`:
  - `sync` uploads every matched source file, withdraws files deleted locally, queues translation for every target locale, and with `--wait` blocks only on live locales.
  - `pull` writes a verified, immutable release with one catalog per locale and namespace, precompiled messages for message namespaces and pinned CLDR plural rules, then renders each translated file in its original format. Draft locales use source text for unapproved messages and skip unapproved documents, and both are reported.
  - `check` verifies the committed release with no network access: live-locale completeness, stale approvals, ICU and plural structure, altered release files, rendered files, and with `--code`, unknown, assembled and unused message ids.
  - `codegen` writes typed message ids and argument types for `@everylocale/runtime`; `--check` fails when the file is stale.
  - `import` sends existing translated files as candidates, and `rollback` activates an earlier verified release.

  The `extract`, `extract-code`, `export` and `render` commands and the unit-file `sync` are replaced by these.

  New package `@everylocale/runtime`: `createFormatter` formats precompiled messages with typed ids and values and reports missing ones, and `@everylocale/runtime/server` loads a release and verifies every file before use.

  Formats declare whether they hold `messages` or `content`. Config file patterns can add `tags` and `frontMatter`, and `formats` loads document format plugins. Documents store their extraction options and origin, and can be removed with `DELETE /projects/{project}/documents/{namespace}`. `GET /projects/{project}/bundle?complete=` names the locales that must be complete.

- 76c7193: Every failed job records a failure code from `FAILURES`, each with a description and the action to take, and the API returns it with the job. `ProviderError` takes the failure code and options instead of positional flags.

  A provider configuration failure, such as a rejected key or unknown model, pauses translation once and returns the job to the queue instead of failing every queued job. `GET /api/v1/operations` reports the pause, the workspace shows it, and `POST /api/v1/providers/resume` resumes.

  Failure alerts are aggregated: at most one `alert.translation_failed` or `alert.budget_exhausted` event per project and failure code per hour, with the count, example job ids and the recommended action.

  `GET /projects/{project}/requests/{key}` reports the progress of one submission, and `sync --wait` uses it, printing each message that needs attention with its status, failure and findings.

  Scheduled backups: set `EVERYLOCALE_BACKUP_DIR`, and optionally `EVERYLOCALE_BACKUP_INTERVAL_HOURS` and `EVERYLOCALE_BACKUP_KEEP`. Each backup is integrity-checked before older ones are pruned, and a failed backup raises `alert.backup_failed`.

  `maintenance check` and `restore`, and `pnpm doctor`, no longer modify the database they inspect.

- 73c9a63: Document formats now live behind one registry. `registerFormat()` adds a format from another package, and `formatIds()` lists the available ones. HTML always extracts whole sentences with protected inline markup.

  Markdown and MDX front matter is parsed as YAML. Only the keys listed in the `frontMatter` option are translated (`title` and `description` by default), and every other key is copied unchanged.

  Markdown, MDX and HTML segment ids are derived from content, so inserting a paragraph adds one segment and leaves the others' approvals intact. The first import after upgrading re-keys existing documents once.

  Traditional Chinese script checks apply to every locale whose likely script is Traditional Han, including `zh-TW`, `zh-HK` and `zh-Hant`. Model instructions describe the target language from its locale id instead of naming specific languages.

  `extract-code` no longer stores file paths in message context, so source revisions match across checkouts. A declaration whose id, default message or description is not a string literal fails with its file and line.

  `LanguageSuggestion` takes `dismissed`, `onAccept`, `onDismiss` and required `labels` from the host and no longer stores anything in the browser.

  The Remix 2 helper `remixMeta` is removed. Use `PublishedRegistry.metadata()` or the framework adapter for your router.

### Patch Changes

- a5ee98b: Plural categories are recorded and compared in canonical CLDR order (`pluralCategories(locale, type)` in core). Node.js 22 and 24 report them in different orders, so a release pulled on one could fail `everylocale check` on the other with `plural_rules_changed`. Releases recorded in another order still pass, since the check compares the categories as sets.
- Updated dependencies [d56e2e8]
- Updated dependencies [76c7193]
- Updated dependencies [082ca53]
- Updated dependencies [e56753f]
- Updated dependencies [b39b570]
- Updated dependencies [fac451d]
- Updated dependencies [64a1c51]
- Updated dependencies [73c9a63]
  - @everylocale/runtime@0.3.0
  - @everylocale/core@0.3.0
