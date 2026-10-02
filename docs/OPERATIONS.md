# Run a dependable service

First complete a local translation using [Get started](GETTING-STARTED.md). Use this guide when other people or automated builds will rely on your service.

EveryLocale stores projects, sources, translations, approvals, queued jobs, access tokens, and spending in one SQLite database. Run one service instance against that database. Its data and secrets must survive restarts and updates.

## Choose where it runs

Use a persistent server or computer with Node.js 22.16 or later, or Docker. Your model can run elsewhere. Cloudflare can host a static translated website, but this SQLite service needs persistent writable storage and background workers.

For Docker, generate and configure `.env`, then start from the checkout:

```sh
docker compose up --build -d
docker compose logs --tail 50 everylocale
```

The service listens on local port 4310. Data is kept in the `everylocale-data` Docker volume. Restarting the container retains it; deleting the volume destroys it. The service runs without root privileges.

For remote access, put an HTTPS reverse proxy in front of the service and set `EVERYLOCALE_PUBLIC_ORIGIN` to the exact address users will open, such as `https://locale.example.com`. Keep the backend port private. Restart after changing settings. Use the matching URL in CI or your connector.

## Confirm it is working

Run `pnpm doctor` to check configuration and local database integrity. Open the workspace, translate a small real sample, and verify the downloaded result. `/health` reports whether the HTTP service is alive; it does not prove a provider can translate.

In the workspace, inspect failures and spending. An authenticated request to `/api/v1/operations` also reports queue health and delivery failures. Monitor the host externally so an outage is detected even when EveryLocale cannot send its own alert.

## Back up and prove recovery

For a native checkout using the default database, run from the repository root:

```sh
pnpm maintenance backup --output data/backups/snapshot.sqlite
pnpm maintenance check --database data/backups/snapshot.sqlite
pnpm maintenance restore --input data/backups/snapshot.sqlite --output data/restored.sqlite
```

Backup includes committed changes still in SQLite's WAL, queued jobs, approvals, spending, and pending notifications. Destinations must be new files. Keep a protected copy away from the host, plus the server settings and secrets needed to use it.

To recover, stop the service, set `EVERYLOCALE_DATABASE` to the restored file's absolute path, and restart. Use the same session and optional ChatGPT encryption secrets. Verify a known approved export and the job queue before resuming releases. A restored notification may be sent again; its receiver must recognize the event ID.

In Docker, run maintenance inside the container so it accesses the mounted database:

```sh
docker compose exec everylocale node packages/server/dist/maintenance.js backup --output /data/snapshot.sqlite
```

Copy that snapshot to protected storage outside the container. The path above matches the repository Docker image; retain its encryption/configuration secrets separately.

## Receive exception alerts

Set these server settings and restart:

```dotenv
EVERYLOCALE_WEBHOOK_URL=https://your-receiver.example.com/everylocale
EVERYLOCALE_WEBHOOK_SECRET=YOUR_INDEPENDENT_RANDOM_SECRET
```

Use a random secret of at least 32 characters. The receiver can send email, chat, or monitoring alerts. It receives publication changes, failed jobs, exhausted budgets, blocked automatic reviews, provider unavailability, and stalled queues. The service saves events durably and retries temporary delivery failures.

The receiver must verify the signature and process each event ID once. After eight failed deliveries, the event remains visible for an owner to retry. The [configuration reference](CONFIGURATION.md#exception-notifications) explains headers, signature verification, and timing. A webhook is not a built-in email service: provide a working receiver and test a failure notification before relying on it.

## Handle a failure

| Situation | Recovery |
| --- | --- |
| Provider outage or rejected key | Fix provider access, restart if settings changed, then retry failed jobs. Keep the deployed app unchanged. |
| Review needs attention | Open the findings, edit if needed, and approve the exact revision under your policy. Rerun the build. |
| Project budget exhausted | Inspect spending and reservations, raise the total limit if appropriate, and retry. No provider is changed automatically. |
| Notification delivery failed | Fix the receiver; retry dead deliveries through owner operations. |
| Bad app release | Deploy the previous app and activate its retained catalog release. |
| Bad source information | Correct the source and translate it again, or withdraw it if it must stop appearing immediately. |
| Host/database lost | Restore the verified backup with the same secrets, then inspect exports, jobs, and delivery before resuming. |

## Update without losing data

Keep the database volume, secrets, and previous application release. Back up before updating the service. Build and verify the new version, restart with the existing storage, and exercise an approved export plus one new translation. Do not run independent service replicas against separate copies of the same SQLite database.

A translation approval allows export; your application or publishing connector performs delivery. The [CI/CD guide](CI-CD.md) explains how to stop a release when translation is incomplete.
