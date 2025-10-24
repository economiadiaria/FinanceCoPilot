# Copiloto Financeiro da Economia Diária

## Visão Geral
SaaS de consultoria financeira para Pessoa Física (PF) e Pessoa Jurídica (PJ) desenvolvido com Node.js, Express e React. Sistema completo de gestão financeira com fluxo de caixa, categorização de transações, módulo de investimentos e geração de relatórios.

## Arquitetura

### Stack Tecnológico
- **Backend**: Node.js + Express
- **Frontend**: React + TypeScript + Vite
- **Database**: In-memory storage (MemStorage)
- **UI**: Shadcn UI + Tailwind CSS
- **State Management**: TanStack Query (React Query)
- **Routing**: Wouter
- **Parsing**: PapaParse (CSV)

### Estrutura de Dados (In-Memory Storage)

#### Clients
```typescript
{
  "clientId": string,
  "name": string,
  "type": "PF" | "PJ" | "BOTH",
  "email"?: string
}
```

#### Transactions
```typescript
{
  "date": string, // YYYY-MM-DD
  "desc": string,
  "amount": number, // positivo = entrada, negativo = saída
  "category"?: "Receita" | "Custo Fixo" | "Custo Variável" | "Impostos" | "Lazer" | "Taxas" | "Investimento" | "Outros",
  "subcategory"?: string,
  "status": "pendente" | "categorizada" | "revisar",
  "fitid"?: string, // OFX unique transaction ID (para deduplicação)
  "accountId"?: string // ID da conta bancária (do OFX)
}
```

#### Positions (Investimentos)
```typescript
{
  "asset": string,
  "class": "RF" | "RV" | "Fundos" | "Outros",
  "value": number,
  "rate"?: number,
  "liquidity"?: string, // ex: "D+0", "D+1"
  "maturity"?: string // YYYY-MM-DD
}
```

#### Policies
**PF**:
```typescript
{
  "targets": { RF: 60, RV: 20, Fundos: 15, Outros: 5 },
  "rule50_30_20"?: boolean
}
```

**PJ**:
```typescript
{
  "cashPolicy": {
    "minRF": 70,
    "maxRV": 10,
    "maxIssuerPct": 30,
    "maxDurationDays": 365
  }
}
```

## API Endpoints

### Autenticação
Todos os endpoints requerem header `X-API-KEY` com valor configurado no ambiente.

### Endpoints Implementados

1. **POST /api/client/upsert** - Criar/atualizar cliente
   - Body: `{ clientId, name, type, email? }`

2. **POST /api/transactions/importCsv** - Importar transações via CSV
   - Body: `{ clientId, csvText }`
   - Formato CSV: `date,desc,amount[,category]`

3. **POST /api/import/ofx** - Importar transações via arquivo OFX bancário ⭐ NOVO
   - Form Data: `{ clientId, ofx: File }`
   - Faz parsing do OFX, extrai transações e remove duplicatas via FITID
   - Retorna: `{ success, imported, total, message }`

4. **GET /api/transactions/list** - Listar transações
   - Query: `?clientId=...&status=...&from=...&to=...&category=...`
   - Retorna: `{ transactions: [], summary: { totalIn, totalOut, count } }` ⭐ ATUALIZADO

5. **POST /api/transactions/categorize** - Categorizar transações em lote
   - Body: `{ clientId, indices: number[], category, subcategory? }`

6. **GET /api/summary** - Obter resumo e KPIs
   - Query: `?clientId=...&period=AAAA-MM`
   - Retorna: totalIn, totalOut, balance, revenue, costs, profit, margin, ticketMedio, topCosts, insights

7. **GET /api/investments/positions** - Listar posições de investimento
   - Query: `?clientId=...`

8. **POST /api/investments/rebalance/suggest** - Sugestões de rebalanceamento
   - Body: `{ clientId }`
   - PF: compara alocação atual vs targets
   - PJ: valida cashPolicy (minRF, maxRV, maxIssuerPct, maxDurationDays)

9. **POST /api/reports/generate** - Gerar relatório mensal
   - Body: `{ clientId, period: "AAAA-MM", notes? }`
   - Retorna HTML para impressão/visualização

10. **GET /api/reports/view** - Visualizar relatório
    - Query: `?clientId=...&period=AAAA-MM`
    - Retorna HTML salvo ou gera on-the-fly

11. **POST /api/policies/upsert** - Atualizar políticas
    - Body: `{ clientId, data }` (PF.targets ou PJ.cashPolicy)

12. **GET /api/docs** - Documentação completa da API ⭐ NOVO
    - Retorna HTML com documentação de todos os endpoints e exemplos de uso

## Funcionalidades Frontend

### Páginas Principais

1. **Dashboard** (`/`)
   - KPIs: Receita Total, Lucro, Margem
   - Insights inteligentes
   - Transações recentes (últimas 10)
   - Ações rápidas

2. **Transações** (`/transacoes`)
   - Upload de CSV
   - Filtros por categoria e status
   - Categorização em lote
   - Tabela com todas as transações

3. **Investimentos** (`/investimentos`)
   - Adicionar posições manualmente
   - Visualização de alocação por classe
   - Grid de posições ativas
   - Sugestões de rebalanceamento

4. **Relatórios** (`/relatorios`)
   - Seleção de período
   - Geração de relatórios mensais
   - Visualização HTML
   - Opção de impressão/PDF

