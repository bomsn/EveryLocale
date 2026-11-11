# @everylocale/core

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

- e56753f: Locales come from a registry the app defines with `defineLocales(source, targets)`; there is no built-in language list. Labels default to each language's own CLDR name, direction to its script, and URL prefixes to the lower-cased id. Every helper that resolves or localizes a path takes the registry, and `nextMetadata` and `alternates` take the source locale.

  `everylocale.config.json` describes an app: its project, source and target locales with `live` or `draft` status, file patterns with `{locale}` and `{namespace}`, and the release directory. `parseAppConfig` validates it and reports every problem with its location, and `@everylocale/core/schema/config-1.json` is its JSON Schema for editors.

  Projects have a `reviewerLanguage`, the language AI review findings are written in.

  `LanguageSelector` is replaced by `LanguageLinks`, crawlable links to each published counterpart, and `LanguageSelect`, a form that changes language only on submit. Flags are opt-in per country from `@everylocale/react/flags/<code>`, and `LocaleFlag` takes the imported flags.

- b39b570: Projects replace `approvalMode` with ordered `policies`. Each rule matches by namespace glob, key glob or unit tag, and sets `translate` (`ai`, or `human` so the text never reaches a model) and `approve` (`automatic` or `human`). The last rule must match every message. Existing projects keep their behavior through the database migration.

  `locked` unit id globs publish the source text in every locale without model work. Unit `tags` select policies and never change a message's source revision.

  `POST /projects/{project}/translations` imports existing translations as candidates. Each follows its message's policy, and every rejected entry is reported with its reason.

  Project tokens can be limited to `locales` and `namespaces`. A limited token sees and changes only those messages, and cannot download the full bundle.

  Workspace sessions are stored on the server: signing out revokes the session, and `DELETE /api/v1/sessions` signs out every browser.

  The database schema is upgraded by numbered migrations. An existing database is copied before its first pending migration, and a database from a newer release is refused without changes.

  The service logs JSON lines with request ids, without tokens, cookies or content, and returns the request id with every response and unexpected error. `EVERYLOCALE_LOG_LEVEL` sets the level and `EVERYLOCALE_TRUST_PROXY` names the proxies whose forwarded client address is trusted.

- fac451d: `@everylocale/react` formats with `@everylocale/runtime` instead of `react-intl`. `EveryLocaleProvider` takes the request's `locale` and precompiled `messages` (there is no default locale), `Message` and `useMessages().format()` are typed by the generated declarations, and rich-text tags are rendered by functions in `values`. Missing messages are reported once, or throw with `missing: 'throw'`.

  `compileMessage` in core precompiles a message. `@everylocale/runtime/bundler` exports `parserAlias()` so client bundles drop the ICU parser. The React peer range is `>=18.3 <20`.

  Browser entries are measured on every CI run: the runtime adds about 2.8 KB gzipped, the React message bindings about 3.0 KB, and the language controls about 1.3 KB.

- 73c9a63: Document formats now live behind one registry. `registerFormat()` adds a format from another package, and `formatIds()` lists the available ones. HTML always extracts whole sentences with protected inline markup.

  Markdown and MDX front matter is parsed as YAML. Only the keys listed in the `frontMatter` option are translated (`title` and `description` by default), and every other key is copied unchanged.

  Markdown, MDX and HTML segment ids are derived from content, so inserting a paragraph adds one segment and leaves the others' approvals intact. The first import after upgrading re-keys existing documents once.

  Traditional Chinese script checks apply to every locale whose likely script is Traditional Han, including `zh-TW`, `zh-HK` and `zh-Hant`. Model instructions describe the target language from its locale id instead of naming specific languages.

  `extract-code` no longer stores file paths in message context, so source revisions match across checkouts. A declaration whose id, default message or description is not a string literal fails with its file and line.

  `LanguageSuggestion` takes `dismissed`, `onAccept`, `onDismiss` and required `labels` from the host and no longer stores anything in the browser.

  The Remix 2 helper `remixMeta` is removed. Use `PublishedRegistry.metadata()` or the framework adapter for your router.
