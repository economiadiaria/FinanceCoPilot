# Plano de Prioridades MVP - Módulo PJ

## Objetivos Centrais
- Garantir que consultores e clientes PJ tenham uma experiência estável, com foco em ingestão de dados financeiros confiável, reconciliação assertiva e dashboards claros, respeitando a arquitetura existente em Node/Express no backend e React com Shadcn UI no frontend.【F:replit.md†L3-L58】
- Manter o escopo PF isolado até que o MVP PJ esteja sólido, preservando a separação de fluxos PF/PJ já refletida nos componentes dedicados a dashboards, vendas, conciliações e regras PJ no frontend.【F:client/src/pages/pj/dashboard-pj.tsx†L10-L200】

## Fases Prioritárias

### Fase 0 — Governança e Segurança de Acesso
1. **Introduzir o papel "master"** para gestão de consultores e clientes, ajustando o enum de `userRoles` e as validações de usuário que hoje contemplam apenas consultor e cliente.【F:shared/schema.ts†L152-L171】
2. **Refinar middlewares de escopo** para garantir que o master consiga vincular consultores a clientes sem expor dados cruzados, estendendo o `scopeRequired("PJ")` existente nos endpoints PJ conforme necessário.【F:server/pj-routes.ts†L320-L523】
3. **Fluxo de sessão e cadastro seguro**: revisar as rotas de autenticação para suportar criação e delegação de acessos pelo master antes de liberar o restante das funcionalidades PJ.【F:replit.md†L16-L44】

### Fase 1 — Onboarding de Clientes e Consultores
1. **Interface de associação master → consultor → cliente**, reaproveitando a estrutura modular da UI e garantindo que o cliente enxergue apenas métricas próprias (já condicionado por `clientType` no dashboard PJ).【F:client/src/pages/pj/dashboard-pj.tsx†L50-L88】
2. **Validação de dados cadastrais PJ** (doc, e-mail, canais) para evitar inconsistências que afetem reconciliações posteriores.【F:server/pj-routes.ts†L320-L523】

### Fase 2 — Ingestão de Vendas PJ
1. **Finalizar cadastro manual multi-parcela** verificando cálculo de planos de liquidação (`calculateSettlementPlan`) e persistência de legs.【F:server/pj-routes.ts†L24-L198】
2. **Revisar importação CSV** garantindo deduplicação por número de nota e data, controle de erros linha a linha e feedback ao usuário (contadores `imported`, `skipped`).【F:server/pj-routes.ts†L320-L438】
3. **Testes automatizados/roteiros manuais** cobrindo cenários de parcelas múltiplas, taxas elevadas e gateways distintos.

### Fase 3 — Ingestão Bancária OFX
1. **Blindar deduplicação por hash e FITID** na rota de importação OFX, tratando mensagens amigáveis para arquivos repetidos e transações já carregadas.【F:server/pj-routes.ts†L444-L523】
2. **Armazenar metadados bancários** (conta, banco, origem) para facilitar conciliações e relatórios subsequentes.【F:server/pj-routes.ts†L444-L523】
3. **Criar rotina de higienização periódica** (script manual inicialmente) para remover duplicidades residuais, preservando histórico como requerido.

### Fase 4 — Conciliação Bancária
1. **Aprimorar sugestões automáticas** de match leg ↔ transação, validando heurísticas de pontuação e expirando sugestões obsoletas.【F:server/pj-routes.ts†L632-L649】
2. **Fluxo de confirmação manual**: garantir que o endpoint de confirmação bloqueie reaproveitamento de transações já conciliadas e atualize estados de legs/parcela corretamente.【F:server/pj-routes.ts†L656-L737】
3. **Interface para reconciliações pendentes** com filtros por status (pendente, parcial, conciliado) e histórico de notas do consultor.

### Fase 5 — Categorização Inteligente PJ
1. **Consolidar CRUD de regras** com feedback retroativo/automático, aproveitando os endpoints de regras e aprendizagem de padrões (`matchesPattern`).【F:server/pj-routes.ts†L744-L823】
2. **Auditoria de sugestões IA**: registrar quem/como categorizou (regra, IA, manual) e permitir revisão rápida de exceções.
3. **Parâmetros configuráveis pelo master** para ajustar categorias principais e subcategorias que alimentam DFC.

### Fase 6 — Dashboards e Relatórios PJ
1. **Garantir integridade das métricas** exibidas no dashboard PJ, alinhando KPIs de resumo, tendências e divisão de receita aos dados concilidados.【F:client/src/pages/pj/dashboard-pj.tsx†L50-L200】
2. **Gerar relatórios mensais detalhados** com visão de custos consolidados, top custos e despesas a categorizar, exportáveis em PDF/CSV.
3. **Validar usabilidade** com base na paleta e tipografia definidas, mantendo mensagens consultivas porém acessíveis.【F:replit.md†L13-L58】

### Fase 7 — Insights de IA e Alertas
1. **Aplicar heurísticas financeiras PJ** (negociação de taxas >5%, investimento de caixa ocioso >20%) com base nas métricas calculadas, sinalizando tanto para consultores quanto clientes.【F:replit.md†L25-L41】
2. **Registrar explicações claras** sobre cada insight para reduzir esforço cognitivo do cliente e apoiar decisões do consultor.
3. **Planejar evolução PF** somente após validação do ciclo completo PJ (ingestão → categorização → conciliação → dashboard → insights).

## Estratégia de Qualidade e Redução de Erros
- **Testes automatizados graduais**: iniciar com testes de unidade para `calculateSettlementPlan`, deduplicação OFX e regras de categorização, evoluindo para testes de integração nos endpoints PJ críticos.【F:server/pj-routes.ts†L24-L823】
- **Roteiros manuais supervisionados** para uploads (CSV/OFX) e conciliações, documentando casos limite como parcelas divergentes, duplicidades e transações sem descrição.
- **Monitoração e logs**: aproveitar o logger de requisições API existente para rastrear duração e payloads, facilitando diagnóstico em produção.【F:server/index.ts†L19-L78】
- **Governança de dados**: definir cronograma mensal para limpeza de duplicidades e revisão das regras de categorização aprendidas.

## Próximos Passos Imediatos
1. Atualizar modelagem de usuários para suportar o papel master e fluxos de associação.
2. Implementar plano de testes mínimo (unitário + roteiros manuais) para ingestão de vendas e OFX.
3. Preparar protótipo de dashboard/relatórios validando métricas com dados reais importados.
