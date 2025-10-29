# Queue Drain and Catch-Up

Follow this runbook to safely drain ingestion or notification queues when backlog
threatens SLA commitments.

## Prerequisites
- Access to the RabbitMQ management console (`https://mq.financecopilot.com`).
- Ability to scale worker deployments via `kubectl`.
- Understanding of queue consumers defined alongside routes in `server/pj-routes.ts`.
- Familiarity with load-test helpers in `scripts/smoke/index.ts`.

## Steps
1. **Evaluate backlog**
   - Inspect queue lengths via the management console or run
     `kubectl exec mq-0 -- rabbitmqctl list_queues name messages consumers`.
   - Identify the queue with the highest delay (e.g., `ingestion.ofx`, `notifications.email`).
2. **Enable drain mode**
   - Toggle the `queue_drain_mode` feature flag to reroute new jobs to standby queues.
   - Announce the drain in #status with expected duration and impact.
3. **Scale workers**
   - Increase worker replicas: `kubectl scale deploy ingestion-worker --replicas=6`.
   - For notification backlog, scale `mailer-worker` similarly.
   - Ensure API rate limits are adjusted if draining OFX by updating the limit in
     `server/pj-routes.ts` configuration (`pjRateLimiter`).
4. **Monitor progress**
   - Watch Grafana dashboard `Queues > Drain Status` for throughput improvements.
   - Tail logs: `kubectl logs deploy/ingestion-worker -f | grep "processed"` to ensure
     workers are making progress.
5. **Return to steady state**
   - Once messages < 500, revert feature flags and scale workers back to baseline (usually 2 replicas).
   - Confirm new jobs flow into primary queues again.

## Expected Outcome
- Queue backlog returns to nominal levels without dropping or duplicating messages.
- Workers maintain stable processing rates during and after the drain.

## Verification
- Execute `npm run smoke -- --filter=queues` to validate queue consumers via
  `scripts/smoke/index.ts`.
- Hit `/pj/status` to confirm rate limiter settings reverted (implemented in
  `server/pj-routes.ts`).
- Review Datadog alert `Queue backlog high` to ensure it resolves automatically.

## Rollback
- If drain mode causes customer impact, immediately re-enable normal routing by toggling
  off `queue_drain_mode` and scaling workers back down.
- Requeue any diverted messages using `rabbitmqadmin purge queue name=<standby-queue>`
  followed by `rabbitmqadmin publish` commands to return them to primary queues.

## Escalation
- Primary: Messaging platform owner (messaging@financecopilot.com).
- Secondary: SRE on-call via PagerDuty schedule "Platform SRE".
- For customer-facing degradation beyond 15 minutes, escalate to Support Manager in #support-leads.
