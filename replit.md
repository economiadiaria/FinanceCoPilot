# Copiloto Financeiro da Economia Diária

## Visão Geral
SaaS de consultoria financeira para Pessoa Física (PF) e Pessoa Jurídica (PJ) desenvolvido com Node.js, Express e React. Sistema completo de gestão financeira com fluxo de caixa, categorização de transações, módulo de investimentos e geração de relatórios.

## Arquitetura

### Stack Tecnológico
- **Backend**: Node.js + Express
- **Frontend**: React + TypeScript + Vite
- **Database**: Replit Database (@replit/database) com fallback para MemStorage
- **Autenticação**: express-session + bcrypt com SESSION_SECRET
- **UI**: Shadcn UI + Tailwind CSS
- **State Management**: TanStack Query (React Query)
- **Routing**: Wouter
- **Parsing**: OFX-js (OFX bancário)
- **Segurança**: SHA256 hash para deduplicação de arquivos OFX

### Estrutura de Dados

#### Users
```typescript
{
  "userId": string, // gerado automaticamente
  "email": string, // único
  "passwordHash": string, // bcrypt hash
  "name": string,
  "role": "admin" | "user",
  "clients": string[] // IDs dos clientes associados ao usuário
}
```

#### Clients
```typescript
{
  "clientId": string,
  "name": string,
  "type": "PF" | "PJ" | "BOTH",
  "email": string
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

#### OFX Imports (Deduplicação)
```typescript
{
  "fileHash": string, // SHA256 hash do arquivo OFX
  "clientId": string,
  "importedAt": string, // ISO timestamp
  "transactionsCount": number
}
```

## API Endpoints

### Autenticação
Sistema baseado em sessões (express-session). Endpoints /api/auth/* são públicos, demais rotas requerem autenticação.

#### Endpoints de Autenticação
1. **POST /api/auth/register** - Registrar novo usuário
   - Body: `{ email, password, name, role? }`
   - Retorna: `{ user: { userId, email, name, role, clients } }`

2. **POST /api/auth/login** - Login de usuário
   - Body: `{ email, password }`
   - Retorna: `{ user: { userId, email, name, role, clients } }`

3. **POST /api/auth/logout** - Logout (destrói sessão)
   - Retorna: `{ success: true }`

4. **GET /api/auth/me** - Obter usuário atual
   - Retorna: `{ user: { userId, email, name, role, clients } }` ou 401

### Endpoints Implementados (Protegidos)

1. **POST /api/client/upsert** - Criar/atualizar cliente
   - Body: `{ clientId, name, type, email }`

2. **POST /api/import/ofx** - Importar transações via arquivo OFX bancário
   - Form Data: `{ clientId, ofx: File }`
   - Gera SHA256 hash do arquivo para prevenir duplicação
   - Faz parsing do OFX, extrai transações e remove duplicatas via FITID
   - Armazena hash mesmo se nenhuma transação nova for encontrada
   - Retorna: `{ success, imported, total, message }`
   - Erro 400 se arquivo já foi importado anteriormente

3. **GET /api/transactions/list** - Listar transações
   - Query: `?clientId=...&status=...&from=...&to=...&category=...`
   - Retorna: `{ transactions: [], summary: { totalIn, totalOut, count } }`

4. **POST /api/transactions/categorize** - Categorizar transações em lote
   - Body: `{ clientId, indices: number[], category, subcategory? }`

5. **GET /api/summary** - Obter resumo e KPIs
   - Query: `?clientId=...&period=AAAA-MM`
   - Retorna: totalIn, totalOut, balance, revenue, costs, profit, margin, ticketMedio, topCosts, insights

6. **GET /api/investments/positions** - Listar posições de investimento
   - Query: `?clientId=...`

7. **POST /api/investments/rebalance/suggest** - Sugestões de rebalanceamento
   - Body: `{ clientId }`
   - PF: compara alocação atual vs targets
   - PJ: valida cashPolicy (minRF, maxRV, maxIssuerPct, maxDurationDays)

8. **POST /api/reports/generate** - Gerar relatório mensal
   - Body: `{ clientId, period: "AAAA-MM", notes? }`
   - Retorna HTML para impressão/visualização

9. **GET /api/reports/view** - Visualizar relatório
    - Query: `?clientId=...&period=AAAA-MM`
    - Retorna HTML salvo ou gera on-the-fly

10. **POST /api/policies/upsert** - Atualizar políticas
    - Body: `{ clientId, data }` (PF.targets ou PJ.cashPolicy)

11. **GET /api/docs** - Documentação completa da API
    - Retorna HTML com documentação de todos os endpoints e exemplos de uso

## Funcionalidades Frontend

### Páginas Principais

1. **Dashboard** (`/`)
   - KPIs: Receita Total, Lucro, Margem
   - Insights inteligentes
   - Transações recentes (últimas 10)
   - Ações rápidas

2. **Transações** (`/transacoes`)
   - Upload de OFX (arquivo bancário)
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
✅ Schemas definidos (User, Client, Transaction, Position, Policy, OFXImport)
✅ Frontend completo com todas as páginas
✅ Componentes UI implementados
✅ Theme dark/light funcional
✅ Sistema de navegação com sidebar
✅ Integração React Query configurada
✅ Backend com 15 endpoints implementados (auth + features + /api/docs)
✅ **Replit Database** como storage principal com persistência real ⭐
✅ **Autenticação session-based** com bcrypt + express-session ⭐
✅ **SHA256 hash deduplication** para uploads OFX ⭐
✅ Middleware de autenticação protegendo todas as rotas API
✅ Parsing **OFX bancário** com deduplicação dupla (FITID + SHA256)
✅ Session ID regeneration para prevenir fixation attacks
✅ Cálculo de KPIs
✅ Heurísticas inteligentes
✅ Integração frontend ↔ backend completa
✅ Documentação completa da API em /api/docs
✅ Mensagem de inicialização no console
🎉 **Backend production-ready! Falta apenas frontend de autenticação.**

## Como Testar

### 1. Criar Cliente
1. Clique em "Selecione um cliente..." no topo
2. Clique em "Novo cliente"
3. Preencha:
   - ID: `empresa_demo_pj`
   - Nome: `Empresa Demo`
   - Tipo: `Pessoa Jurídica`
   - Email: `contato@empresademo.com`
4. Clique em "Criar Cliente"

### 2. Importar Transações
**Via OFX (arquivo bancário):**
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

## Segurança Implementada

### Proteção de Dados
- **Passwords**: Hashing bcrypt com salt automático (10 rounds)
- **Sessions**: express-session com SESSION_SECRET do ambiente
- **Session Fixation**: Regeneração de ID em login/registro
- **File Uploads**: SHA256 hash para prevenir reimportação

### Validações
- Email único na criação de usuários
- Senhas com mínimo de 6 caracteres
- Validação de tipos via Zod schemas
- Optional chaining em todos os getters do ReplitDbStorage

### Práticas de Segurança
- Senhas nunca retornadas nas respostas da API
- Middleware de autenticação em todas as rotas não-públicas
- Verificação de propriedade de recursos (clientId x user.clients)
- Error handling robusto com mensagens em português

## Próximas Melhorias (Pendentes)
1. ✅ ~~Persistência com Replit Database~~ (CONCLUÍDO)
2. ✅ ~~Sistema de autenticação~~ (CONCLUÍDO)
3. ✅ ~~Deduplicação de uploads OFX~~ (CONCLUÍDO)
4. 🔄 Frontend de login/registro (EM ANDAMENTO)
5. 🔄 Proteção de rotas no frontend
6. 🔄 Filtros de período (Dashboard e Transações)
7. 🔄 Edição inline de transações
8. 🔄 Formato DD/MM/YYYY para datas
9. Gráficos interativos com Recharts
10. Exportação de dados em Excel/CSV
11. Categorização automática com ML
12. Integração com Open Finance
