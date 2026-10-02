# Connect your app

First [translate a sample file](GETTING-STARTED.md). This guide connects that working service to your product. You can start with files, use React components, or call the API from another stack.

Your app uses approved translations. EveryLocale runs separately and prepares them before a release. Keep your model keys on the service; your app or build only needs permission to work with its own project.

## Files and builds

Use this path if your app already reads a JSON/YAML/PO messages file, or if you want translated Markdown, MDX, or HTML documents.

### Give the build access

In the workspace, open **Connect → Manage access** for your project. Create a token with `read`, `import`, `translate`, and `export` permissions. Copy it immediately; it is shown once. Set an expiry you can maintain.

Open a second terminal in the EveryLocale checkout. Set the address and project token. Use the syntax for your shell:

```powershell
$env:EVERYLOCALE_URL = "http://localhost:4310"
$env:EVERYLOCALE_TOKEN = "YOUR_PROJECT_TOKEN"
```

```sh
export EVERYLOCALE_URL="http://localhost:4310"
export EVERYLOCALE_TOKEN="YOUR_PROJECT_TOKEN"
```

These are examples for your local service. Use HTTPS for a server on another computer. Do not use your workspace administrator token in your app or CI.

### Produce a translated file

The following commands use the included sample and a project named `first-app` with German enabled. Run them from the EveryLocale checkout:

```sh
pnpm cli extract --input examples/messages.json --format json --namespace messages --output source.json
pnpm cli sync --project first-app --input source.json --locales de --wait --timeout 600
pnpm cli export --project first-app --locale de --output locales/de.catalog.json
pnpm cli render --input examples/messages.json --format json --namespace messages --catalog locales/de.catalog.json --output locales/de.json
```

The result `locales/de.json` keeps the original keys and variables. Configure your app to load that file when German is selected. The catalog file is the checked input to rendering; the rendered file is the original-format document your app can use.

Change the input path, project identifier, namespace, and locales for your product. Input/output paths can be absolute, including paths to another repository. Reuse the namespace when updating the same document. For app code with explicit message declarations, use `extract-code` instead; see the [CLI reference](CLI.md).

### Deliver several languages together

Once every configured language has current approval, download a complete release:

```sh
pnpm cli pull --project first-app --output locales
```

`locales/current.json` contains the release identifier in its `revision` field. Read it once at the start of a build, then load files from `locales/releases/REVISION/`. That directory contains `en.json`, `de.json`, other configured language catalogs, and `bundle.json`. Each catalog stores translated values in its `messages` object.

A failed translation stops delivery of the new release. The current deployed app remains available. Keep the previous release directory and previous application deployment for rollback. [Automate these steps in CI/CD](CI-CD.md) after the manual path works.

## React, Remix, and Next.js

These packages let your interface display declared messages, choose language per request, and offer an accessible language selector. They do not identify arbitrary strings automatically: replace your app's user-visible strings with explicit messages.

### Install the same packaged release

Run `pnpm release:pack` in EveryLocale. It creates three matching archives under `artifacts/`. Copy them into `vendor/` in your app repository. Replace `VERSION` with the version in EveryLocale's root `package.json`.

Before installation, add this portable override to your app's `package.json`:

```json
{
  "pnpm": {
    "overrides": {
      "@everylocale/core": "file:vendor/everylocale-core-VERSION.tgz"
    }
  }
}
```

Then run from your app folder:

```sh
pnpm add ./vendor/everylocale-core-VERSION.tgz ./vendor/everylocale-adapters-VERSION.tgz ./vendor/everylocale-react-VERSION.tgz
```

The override ensures all three packages use the same core. Keep the archives with your app so installation does not depend on an unrelated local checkout.

### Render one message

Use an approved catalog from your build. A catalog for the sample imported with the namespace `messages` contains `messages:welcome`:

```tsx
import { EveryLocaleProvider, Message } from '@everylocale/react';
import catalog from './locales/de.catalog.json';

export function Greeting() {
  return (
    <EveryLocaleProvider catalog={catalog}>
      <Message id="messages:welcome" values={{ name: 'Sam' }} />
    </EveryLocaleProvider>
  );
}
```

Set the document language to `de` for this example. A multilingual app chooses the appropriate approved catalog on the server for each request and passes that same catalog to the browser.

Use the [runtime guide](INTEGRATION.md) for Remix loaders, Next.js server layouts, the language selector, Arabic fonts, and public-page search metadata. `examples/next` contains a working App Router app.

## WordPress

Install the [WordPress connector](../adapters/wordpress/README.md) and enter the service address, project identifier, and project token in **Settings → EveryLocale**. Publishing or updating an original article creates translation work. Approved articles are delivered by WordPress's scheduled sync.

The connector creates localized articles and URLs, handles source updates and withdrawal, and supplies language alternates. A production WordPress site needs reliable scheduled tasks. If another app caches its articles, connect the publication hook to that app's cache refresh.

## Another language or framework

Use translated files with your stack's own localization library, or call the [HTTP API](API.md) from your server. The API supports import, translation jobs, progress, review, and approved exports. Model credentials stay on EveryLocale; a public browser must never receive a project token.

## What your app needs to decide

- How it loads the approved files and displays messages.
- Where its language selector goes and how signed-in preferences are saved.
- Which localized public pages are actually published.
- How builds or publishing events start the next translation.
- Who receives exceptions and owns recovery.

EveryLocale provides the translation workflow, runtime helpers, and connectors. The host app supplies its own routes, account records, emails, report templates, and deployment process. [Language and SEO integration](INTEGRATION.md) explains those connection points.
