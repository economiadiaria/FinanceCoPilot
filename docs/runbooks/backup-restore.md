# Backup and Restore Procedure

This runbook explains how to restore FinanceCoPilot services from database and object
store backups after a data loss or corruption incident.

## Prerequisites
- Production database admin role with permission to run `pg_restore`.
- Access to the daily S3 snapshots (`s3://financecopilot-backups`).
- Familiarity with the data access layers in `server/pj-routes.ts` so you can validate
  critical endpoints after the restore.
- Ability to run the smoke test harness in `scripts/smoke/index.ts`.

## Steps
1. **Declare the incident**
   - Trigger PagerDuty incident type "Data Loss" and notify the executive bridge.
   - Freeze deploys by toggling the `deployments_locked` flag in LaunchDarkly.
2. **Select the restore point**
   - List available snapshots: `aws s3 ls s3://financecopilot-backups/postgres/`.
   - Coordinate with product to pick the newest snapshot prior to the incident.
3. **Restore the primary database**
   - Stop write traffic by scaling API pods to zero using `kubectl scale deploy api --replicas=0`.
   - Restore the database: `pg_restore --clean --no-owner --dbname financecopilot <snapshot.dump>`.
   - Re-enable API pods once `pg_restore` completes.
4. **Restore dependent services**
   - Rehydrate object storage by copying relevant prefixes back to S3 if affected:
     `aws s3 sync ./snapshot/ofx s3://financecopilot-ofx`.
   - Flush ingestion caches: `redis-cli -h redis-ingestion FLUSHDB`.
5. **Communicate**
   - Update #status with progress and expected downtime.
   - Log each milestone in the PagerDuty incident timeline.

## Expected Outcome
- Database returns to a consistent state at the chosen snapshot time.
- API endpoints serve data without integrity errors.

## Verification
- Run `npm run smoke -- --filter=core` from `scripts/smoke/index.ts` to validate
  critical customer flows.
- Check `/pj/status` endpoint to ensure health checks pass (implemented in
  `server/pj-routes.ts`).
- Review Grafana dashboard `Platform > Database` for replication lag and error rates.

## Rollback
- If the restore introduces regressions, re-run `pg_restore` with an older snapshot.
- Maintain a copy of the pre-restore database by taking an immediate snapshot before
  the procedure for emergency revert.
- If API pods misbehave after restore, roll back to a clean container image using
  `npm run deploy -- --service api --ref <previous-tag>`.

## Escalation
- Primary: Database Reliability team (`db-oncall@financecopilot.com`).
- Secondary: VP of Engineering for RTO decisions (engineering@financecopilot.com).
- Legal/compliance contact for regulated data incidents: compliance@financecopilot.com.
