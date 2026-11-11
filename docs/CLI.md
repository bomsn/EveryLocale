# CLI reference

The `everylocale` command reads `everylocale.config.json` from the current folder, or from `--config path`. Install `@everylocale/cli` in your app (see [Connect your app](CONNECT.md#install-the-packages)) and run it with `pnpm exec everylocale`, or run `pnpm cli` from an EveryLocale checkout.

Online commands (`sync`, `pull`, `import`) read the service address from `EVERYLOCALE_URL` and a project token from `EVERYLOCALE_TOKEN`. `--url` overrides the address. A remote service must use HTTPS. Offline commands (`codegen`, `check`, `rollback`) never touch the network.

Every command exits with `0` on success and `1` on any failure, so CI stops before a broken release ships.

| Command | What it does | Network | Token scopes |
| --- | --- | --- | --- |
| `sync` | Uploads every source file the config matches and queues translation. | Yes | `read`, `import`, `translate` |
| `pull` | Downloads approved translations, writes a verified release and renders translated files. | Yes | `export` |
| `import` | Sends existing translated files to the service as candidates. | Yes | `import` |
| `codegen` | Writes the declaration file that types message ids and values. | No | none |
| `check` | Verifies the release against the source files and, optionally, the code. | No | none |
| `rollback` | Points the release at an earlier verified revision. | No | none |

## The config file

```json
{
  "version": 1,
  "project": "shop",
  "sourceLocale": "en",
  "locales": [{ "id": "de" }, { "id": "fr-CA" }, { "id": "ar", "status": "draft" }],
  "files": [
    { "pattern": "locales/{locale}/{namespace}.json", "format": "json" },
    { "pattern": "content/{locale}/{namespace}.md", "format": "markdown", "namespace": "help", "tags": ["help"] }
  ]
}
```

- `project` is the project id on the service.
- `locales` lists the target locales in display order. A `live` locale (the default) must be fully approved before `pull` succeeds. A `draft` locale may be incomplete: its message files use the source text where a translation is not approved yet, and its documents are written only once complete. Optional fields: `label` (defaults to the native language name), `prefix` (URL segment; defaults to the lower-cased id) and `direction` (defaults to the script direction).
- `files` maps source files to formats. `{locale}` appears exactly once. `{namespace}` matches one or more path segments and becomes the namespace; a pattern without it needs `namespace`. A `namespace` on a pattern with `{namespace}` prefixes the matched one. Formats: `json`, `yaml`, `po`, `markdown`, `mdx` and `html`, plus any format a plugin in `formats` registers.
- `frontMatter` on Markdown and MDX patterns lists the front matter keys to translate; the default is `title` and `description`.
- `tags` label every message from those files for [approval policies](WORKFLOW.md#approval-policies).
- `codegen.output` is the declaration file `codegen` writes (default `everylocale.generated.d.ts`).
- `release.directory` is where `pull` writes releases (default `.everylocale`).

`@everylocale/core` ships the JSON Schema as `schema/config-1.json`. Point the file's `$schema` at it for editor completion and validation.

## sync

```sh
everylocale sync [--wait] [--timeout 600]
```

Uploads every source file and queues translation for each target locale. Unchanged messages are reused, so running it again is safe and spends nothing new. When a source file is deleted locally, `sync` withdraws its messages, and the next release no longer contains them. Documents added by other connectors are never touched.

`--wait` polls until the work is done. It stops with exit code `1` and lists every message that needs attention in a live locale: failed, awaiting a person, in review or stale. Open work in draft locales is listed but does not fail the command. `--timeout` is in seconds, from 1 to 86400.

## pull

```sh
everylocale pull
```

Downloads one consistent bundle of approved translations and fails if any live locale is incomplete. It writes an immutable release under `.everylocale/releases/REVISION/` with a manifest of SHA-256 checksums, then renders each translated file next to its source, for example `locales/de/app.json`. The new release becomes active only after every file is written, by one atomic update of `.everylocale/current.json`.

The release holds, per locale and namespace, the approved messages with the source revision each approval binds to, and the messages precompiled for the runtime. Server code loads it with `loadRelease` from `@everylocale/runtime/server`, which checks every checksum before serving.

## import

```sh
everylocale import --locale fr-CA
```

Sends the translated files you already have, such as `locales/fr-CA/app.json`, as candidates. Message files pair with their source by key. Documents pair segment by segment and need the same structure as the source; one that differs is listed and skipped, never guessed at. Each imported translation follows its message's policy exactly as an edit in the workspace would. Rejected entries are listed with the reason, and the command then exits with `1`.

## codegen

```sh
everylocale codegen [--check]
```

Writes declarations that type every message id and its ICU arguments: plural and number arguments are numbers, select arguments list their options, and rich-text tags are render functions. With the file in your TypeScript project, a misspelled id or a missing value is a compile error. `--check` fails when the file is out of date, for CI. The file is generated: exclude it from formatters.

## check

```sh
everylocale check [--code src] [--json]
```

Verifies the active release against the source files without network access. Each problem names its locale, message id or file, and a code:

| Code | Meaning |
| --- | --- |
| `release_missing` | No release exists yet; run `pull`. |
| `release_mismatch` | A release file differs from its manifest checksum, or the release is for another project or source locale. |
| `locale_missing` | A configured locale is not in the release. |
| `locale_draft` | The config says live, the release was pulled as draft. |
| `translation_missing` | A live locale has no approved translation for a message. |
| `translation_stale` | The approval binds to an older source text. |
| `translation_invalid` | A translation's ICU arguments, plural or select branches, tags or protected terms differ from what the source and locale need. |
| `plural_rules_changed` | The runtime's CLDR plural categories differ from those recorded in the release. |
| `file_outdated` | A rendered translated file differs from the release; run `pull`. |
| `id_unknown` | With `--code`: the code uses an id that no source file defines. |
| `id_dynamic` | With `--code`: an id is built at runtime, so it cannot be checked. |
| `id_unused` | With `--code`: a source message is never used in the code. |

`--code` scans JavaScript and TypeScript files for ids passed to `format`, `formatParts` and `t`, and to the `id` prop of `Message` and `FormattedMessage`. Draft locales may be incomplete; their gaps are reported, not failed. `--json` prints the report as JSON.

## rollback

```sh
everylocale rollback --revision PREVIOUS_REVISION
```

Verifies an earlier release in `.everylocale/releases/` and makes it active. If your application copies or embeds the files at build time, deploy the previous build as well.
