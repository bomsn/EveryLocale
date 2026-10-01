# EveryLocale

Self-hosted AI localization for applications and content.

Translate message catalogs and documents with cloud or local models. EveryLocale validates translations, runs independent AI review, and exports approved revisions. Choose automatic approval or a human review gate for each project.

## Features

- JSON, YAML, PO, Markdown, MDX, and HTML/Gutenberg support.
- ICU messages, plural forms, placeholders, glossary terms, and markup validation.
- Incremental translation, translation memory, spending limits, and durable SQLite jobs.
- A review workspace with comparison, editing, document previews, and batch approval.
- CLI, HTTP API, React components, Remix and Next.js adapters, and a WordPress connector.
- Locale routing, published-page metadata, reciprocal `hreflang`, and sitemaps.

## Quick start

Requires Node.js 22.16 or newer and pnpm 9.15.9. SQLite requires a native build toolchain when a prebuilt binary is unavailable.

```sh
git clone https://github.com/bomsn/EveryLocale.git
cd EveryLocale
pnpm install --frozen-lockfile
pnpm build
pnpm setup
pnpm start
```

Open [localhost:4310](http://localhost:4310) and sign in with `EVERYLOCALE_ADMIN_TOKEN` from `.env`.

Configure generation and review models in `.env`, then create a project, import content, and translate it. Model credentials stay on the server. In automatic mode, translations that pass validation and AI review become approved; flagged translations appear in Review. Human mode requires approval in the workspace.

## Docker

Create `.env` with `pnpm setup`, then run:

```sh
docker compose up --build -d
```

The service listens on localhost and stores its database in the `everylocale-data` volume. See [configuration](docs/CONFIGURATION.md) for model endpoints, authentication, remote access, and backups.

## Languages

The default registry includes English, Arabic, Traditional Chinese for Taiwan, German, Spanish, and French. Add other locales through the locale registry.

Public URLs select the page language. Private interfaces use the account preference, explicit cookie preference, then English. React components provide native language labels, SVG flags, and a dismissible browser-language suggestion.

## Documentation

- [Configure the service](docs/CONFIGURATION.md)
- [Connect an application](docs/CONNECT.md)
- [Runtime and SEO integration](docs/INTEGRATION.md)
- [HTTP API](docs/API.md)
- [WordPress connector](adapters/wordpress/README.md)
- [Contributing](CONTRIBUTING.md)

## License

[MIT](LICENSE). Translation API and hosting costs depend on your setup. Bundled flags and fonts include their upstream licenses.
