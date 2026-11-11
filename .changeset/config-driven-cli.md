---
'@everylocale/runtime': minor
'@everylocale/cli': minor
'@everylocale/core': minor
'@everylocale/store': minor
'@everylocale/server': minor
---

The CLI works from `everylocale.config.json`:

- `sync` uploads every matched source file, withdraws files deleted locally, queues translation for every target locale, and with `--wait` blocks only on live locales.
- `pull` writes a verified, immutable release with one catalog per locale and namespace, precompiled messages for message namespaces and pinned CLDR plural rules, then renders each translated file in its original format. Draft locales use source text for unapproved messages and skip unapproved documents, and both are reported.
- `check` verifies the committed release with no network access: live-locale completeness, stale approvals, ICU and plural structure, altered release files, rendered files, and with `--code`, unknown, assembled and unused message ids.
- `codegen` writes typed message ids and argument types for `@everylocale/runtime`; `--check` fails when the file is stale.
- `import` sends existing translated files as candidates, and `rollback` activates an earlier verified release.

The `extract`, `extract-code`, `export` and `render` commands and the unit-file `sync` are replaced by these.

New package `@everylocale/runtime`: `createFormatter` formats precompiled messages with typed ids and values and reports missing ones, and `@everylocale/runtime/server` loads a release and verifies every file before use.

Formats declare whether they hold `messages` or `content`. Config file patterns can add `tags` and `frontMatter`, and `formats` loads document format plugins. Documents store their extraction options and origin, and can be removed with `DELETE /projects/{project}/documents/{namespace}`. `GET /projects/{project}/bundle?complete=` names the locales that must be complete.
