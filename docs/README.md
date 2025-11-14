# Documentation Index

Quick links to operational and product documentation for FinanceCoPilot.

## Operations & Observability

- [OFX Ingestion Metrics Catalog](./metrics/README.md) — Monitoring principles, metric definitions, and PromQL queries for ingestion pipelines.

## Product & Process References

- [Smoke Test Checklist](./SMOKE.md)
- [PJ Ingestion Test Plan](./pj-ingestion-test-plan.md)
- [PJ MVP Priority Roadmap](./pj-mvp-priority-roadmap.md)
- [Documentação técnica do ciclo PJ](./pj-cycle-tech.md)

## Developer Notes

- Run the full automated suite with `npm test` (powered by `tsx`).
- To execute a single integration test with the Node.js test runner on Node 20+, prefer `node --test --import tsx tests/<file>.test.ts` (the legacy `--loader` flag now errors out).
- Copie o arquivo `.env.example` para `.env` e preencha a variável `DATABASE_URL` com a string de conexão do Postgres (por exemplo, a URL fornecida pelo Replit).
