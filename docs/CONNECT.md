# Connect your app

First [translate a sample file](GETTING-STARTED.md). This guide connects that working service to your product. Every stack starts the same way: a config file, then `sync` and `pull` from your build.

Your app uses approved translations that live in its own repository or build. EveryLocale runs separately and prepares them. Model keys stay on the service; your build needs only a project token.

## Install the packages

Every package is on npm under `@everylocale`, and all of them share one version. Install the CLI for your build, plus the runtime pieces your app uses:

| Package | Use |
| --- | --- |
| `@everylocale/cli` | The `everylocale` command for builds and CI |
| `@everylocale/runtime` | Formats approved messages in any JavaScript runtime; loads verified releases on the server |
| `@everylocale/react` | `EveryLocaleProvider`, `Message`, language links and select |
| `@everylocale/react-router` | React Router 7 and 8 framework mode |
| `@everylocale/adapters` | Request locale resolution, Next.js metadata, published-page registry, HTTP client |
| `@everylocale/core` | Shared locale and config logic; installed with the others |

```sh
npm install --save-dev @everylocale/cli
npm install @everylocale/runtime
```

A React Router app adds `@everylocale/react @everylocale/react-router`; a Next.js app adds `@everylocale/react @everylocale/adapters`. With pnpm or Yarn, use `pnpm add` or `yarn add` with the same names.

## Describe your files

Create `everylocale.config.json` at your app's root. This one matches `examples/quickstart` in the EveryLocale checkout:

```json
{
  "version": 1,
  "project": "first-app",
  "sourceLocale": "en",
  "locales": [{ "id": "de" }, { "id": "fr", "status": "draft" }],
  "files": [
    { "pattern": "locales/{locale}/{namespace}.json", "format": "json" },
    { "pattern": "content/{locale}/{namespace}.md", "format": "markdown", "namespace": "content", "tags": ["help"] }
  ]
}
```

`locales/en/app.json` becomes the `app` namespace, and its key `save` becomes the message id `app:save`. German is live, so a release needs every German message approved. French is a draft: it may ship incomplete, with English text where a translation is not approved yet. The [CLI reference](CLI.md#the-config-file) lists every field.

## Give the build access

In the workspace, open **Connect → Manage access** and create a token with `read`, `import`, `translate` and `export`. Copy it now; it is shown once. You can limit a token to some locales or namespaces, for example for an agency that translates only French.

```sh
export EVERYLOCALE_URL="http://localhost:4310"
export EVERYLOCALE_TOKEN="YOUR_PROJECT_TOKEN"
```

In PowerShell, use `$env:EVERYLOCALE_URL = "..."`. A service on another computer must use HTTPS. Never give the workspace owner token to an app or CI.

## Sync, pull, check

```sh
pnpm exec everylocale sync --wait
pnpm exec everylocale pull
pnpm exec everylocale check
```

`sync` uploads your source files and queues translation. `--wait` returns once every live locale is approved, or lists what needs attention and fails. `pull` writes a verified release to `.everylocale/` and renders the translated files next to their sources, such as `locales/de/app.json`. `check` re-verifies everything offline, which suits a pull request check that has no access to the service.

Already have translations? `everylocale import --locale de` sends them as candidates, so you keep their wording and only new or changed messages need translating.

Choose where releases live:

- **Commit them.** Run `pull` when translations are approved and commit `.everylocale/` with the rendered files. Builds need no access to the service, and `check` guards every change.
- **Pull during the build.** The build runs `sync --wait` and `pull` before compiling. See [CI/CD](CI-CD.md).

## Show the messages

### React Router

`@everylocale/react-router` resolves the locale in the root loader and gives each route only the namespaces it uses. Pages render and hydrate from the same data, so there is no second language decision and no flash of the wrong language. `examples/react-router` is a complete app with five languages, including Arabic. The [runtime guide](INTEGRATION.md#react-router) explains each piece.

### Next.js

Server components call `loadLocalization()` from `@everylocale/runtime/server` once per process and pass the messages a page needs to `EveryLocaleProvider`. `examples/next` is a working App Router app. See [the runtime guide](INTEGRATION.md#nextjs).

### Other JavaScript

`createFormatter({ locale, messages })` from `@everylocale/runtime` formats messages anywhere: workers, emails, CLIs and other frameworks.

### Other languages and frameworks

Use the rendered files with your stack's own localization library. `pull` writes them in the same format as your sources: JSON, YAML, PO, Markdown, MDX or HTML. Or call the [HTTP API](API.md) from your server.

## WordPress

Install the [WordPress connector](../adapters/wordpress/README.md) and enter the service address, project id and project token in **Settings → EveryLocale**. Publishing or updating an article creates translation work, and scheduled sync delivers approved articles. The connector creates localized articles and URLs, handles updates and withdrawal, and adds language alternates. It needs reliable scheduled tasks.

## What your app decides

- Where the language selector goes and how a signed-in person's choice is saved.
- Which translated pages are published and linked.
- When builds or publishing events start the next translation.
- Who receives failure alerts and owns recovery.

EveryLocale provides the workflow, the runtime and the connectors. Your app keeps its routes, accounts and deployment. [Runtime integration](INTEGRATION.md) explains those connection points.
