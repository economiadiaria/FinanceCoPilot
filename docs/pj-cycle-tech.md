# Documentação técnica do ciclo PJ

Este registro consolida validações operacionais solicitadas para o ciclo PJ.

## Validações recentes

### Drizzle migrations

- `npx drizzle-kit status` — a versão atual do CLI (`0.31.4`) não expõe esse comando e respondeu `Unknown command: 'status'. Type '--help' to get help on the cli.`
- `npx drizzle-kit check` — executado com `DATABASE_URL=postgresql://postgres@localhost:5432/financecopilot`, retornando `Everything's fine 🐶🔥`, confirmando ausência de pendências de migração.
