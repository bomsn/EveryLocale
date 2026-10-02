# Configuration

Start with [Translate your first file](GETTING-STARTED.md) for a complete working setup. This page is the reference for changing that setup. After editing `.env`, run `pnpm doctor` and restart the service.

## Choose a provider

| Setup | What you supply |
| --- | --- |
| OpenRouter or a compatible cloud API | The endpoint, API key, model identifier, and current input/output prices for both roles. |
| A local OpenAI-compatible model server | Its endpoint and model name. Use zero prices only when it is genuinely unmetered. The model must support structured JSON responses. |
| Optional ChatGPT plan access | An eligible account, explicit sign-in consent, an encryption key, and one of the models returned by that connection. |

**Generation** creates the translation. **Review** checks meaning and wording in a separate request. Both must be configured before translation starts. You may use the same model in two separate requests or different providers for each role. Configure prices independently. Keep keys on the service; app/CI access uses a separate project token.

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

### Optional ChatGPT plan connection

Eligible self-hosted installations can use **Continue with ChatGPT** instead of an API key. OpenAI determines account and integration eligibility. Plan usage consumes the account's allowance; manage app limits and credit permissions in [ChatGPT settings](https://chatgpt.com/settings/usage).

Generate an independent encryption key:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Save it as `EVERYLOCALE_CHATGPT_SECRET` in `.env`, then run `pnpm chatgpt connect` on the computer running EveryLocale. Open the official authorization link and grant permission. The command lists the account's available models. Credentials are encrypted in SQLite; keep the encryption key with protected backups.

For each role using the connection, set `_PROVIDER=chatgpt`, `_ACCOUNT` to the saved issued account ID, and `_MODEL` to a discovered model. For example, use `EVERYLOCALE_GENERATOR_PROVIDER`, `EVERYLOCALE_GENERATOR_ACCOUNT`, and `EVERYLOCALE_GENERATOR_MODEL`. Generation and review can use different providers. Restart the service after changing configuration.

`pnpm chatgpt accounts` lists saved registrations. `models --account ID`, `disconnect --account ID`, and `resume --account ID` manage a connection. Disconnect clears local tokens and attempts remote revocation; account registration and host identity remain for later sign-in. Quota and eligibility failures pause new translation requests. Resume only after resolving the applicable limit or permission. Transient failures preserve credentials and use bounded retries. There is no automatic paid fallback.

Run GitHub Actions against a persistent EveryLocale service with a scoped project token. Keep ChatGPT refresh credentials on that service. Ephemeral runners are unsuitable for rotating sessions. For a remote host, establish `ssh -L 1455:127.0.0.1:1455 user@host` from your computer, then run `pnpm chatgpt connect --callback-port 1455` on that host. Open its sign-in link in your local browser. The protected tunnel delivers the loopback callback to the service; do not expose it publicly. Commercial or remotely hosted offerings must verify the applicable [OpenAI eligibility](https://developers.openai.com/siwc/token-sharing-open-source).

`EVERYLOCALE_CONCURRENCY` limits active jobs. `EVERYLOCALE_PROVIDER_INTERVAL_MS` sets the minimum interval between provider requests. Each project has a cumulative USD budget covering generation and review.

## Access

`EVERYLOCALE_ADMIN_TOKEN` grants workspace administration. `EVERYLOCALE_SESSION_SECRET` signs browser sessions. Use independent random values of at least 32 characters.

Create scoped project tokens in **Connect → Manage access**. Tokens have an expiry and can be revoked. Keep provider credentials and application access tokens in server-side environment variables.

## Deployment

The default host is `127.0.0.1`, with port `4310`. For remote access, configure an HTTPS reverse proxy and set `EVERYLOCALE_PUBLIC_ORIGIN` to the exact public origin. Browser session mutations require that origin and a CSRF token.

`EVERYLOCALE_DATABASE` selects the SQLite database path. Run one service instance per database. Docker stores the database in its `everylocale-data` volume and runs the service as a non-root user.

## Backups

From the checkout, create a consistent online backup without stopping the service:

```sh
pnpm maintenance backup --database data/everylocale.sqlite --output data/backups/snapshot.sqlite
pnpm maintenance check --database data/backups/snapshot.sqlite
pnpm maintenance restore --input data/backups/snapshot.sqlite --output data/restored.sqlite
```

Destinations must be new files. A backup includes the live WAL state, approvals, spending, tokens, jobs, publications, and pending delivery. For recovery, stop the service, set `EVERYLOCALE_DATABASE` to the verified restored file, and start it. Retain the same secrets, including any ChatGPT encryption key. Protect backups as production data and store a copy away from the service host. Expired worker leases recover conservatively; uncertain inference may already have incurred charges. Publication notifications can be redelivered after restoration, so receivers must deduplicate event IDs.

## Exception notifications

Set `EVERYLOCALE_WEBHOOK_URL` and an independent `EVERYLOCALE_WEBHOOK_SECRET` of at least 32 characters. The receiver gets publication changes, exhausted budgets, failed jobs, and blocked automatic reviews. Events persist with the underlying change, retry with backoff, and retain a stable ID. After eight failed deliveries, owner operations show a dead delivery that can be retried after fixing the receiver.

Verify `X-EveryLocale-Signature` as hex HMAC-SHA256 of `X-EveryLocale-Timestamp + '.' + raw request body`; compare safely and reject timestamps more than five minutes old. Deduplicate `X-EveryLocale-Event-Id`, processing each event once. A successful response is any HTTP 2xx. Notification detail excludes source text and credentials. Connect your own email, chat, or monitoring relay to this endpoint. Monitor authenticated `/api/v1/operations` for queue age, failures, spending, and dead deliveries; use `/health` for liveness.

The service checks queue health every 30 seconds. Pending work with unavailable providers emits `alert.provider_unavailable`; work pending for 15 minutes emits `alert.queue_stalled`. Unresolved conditions repeat at most hourly per project, with suppression retained across restarts. A growing queue can trigger a stalled alert even when some work is progressing; inspect queue age and throughput before changing concurrency. Use an external uptime monitor for host outages, when the service cannot send its own notifications.
