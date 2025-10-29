# OFX Ingestion Metrics Catalog

This catalog centralizes the business-critical Prometheus metrics emitted by the FinanceCoPilot API to monitor OFX (Open Financial Exchange) ingestion for PJ customers. It summarizes the guiding principles for our observability instrumentation, describes each metric, and provides ready-to-use PromQL examples so operators can react quickly when data ingestion degrades.

## Monitoring principles

- **Single registry, consistent service label** – Metrics are registered through `prom-client`'s `Registry` with the `service` label set to `financecopilot-api` (or overridden with `SERVICE_NAME`). Scrape configurations can rely on this label for job grouping.
- **Normalized identifiers** – `bankAccountId` and `bankName` are normalized via `normalizeLabel()` to avoid empty strings and whitespace-only values. Missing or blank values are exported as `unknown` to keep cardinality bounded.
- **Client context is preserved** – `clientId` is passed through unchanged so dashboards can slice by tenant. Use `clientId` + `bankAccountId` together to pinpoint the exact customer account.
- **Lifecycle-aware instrumentation** – `startOfxIngestionTimer()` and `recordOfxIngestionDuration()` wrap ingestion flows so that active counts and durations stay in sync, even on failures.
- **Low-cardinality stages** – Error metrics include a `stage` label to highlight the failing phase (e.g., download, parse, persist) without exploding label combinations.

## Metric summary

| Metric name | Type | Labels | Description | Refresh source |
| --- | --- | --- | --- | --- |
| `ofx_ingestion_duration_seconds` | Histogram | `clientId`, `bankAccountId`, `bankName`, `status` | Latency of OFX PJ ingestion executions in seconds, tracked separately for successes and failures. Buckets: 0.5s–120s. | Observed when `recordOfxIngestionDuration()` completes an ingestion started by `startOfxIngestionTimer()`.
| `ofx_ingestion_errors_total` | Counter | `clientId`, `bankAccountId`, `bankName`, `stage` | Cumulative number of ingestion errors, labeled with the stage where the failure occurred. | Incremented via `incrementOfxError()` whenever an ingestion stage raises an error.
| `ofx_ingestion_active` | Gauge | `clientId`, `bankAccountId`, `bankName` | Current number of OFX ingestion jobs in-flight. | Incremented by `startOfxIngestionTimer()` and decremented by `recordOfxIngestionDuration()` after completion.

> **Label mapping note:** `clientId` and `bankAccountId` refer to the same identifiers used in ingestion jobs. `bankAccountId` is normalized to `unknown` if missing/blank, while `clientId` stays as provided so operators can join metrics with CRM data. `bankName` follows the same normalization rule. Use these labels to correlate metrics from the same tenant or bank account.

## Metric details & PromQL playbook

### `ofx_ingestion_duration_seconds`

Latency histogram emitted when an ingestion run finishes, regardless of outcome. The `status` label is set to `success` or `error` by `recordOfxIngestionDuration()` so you can compare healthy vs failing runs.

**PromQL examples**

- **P95 duration per bank account (last 15 minutes):**
  ```promql
  histogram_quantile(
    0.95,
    sum by (le, clientId, bankAccountId, bankName) (
      rate(ofx_ingestion_duration_seconds_bucket{status="success"}[15m])
    )
  )
  ```
- **Average duration per client:**
  ```promql
  sum by (clientId) (
    rate(ofx_ingestion_duration_seconds_sum[10m])
  ) /
  sum by (clientId) (
    rate(ofx_ingestion_duration_seconds_count[10m])
  )
  ```
- **Failure vs success volume:**
  ```promql
  sum by (status) (
    rate(ofx_ingestion_duration_seconds_count[5m])
  )
  ```

**Usage notes**

- Pair the histogram with `ofx_ingestion_errors_total` to diagnose whether slowdowns coincide with specific error stages.
- Filter on `bankAccountId="unknown"` to surface ingestion attempts where account metadata was missing.
- Because the timer decrements the active gauge, a missing completion would show up as a steadily growing `ofx_ingestion_active` value.

### `ofx_ingestion_errors_total`

Counts ingestion failures, segmented by `stage`. Typical stage values include high-level pipeline steps (e.g., `download`, `parse`, `persist`).

**PromQL examples**

- **Error rate per bank account:**
  ```promql
  rate(ofx_ingestion_errors_total[10m])
    by (clientId, bankAccountId, bankName)
  ```
- **Top failing stages across all clients:**
  ```promql
  topk(5,
    rate(ofx_ingestion_errors_total[30m])
      by (stage)
  )
  ```
- **Error ratio vs total ingestions:**
  ```promql
  sum by (clientId, bankAccountId) (
    rate(ofx_ingestion_errors_total[15m])
  ) /
  sum by (clientId, bankAccountId) (
    rate(ofx_ingestion_duration_seconds_count[15m])
  )
  ```

**Usage notes**

- The `stage` label can be used in alerts to direct responders to the failing subsystem.
- Combine with `status="error"` buckets from the duration metric to correlate failure counts with runtime.
- Errors automatically inherit normalized `bankAccountId`/`bankName`, ensuring aggregation aligns with duration metrics.

### `ofx_ingestion_active`

Tracks concurrent ingestion jobs. Incremented at the beginning of a run and decremented on completion.

**PromQL examples**

- **Current active ingestions per client:**
  ```promql
  ofx_ingestion_active
  ```
- **Peak concurrency per bank account over 24h:**
  ```promql
  max_over_time(ofx_ingestion_active[24h])
  ```
- **Alert when an ingestion appears stuck (active without completions):**
  ```promql
  ofx_ingestion_active
    -
  sum_over_time(
    rate(ofx_ingestion_duration_seconds_count[30m])
      by (clientId, bankAccountId, bankName)
  )
  ```

**Usage notes**

- A persistent non-zero value alongside low `ofx_ingestion_duration_seconds_count` rates indicates stuck jobs.
- Dashboards can use `sum(ofx_ingestion_active) by (clientId)` to monitor ingest load per tenant.
- Because `bankAccountId` may be `unknown`, alerting rules should default to that label to avoid missing anonymized accounts.

## Operational tips

- Scrape the `/metrics` endpoint every 15s to balance freshness with overhead.
- When testing locally, set `SERVICE_NAME` to differentiate multiple environments in a shared Prometheus.
- Use recording rules to precompute percentiles from `ofx_ingestion_duration_seconds` so dashboards remain fast.
