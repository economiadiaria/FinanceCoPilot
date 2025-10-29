# FinanceCoPilot Runbooks

These runbooks describe how to diagnose, mitigate, and recover from the most common
operational scenarios encountered by FinanceCoPilot. Each document is intended to be
self-service so any engineer on rotation can follow the steps without prior context.

## Available runbooks

- [Reprocess OFX imports](./reprocess-ofx.md)
- [Ingestion failure handling](./ingestion-failure.md)
- [Backup and restore procedure](./backup-restore.md)
- [Queue drain and catch-up](./queue-drain.md)

Every runbook follows the same format:

1. **Prerequisites** – tooling, access, and knowledge required before taking action.
2. **Steps** – a sequenced plan to diagnose the issue and apply a fix.
3. **Verification** – how to confirm the system is healthy (commands, API checks, and dashboards).
4. **Rollback** – explicit guidance to revert changes safely if needed.
5. **Escalation** – who to contact when the documented steps are insufficient.

Update this index whenever a new operational scenario is added so on-call engineers
can find the appropriate playbook quickly.
