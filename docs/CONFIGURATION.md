# Configuration

The service reads environment variables from `.env`. `pnpm run setup` creates the file with random workspace and session credentials. Configuration options are listed in [.env.example](../.env.example).

## Models

Configure generation and review independently. Each provider uses an OpenAI-compatible chat-completions endpoint.

| Variable suffix | Purpose                                |
| --------------- | -------------------------------------- |
| `_URL`          | Endpoint base URL                      |
| `_MODEL`        | Model identifier                       |
| `_KEY`          | API key, when required by the endpoint |
| `_INPUT_PRICE`  | USD per million input tokens           |
| `_OUTPUT_PRICE` | USD per million output tokens          |

Use the prefixes `EVERYLOCALE_GENERATOR` and `EVERYLOCALE_REVIEWER`. Both models must support JSON object responses. Metered endpoints must report token usage; set both prices to zero for an unmetered local model.

`EVERYLOCALE_CONCURRENCY` limits active jobs. `EVERYLOCALE_PROVIDER_INTERVAL_MS` sets the minimum interval between provider requests. Each project has a cumulative USD budget covering generation and review.

## Access

`EVERYLOCALE_ADMIN_TOKEN` grants workspace administration. `EVERYLOCALE_SESSION_SECRET` signs browser sessions. Use independent random values of at least 32 characters.

Create scoped project tokens in **Connect → Manage access**. Tokens have an expiry and can be revoked. Keep provider credentials and application access tokens in server-side environment variables.

## Deployment

The default host is `127.0.0.1`, with port `4310`. For remote access, configure an HTTPS reverse proxy and set `EVERYLOCALE_PUBLIC_ORIGIN` to the exact public origin. Browser session mutations require that origin and a CSRF token.

`EVERYLOCALE_DATABASE` selects the SQLite database path. Run one service instance per database. Docker stores the database in its `everylocale-data` volume and runs the service as a non-root user.

## Backups

Use SQLite's backup API for a live database. Alternatively, stop the service and copy the database with its WAL files. Preserve the Docker volume during upgrades and test restoration before relying on a backup.
