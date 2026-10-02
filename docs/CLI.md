# CLI reference

Run `pnpm cli` from the EveryLocale checkout. If you want a complete first example, start with [Connect your app](CONNECT.md#files-and-builds).

Commands that read local files do not need a running service. Commands that import, translate, or export use `EVERYLOCALE_URL` and `EVERYLOCALE_TOKEN` from your shell. Use a scoped project token and HTTPS for a remote service. Paths are relative to your terminal's current folder unless absolute.

## Find the right command

| Command | What it does | Model requests? |
| --- | --- | --- |
| `extract` | Reads a supported file into source segments. | No |
| `extract-code` | Reads explicit ICU message declarations in TypeScript/React files. | No |
| `sync` | Imports source segments and queues translation. | Yes, unless `--import-only` |
| `export` | Downloads one approved language catalog. | No |
| `pull` | Downloads all configured languages as one complete approved release. | No |
| `render` | Uses a catalog to produce a translated document in its original format. | No |
| `check` | Checks source/approval agreement and protected structure. | No |
| `rollback` | Activates a previously downloaded release. | No |

## Extract a document

```sh
pnpm cli extract --input examples/messages.json --format json --namespace messages --output source.json
```

Formats: `json`, `yaml`, `po`, `markdown`, `mdx`, `html`. The output is an array of source segments, not a translation. `--source-locale` defaults to `en`. Keep `--namespace` stable across edits.

## Extract declared app messages

```sh
pnpm cli extract-code --input ../my-app/src --output source.json
```

This scans TypeScript files for explicit FormatJS declarations, `Message` components, and supported formatting calls with stable identifiers. It skips build/dependency folders. Arbitrary strings are not extracted. `--source-locale` defaults to `en`.

## Synchronize and wait

```sh
pnpm cli sync --project first-app --input source.json --locales de --wait --timeout 600
```

The project must exist and include the requested languages. Comma-separate several targets. Importing unchanged sources reuses existing work; the same request can be rerun safely.

`--wait` waits for approval. Failed, stale, or review-blocked work exits with an error; open the workspace, resolve it, and rerun. The timeout is seconds, defaults to 600, and accepts 1–86400. Omitting `--wait` queues work and returns. `--import-only` stores sources without starting translations.

## Export or pull

```sh
pnpm cli export --project first-app --locale de --output locales/de.catalog.json
pnpm cli pull --project first-app --output locales
```

These require approval for the current sources. Export downloads one catalog; pull verifies all configured languages and changes `current.json` only after a complete release is installed. Capture its `revision` field once during your app build and load files from `locales/releases/REVISION/`.

Use `--allow-stale` only if you intentionally want a prior approved version while replacement work is pending. It never exports an unapproved candidate.

## Render the original format

```sh
pnpm cli render --input examples/messages.json --format json --namespace messages --catalog locales/de.catalog.json --output locales/de.json
```

Use the same input, format, namespace, and source language as extraction. Rendering rejects missing approvals and source mismatches. A JSON document keeps its keys and variable placeholders; Markdown/HTML keeps its protected structure.

## Validate or roll back

```sh
pnpm cli check --input source.json --catalog locales/de.catalog.json
pnpm cli rollback --output locales --revision PREVIOUS_REVISION
```

Check fails on missing translations, stale approvals, or critical structural findings. Rollback verifies the retained release files before changing the pointer. Your application deployment needs its own rollback if it already copied or embedded those files.

Use `pnpm cli help` for the command list. `--url` overrides the service address for an online command. Failed commands return a nonzero exit code so CI can stop before deployment.
