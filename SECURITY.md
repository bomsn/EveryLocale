# Security policy

## Supported versions

Security fixes are released for the latest published minor version. Before 1.0, that is the newest `0.x` release; upgrade to it to receive fixes.

## Reporting a vulnerability

Report vulnerabilities privately through [GitHub security advisories](https://github.com/bomsn/EveryLocale/security/advisories/new). Do not open a public issue, pull request or discussion for a suspected vulnerability.

Include the affected package and version, the configuration involved, steps to reproduce, and the impact you observed. Remove real credentials, customer content and personal data from anything you send.

You will receive an acknowledgement within five working days. Confirmed issues are fixed in a new release, and the advisory is published once a fixed version is available.

## Scope

In scope: the service and its HTTP API, the review workspace, authentication and token handling, the CLI, the runtime packages, parsers and renderers, and the WordPress connector.

Out of scope: vulnerabilities in a model provider, a reverse proxy or a host you operate; findings that need an already compromised server or administrator token; and the quality of model translations.

## Operating securely

Run the service behind HTTPS with `EVERYLOCALE_PUBLIC_ORIGIN` set to its exact address, keep provider keys and the administrator token on the server, give each app or build its own scoped project token with an expiry, and keep backups as protected as the live database. The [operations guide](docs/OPERATIONS.md) covers each of these.
