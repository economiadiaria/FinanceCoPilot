# Ingestion Failure Handling

Use this runbook when the primary ingestion pipeline is failing or lagging, leading to
missing or delayed transactions for customers.

## Prerequisites
- Production read access to the ingestion database and queue metrics.
- Ability to deploy hotfixes to the ingestion service via GitHub Actions.
- Familiarity with the ingestion routes in `server/pj-routes.ts` and worker
  orchestrations in `scripts/smoke/index.ts`.
- PagerDuty on-call rotation laptop with VPN access.

## Steps
1. **Assess the impact**
   - Review the Grafana dashboard `Ingestion > Pipeline Health` focusing on the
     `failed_jobs` and `processing_latency` panels.
   - In Kibana, filter logs by `service: ingestion-worker` to identify the most recent
     error stack traces.
2. **Validate upstream availability**
   - Run `curl -I https://api.financecopilot.com/pj/status` to confirm the ingestion
     API is responsive.
   - Use the smoke harness: `npm run smoke -- --filter=ingestion` (implemented in
     `scripts/smoke/index.ts`) to reproduce the failure in a controlled way.
3. **Mitigate**
   - If the error is configuration related, update the feature flags or environment
     variables as documented in the deployment repository (`config/ingestion.env`).
   - For code regressions, roll back to the last known good release by redeploying the
     previous Git tag using `npm run deploy -- --service ingestion --ref <tag>`.
   - If queue growth exceeds 10k messages, scale the worker pool to 3x via the
     Kubernetes dashboard (`workloads > ingestion-worker > scale`).
4. **Communicate**
   - Post an incident update in #status with the customer impact and mitigation plan.
   - Update the PagerDuty incident timeline with actions taken.

## Expected Outcome
- Ingestion jobs resume processing within acceptable latency (<5 minutes backlog).
- Customer transactions appear in the ledger without manual intervention.

## Verification
- Confirm `failed_jobs` returns to baseline (<5) on the Grafana dashboard.
- Execute `npm run smoke -- --filter=ingestion` again to validate end-to-end success.
- Check the API route `/pj/accounts/:id/transactions` (implemented in
  `server/pj-routes.ts`) returning HTTP 200 with fresh data.

## Rollback
- If the redeploy or config change worsens the incident, revert to the prior release
  tag using `npm run deploy -- --service ingestion --ref <previous-tag>`.
- Undo scaling changes by returning the worker deployment to its baseline replica
  count (documented in the deployment README).

## Escalation
- Primary: PagerDuty "Ingestion On-Call" (rotation owner in PagerDuty schedule).
- Secondary: Platform SRE team via #sre Slack channel.
- For customer-impacting data gaps lasting more than 30 minutes, escalate to the Head
  of Product (product@financecopilot.com).
