# Reprocess OFX Imports

This runbook covers recovering from partially processed OFX uploads so customer
transactions are reconciled correctly.

## Prerequisites
- Production SSH access to the ingestion worker hosts.
- Ability to run the OFX replay script via `npm run scripts -- ofx:replay`.
- Familiarity with the OFX ingestion API defined in `server/pj-routes.ts`.
- Read access to the ingestion queue (RabbitMQ: `ingestion.ofx`).

## Steps
1. **Identify the failed batch**
   - Query the ingestion audit table for the account using the following SQL on the
     analytics replica: `SELECT * FROM ofx_ingestions WHERE status = 'failed' ORDER BY created_at DESC LIMIT 5;`
   - Confirm the affected `ingestion_id` in PagerDuty ticket notes.
2. **Pause new uploads**
   - Disable the `/pj/ofx` route in `server/pj-routes.ts` by toggling the `isUploadEnabled`
     feature flag in LaunchDarkly.
   - Notify customer support to temporarily block new OFX submissions.
3. **Replay the OFX file**
   - Download the raw OFX payload from S3: `aws s3 cp s3://financecopilot-ofx/$INGESTION_ID ./replay.ofx`.
   - Execute the replay script on the worker host: `npm run scripts -- ofx:replay --file ./replay.ofx`.
   - Monitor the worker logs (`journalctl -fu ingestion-worker`) for processing status.
4. **Re-enable uploads**
   - Revert the LaunchDarkly flag for `/pj/ofx` and confirm the route is active via
     `curl -I https://api.financecopilot.com/pj/ofx`.

## Expected Outcome
- The failed OFX ingestion is marked as `completed` and new transactions appear in the
  user's ledger.
- No additional jobs are queued for the same ingestion ID.

## Verification
- Run `npm run smoke -- --filter=ofx` from `scripts/smoke/index.ts` to execute the
  ingestion smoke test.
- Check the ingestion dashboard in Grafana (`Ingestion > OFX Replay`) for the batch to
  move from *Failed* to *Completed*.
- Confirm the API returns transactions via
  `curl https://api.financecopilot.com/pj/accounts/$ACCOUNT_ID/transactions | jq '.[0]'`.

## Rollback
- If the replay introduces duplicate transactions, disable `/pj/ofx` again and run the
  rollback script: `npm run scripts -- ofx:rollback --ingestion $INGESTION_ID`.
- Restore the original payload by marking the ingestion as `failed` via the admin tool
  (`scripts/smoke/index.ts` contains the `markIngestionFailed` helper).

## Escalation
- Primary: #oncall-ingestion Slack channel.
- Secondary: PagerDuty escalation "Ingestion On-Call L2" (currently owned by Priya Patel).
- For data integrity concerns, escalate to the Data Engineering team lead (data-eng@financecopilot.com).
