# Plano de Testes - Ingestão de Vendas e OFX (PJ)

Este plano define a cobertura mínima de testes automatizados e manuais para garantir a qualidade dos fluxos de ingestão de vendas (cadastro manual e importação CSV) e de extratos bancários OFX no módulo PJ.

## 1. Escopo e Premissas
- Ambiente alvo: backend Express + armazenamento `MemStorage` (ou equivalente) rodando em modo de desenvolvimento.
- Perfis envolvidos: usuário master, consultor PJ e cliente PJ.
- Dados base sugeridos:
  - Cliente PJ cadastrado com consultor associado.
  - Métodos de pagamento previamente configurados para permitir cálculo de liquidação.
  - Regras de categorização opcionais para validar automação.

## 2. Testes Automatizados (unitários)
Os testes unitários estão em `tests/pj-ingestion.test.ts` e cobrem as regras críticas de negócio dos helpers de ingestão.

| Caso | Objetivo | Cobertura principal |
| --- | --- | --- |
| `calculateSettlementPlan falls back to D+1 when no method is provided` | Garante parcela única D+1 na ausência de configuração | Regras padrão de liquidação |
| `calculateSettlementPlan respects D+2 configuration` | Valida prazos D+X | Métodos com liquidação fixa |
| `calculateSettlementPlan splits installments when configured per parcel` | Confere D+30_por_parcela | Parcelamento proporcional |
| `isDuplicateTransaction detects duplicates by FITID and fallback signature` | Evita duplicação de OFX | Hash FITID e combinação data/valor/descrição |
| `applyCategorizationRules tags only matching transactions` | Testa auto-categorização | Uso de regras ativas vs. desativadas |
| `matchesPattern respects strategies` | Regras de matching | Estratégias exact/contains/startsWith |
| `extractPattern derives helpful defaults` | Sugestão de padrões | Aprendizado de regras manuais |

**Como executar**
```bash
npm test
```

## 3. Testes Manuais - Ingestão de Vendas

### 3.1 Cadastro manual (`POST /api/pj/sales/add`)
1. Autenticar como consultor ou master com escopo PJ.
2. Enviar payload com múltiplas legs (diferentes métodos de pagamento) e verificar resposta:
   - `sale` contém soma correta de `grossAmount` e `netAmount`.
   - Cada leg possui `settlementPlan` coerente com método configurado.
3. Validar no armazenamento que `sale` foi persistida e legs armazenadas via `storage.getSaleLegs`.
4. Repetir com método não configurado (ou sem `liquidacao`) e garantir geração de plano D+1.
5. Tentar cadastrar sem `clientId` ou com `legs` vazias e confirmar mensagens de erro (400).

### 3.2 Importação CSV (`POST /api/pj/sales/importCsv`)
1. Fazer upload de arquivo CSV contendo múltiplas vendas com mesmo `invoiceNumber` para testar consolidação de legs.
2. Verificar resposta:
   - Campo `imported` reflete número de vendas processadas.
   - IDs gerados (`saleId`, `saleLegId`) únicos por linha consolidada.
3. Reimportar o mesmo arquivo e confirmar que não há duplicação (o backend deve reutilizar `invoiceNumber` + `date` + `customer`).
4. Submeter CSV inválido (colunas faltantes) e garantir retorno 400 com mensagem descritiva.

## 4. Testes Manuais - Importação de OFX (`POST /api/pj/import/ofx`)
1. Upload de arquivo OFX válido contendo ao menos duas transações.
   - Confirmar resposta com `imported`, `total` e `autoCategorized` coerentes.
   - Validar persistência via `GET /api/pj/transactions`.
2. Reenviar o mesmo arquivo e verificar resposta 409 com mensagem de duplicidade.
3. Upload de arquivo contendo transações com `FITID` ausente, mas descrições e valores duplicados:
   - Confirmar que somente uma transação é importada (deduplicação por assinatura).
4. Configurar regra de categorização ativa (`/api/pj/categorization/rules`) e importar OFX com transação correspondente para validar preenchimento automático de `categorizedAs`.
5. Forçar erro (arquivo OFX malformado) e garantir tratamento 400 com mensagem clara.

## 5. Roteiro de Regressão Integrada
Após finalizar os testes acima, executar rapidamente os relatórios principais:
- `GET /api/pj/dashboard/summary` para mês atual e validar que receitas/despesas consideram transações recém-importadas.
- `GET /api/pj/dashboard/sales-kpis` para confirmar atualização de `totalSales` e `ticketMedio` após cadastros manuais/CSV.

## 6. Critérios de Saída
- Todos os testes unitários passando (`npm test`).
- Roteiros manuais executados sem regressões ou erros bloqueadores.
- Logs do servidor sem exceções não tratadas durante os cenários.

Cumpridos os critérios, a funcionalidade de ingestão PJ estará pronta para iterações de refinamento e automação adicional.
