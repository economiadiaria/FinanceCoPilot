# Smoke Test Runner

The `npm run smoke` command executes `scripts/smoke/index.ts`, which validates the staging environment end-to-end using a deterministic OFX fixture.

## Required Environment Variables

Set the following variables before running the smoke test locally or in CI:

- `STAGING_BASE_URL` – Base URL of the deployed staging environment (e.g., `https://staging.example.com`).
- `SMOKE_EMAIL` – Login email for an account with permissions to import PJ OFX statements.
- `SMOKE_PASSWORD` – Password for the smoke test user.
- `SMOKE_CLIENT_ID` – Client identifier used for OFX imports and transaction queries.
- `SMOKE_BANK_ACCOUNT_ID` – Bank account identifier expected in the OFX payload and queried for recent transactions.

## What the Script Does

1. Checks `/healthz` and `/readyz`.
2. Authenticates via `/api/auth/login`, reusing the returned session cookies.
3. Imports the deterministic OFX fixture located at `scripts/smoke/fixtures/sample.ofx` for the configured client.
4. Fetches `/api/pj/transactions` with `limit=1` and fails if no items are returned.
5. Logs all `X-Request-Id` headers for observability and exits non-zero on any failure.