5. **Configurações** (`/configuracoes`)
   - Tabs para PF e PJ
   - Configuração de targets (PF)
   - Configuração de cashPolicy (PJ)
   - Regra 50/30/20 (PF)

### Componentes Principais

- **AppSidebar**: Navegação lateral com ícones
- **ClientSelector**: Dropdown para selecionar/criar clientes
- **ThemeToggle**: Alternância entre modo claro/escuro
- **MetricCard**: Cards de KPI com valores e variações
- **NewClientDialog**: Modal para cadastro de novos clientes

## Heurísticas Inteligentes

### Pessoa Física (PF)
- Lazer > 30% das saídas → Recomenda teto e redução
- RV > alvo + 10pp → Sugere rebalanceamento para RF/Fundos

### Pessoa Jurídica (PJ)
- Taxas > 5% da receita → Recomenda negociação com adquirente
- Caixa parado > 20% receita → Sugere aplicar em RF curta

## Design System

### Cores
- **Primary**: Azul corporativo (#2563eb)
- **Success**: Verde para valores positivos
- **Destructive**: Vermelho para valores negativos
- **Muted**: Cinza para informações secundárias

### Tipografia
- **Font**: Inter (Google Fonts)
- **Números financeiros**: Sempre com `tabular-nums` para alinhamento
- **Títulos de página**: text-3xl font-bold
- **Cards**: text-lg font-semibold

### Layout
- **Max width**: max-w-7xl
- **Spacing**: Sistema baseado em 2, 4, 6, 8, 12, 16, 20
- **Grid**: Responsivo (1 col mobile, 2 tablet, 3 desktop)
- **Sidebar**: Largura fixa 16rem

## Desenvolvimento

### Comandos
```bash
npm run dev    # Inicia servidor desenvolvimento
npm run build  # Build para produção
npm run start  # Servidor produção
```

### Estrutura de Pastas
```
client/
  src/
    components/     # Componentes reutilizáveis
    pages/          # Páginas principais
    lib/            # Utilitários e configurações
    hooks/          # Custom hooks
server/
  routes.ts         # Definição de endpoints API
  storage.ts        # Interface de storage
shared/
  schema.ts         # Tipos compartilhados
```

## Estado Atual
✅ Schemas definidos
✅ Frontend completo com todas as páginas
✅ Componentes UI implementados
✅ Theme dark/light funcional
✅ Sistema de navegação com sidebar
✅ Integração React Query configurada
✅ Backend com 12 endpoints implementados (incluindo OFX e /api/docs)
✅ Storage em memória funcional
✅ Middleware de autenticação X-API-KEY
✅ Parsing CSV e **OFX bancário** com deduplicação ⭐ NOVO
✅ Cálculo de KPIs
✅ Heurísticas inteligentes
✅ Integração frontend ↔ backend completa
✅ Documentação completa da API em /api/docs ⭐ NOVO
✅ Mensagem de inicialização no console ⭐ NOVO
🎉 **Aplicação totalmente funcional!**

## Como Testar

### 1. Criar Cliente
1. Clique em "Selecione um cliente..." no topo
2. Clique em "Novo cliente"
3. Preencha:
   - ID: `empresa_demo_pj`
   - Nome: `Empresa Demo`
   - Tipo: `Pessoa Jurídica`
   - Email (opcional): `contato@empresademo.com`
4. Clique em "Criar Cliente"

### 2. Importar Transações
**Via CSV:**
1. Navegue para "Transações"
2. Clique em "Importar CSV"
3. Selecione o arquivo `exemplo-transacoes.csv` (já incluído no projeto)
4. Aguarde confirmação

**Via OFX (arquivo bancário):** ⭐ NOVO
1. Navegue para "Transações"
2. Clique em "Importar OFX"
3. Selecione um arquivo .ofx exportado do seu banco
4. O sistema extrai automaticamente data, descrição, valor e ID da transação
5. Duplicatas são removidas automaticamente via FITID

### 3. Categorizar Transações
1. Na página de Transações, selecione transações pendentes
2. Use os botões "Receita", "Custo Fixo", "Custo Variável" para categorizar em lote

### 4. Visualizar Dashboard
1. Volte ao Dashboard
2. Veja KPIs: Receita Total, Lucro, Margem
3. Confira insights inteligentes gerados automaticamente
4. Veja transações recentes

### 5. Gerenciar Investimentos
1. Navegue para "Investimentos"
2. Clique em "Adicionar Posição"
3. Preencha dados de um investimento (ex: CDB, RF, R$ 15.000)
4. Veja alocação por classe
5. Configure metas em "Configurações" para ver sugestões de rebalanceamento

### 6. Gerar Relatório
1. Navegue para "Relatórios"
2. Clique em "Gerar Relatório"
3. Selecione o período (ex: 2025-10)
4. Adicione observações (opcional)
5. Visualize e imprima o relatório HTML

## Arquivo CSV de Exemplo
O arquivo `exemplo-transacoes.csv` contém 12 transações de exemplo para outubro/2025, incluindo receitas, custos fixos, custos variáveis, impostos e lazer.

## Próximas Melhorias (Futuro)
1. Persistência com PostgreSQL ou Replit Database real
2. Gráficos interativos com Recharts
3. Exportação de dados em Excel/CSV
4. Categorização automática com ML
5. Integração com Open Finance
