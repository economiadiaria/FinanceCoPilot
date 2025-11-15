import "dotenv/config";

import bcrypt from "bcrypt";
import { sql } from "drizzle-orm";

import { closeDb, initDb, type Database } from "../server/db/client";
import { 
  pjCategories, 
  users, 
  organizations, 
  clients,
  transactions,
  positions,
  pjSales,
  pjSaleLegs,
  pjTransactions,
  bankAccounts,
  bankAccountSummarySnapshots,
  openFinanceItems,
  policies,
  reports,
} from "../server/db/schema";

const BASE_CATEGORIES: Array<{
  code: string;
  name: string;
  description: string;
  sortOrder: number;
}> = [
  {
    code: "RECEITA",
    name: "Receitas",
    description: "Entradas operacionais de vendas e serviços.",
    sortOrder: 10,
  },
  {
    code: "DEDUCOES_RECEITA",
    name: "(-) Deduções da Receita",
    description: "Descontos, impostos e devoluções associados às receitas.",
    sortOrder: 20,
  },
  {
    code: "GEA",
    name: "(-) Despesas Gerais e Administrativas",
    description: "Custos operacionais administrativos.",
    sortOrder: 30,
  },
  {
    code: "COMERCIAL_MKT",
    name: "(-) Despesas Comerciais e Marketing",
    description: "Gastos comerciais e de marketing.",
    sortOrder: 40,
  },
  {
    code: "FINANCEIRAS",
    name: "(-/+) Despesas e Receitas Financeiras",
    description: "Receitas e despesas financeiras.",
    sortOrder: 50,
  },
  {
    code: "OUTRAS",
    name: "(-/+) Outras Despesas e Receitas Não Operacionais",
    description: "Eventos não operacionais.",
    sortOrder: 60,
  },
];

const MASTER_EMAIL = process.env.SEED_MASTER_EMAIL ?? "master@demo.finco";
const MASTER_PASSWORD = process.env.SEED_MASTER_PASSWORD ?? "master-demo";
const MASTER_USERNAME = process.env.SEED_MASTER_USERNAME ?? "master";
const ORG_NAME = process.env.SEED_ORG_NAME ?? "Organização Demo";
const CLIENT_NAME = process.env.SEED_CLIENT_NAME ?? "Cliente Demo PF";
const CLIENT_EMAIL = process.env.SEED_CLIENT_EMAIL ?? "cliente@demo.finco";

function log(message: string): void {
  console.log(`➡️  ${message}`);
}

async function seedGlobalCategories(db: Database): Promise<void> {
  log("Sincronizando plano de contas PJ global");
  const now = new Date().toISOString();

  const values = BASE_CATEGORIES.map(category => ({
    code: category.code,
    name: category.name,
    description: category.description,
    isCore: true,
    acceptsPostings: false,
    level: 1,
    path: category.code,
    sortOrder: category.sortOrder,
    createdAt: now,
    updatedAt: now,
  }));

  await db
    .insert(pjCategories)
    .values(values)
    .onConflictDoUpdate({
      target: pjCategories.code,
      set: {
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        isCore: sql`excluded.is_core`,
        acceptsPostings: sql`excluded.accepts_postings`,
        level: sql`excluded.level`,
        path: sql`excluded.path`,
        sortOrder: sql`excluded.sort_order`,
        updatedAt: sql`excluded.updated_at`,
      },
    });

  log(`Plano de contas sincronizado (${BASE_CATEGORIES.length} categorias núcleo).`);
}

async function seedSampleData(db: Database, orgId: string, clientId: string): Promise<void> {
  log("Populando dados de exemplo");

  const today = new Date();
  const oneMonthAgo = new Date(today);
  oneMonthAgo.setMonth(today.getMonth() - 1);

  await db.insert(transactions).values([
    {
      orgId,
      clientId,
      date: oneMonthAgo.toISOString().split('T')[0],
      desc: "Salário",
      amount: "5000.00",
      category: "Receita",
      status: "categorizada",
      provider: "ofx",
      providerTxId: "DEMO-TX-SAL-001",
      accountId: "DEMO-ACCOUNT-001",
      bankName: "Banco Exemplo",
      fitid: "FITID-SAL-001",
    },
    {
      orgId,
      clientId,
      date: new Date(oneMonthAgo.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      desc: "Supermercado XYZ",
      amount: "-350.50",
      category: "Custo Variável",
      status: "categorizada",
      provider: "ofx",
      providerTxId: "DEMO-TX-SUPER-001",
      accountId: "DEMO-ACCOUNT-001",
      bankName: "Banco Exemplo",
      fitid: "FITID-SUPER-001",
    },
    {
      orgId,
      clientId,
      date: new Date(oneMonthAgo.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      desc: "Aluguel Apartamento",
      amount: "-1200.00",
      category: "Custo Fixo",
      status: "categorizada",
      provider: "ofx",
      providerTxId: "DEMO-TX-RENT-001",
      accountId: "DEMO-ACCOUNT-001",
      bankName: "Banco Exemplo",
      fitid: "FITID-RENT-001",
    },
  ]).onConflictDoNothing();

  log("Transações de exemplo criadas");

  await db.insert(positions).values([
    {
      orgId,
      clientId,
      asset: "Tesouro Selic 2027",
      class: "RF",
      value: "10000.00",
      rate: "13.65",
      liquidity: "D+1",
      provider: "manual",
    },
    {
      orgId,
      clientId,
      asset: "PETR4",
      class: "RV",
      value: "5000.00",
      provider: "manual",
    },
  ]).onConflictDoNothing();

  log("Posições de investimento de exemplo criadas");

  const [sale] = await db.insert(pjSales).values({
    orgId,
    clientId,
    saleId: "SALE-001",
    saleDate: oneMonthAgo.toISOString().split('T')[0],
    customerName: "Cliente Exemplo LTDA",
    totalValue: "1500.00",
    numParcels: 3,
    settlementPlan: "D+30_por_parcela",
  }).onConflictDoNothing().returning();

  if (sale) {
    await db.insert(pjSaleLegs).values([
      {
        orgId,
        clientId,
        saleId: sale.id,
        parcelN: 1,
        expectedDate: new Date(oneMonthAgo.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        expectedValue: "500.00",
      },
      {
        orgId,
        clientId,
        saleId: sale.id,
        parcelN: 2,
        expectedDate: new Date(oneMonthAgo.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        expectedValue: "500.00",
      },
      {
        orgId,
        clientId,
        saleId: sale.id,
        parcelN: 3,
        expectedDate: new Date(oneMonthAgo.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        expectedValue: "500.00",
      },
    ]).onConflictDoNothing();

    log("Vendas e legs de exemplo criadas");
  }

  await db.insert(pjTransactions).values([
    {
      orgId,
      clientId,
      date: oneMonthAgo.toISOString().split('T')[0],
      desc: "Venda de Produto A",
      amount: "1000.00",
      fitid: "PJ-FITID-001",
      accountId: "DEMO-PJ-ACCOUNT-001",
      bankName: "Banco Empresarial",
    },
    {
      orgId,
      clientId,
      date: new Date(oneMonthAgo.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      desc: "Fornecedor XYZ",
      amount: "-450.00",
      fitid: "PJ-FITID-002",
      accountId: "DEMO-PJ-ACCOUNT-001",
      bankName: "Banco Empresarial",
    },
  ]).onConflictDoNothing();

  log("Transações PJ de exemplo criadas");

  const [bankAccount] = await db.insert(bankAccounts).values({
    orgId,
    clientId,
    provider: "manual",
    bankName: "Banco Exemplo",
    bankCode: "001",
    branch: "1234",
    accountNumberMask: "****5678",
    accountType: "Conta Corrente",
    currency: "BRL",
    accountFingerprint: `DEMO-BANK-${orgId}-001-1234-5678`,
    isActive: true,
  }).onConflictDoNothing().returning();

  if (bankAccount) {
    await db.insert(bankAccountSummarySnapshots).values({
      orgId,
      clientId,
      bankAccountId: bankAccount.id,
      window: "30d",
      totals: { inflows: 5000.0, outflows: 1550.5, balance: 3449.5 },
      kpis: { transactions: 3, avgTransactionValue: 1850.17 },
      refreshedAt: new Date().toISOString(),
    }).onConflictDoNothing();

    log("Conta bancária e snapshot de exemplo criados");
  }

  await db.insert(openFinanceItems).values({
    orgId,
    clientId,
    itemId: "demo-pluggy-item-001",
    connectorId: "pluggy-connector-001",
    institution: "Banco Simulado",
    isActive: true,
    lastSyncAt: new Date().toISOString(),
    metadata: {
      accountType: "CHECKING",
      balance: 3449.5,
      currency: "BRL",
    },
  }).onConflictDoNothing();

  log("Open Finance item de exemplo criado");

  await db.insert(policies).values({
    orgId,
    clientId,
    pfPolicy: {
      rv: 30,
      rf: 50,
      outros: 20,
    },
    pjPolicy: {
      minCash: 10,
      maxCash: 30,
    },
  }).onConflictDoNothing();

  log("Política de investimento de exemplo criada");

  const reportMonth = oneMonthAgo.toISOString().substring(0, 7);
  await db.insert(reports).values({
    orgId,
    clientId,
    month: reportMonth,
    revenue: "1000.00",
    costs: "450.00",
    profit: "550.00",
    margin: "55.00",
    ticketMedio: "1000.00",
    topCosts: [
      { category: "Fornecedor XYZ", amount: 450.0 },
    ],
    notes: "Relatório de demonstração do sistema",
  }).onConflictDoNothing();

  log("Relatório de exemplo criado");
}

async function seedDemoData(db: Database): Promise<void> {
  log("Criando dados de demonstração");
  
  const passwordHash = await bcrypt.hash(MASTER_PASSWORD, 10);
  
  const [user] = await db
    .insert(users)
    .values({
      username: MASTER_USERNAME,
      email: MASTER_EMAIL,
      passwordHash,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        passwordHash: sql`excluded.password_hash`,
        updatedAt: sql`excluded.updated_at`,
      },
    })
    .returning();

  log(`Usuário master criado/atualizado: ${user.email}`);

  let org = await db.query.organizations.findFirst({
    where: (orgs, { eq }) => eq(orgs.ownerId, user.id),
  });

  if (!org) {
    [org] = await db
      .insert(organizations)
      .values({
        name: ORG_NAME,
        ownerId: user.id,
      })
      .returning();
    log(`Organização criada: ${org.name}`);
  } else {
    log(`Organização já existe: ${org.name}`);
  }

  const [client] = await db
    .insert(clients)
    .values({
      orgId: org.id,
      name: CLIENT_NAME,
      type: "PF",
      email: CLIENT_EMAIL,
      masterId: user.id,
    })
    .onConflictDoUpdate({
      target: [clients.orgId, clients.email],
      set: {
        name: sql`excluded.name`,
        updatedAt: sql`excluded.updated_at`,
      },
    })
    .returning();

  log(`Cliente demo criado/atualizado: ${client.name}`);

  await seedSampleData(db, org.id, client.id);
}

async function main(): Promise<void> {
  const db = initDb({ driver: "pg" });

  try {
    await seedGlobalCategories(db);
    await seedDemoData(db);

    log("Seed concluído com sucesso.");
    log(`\n📧 Email: ${MASTER_EMAIL}`);
    log(`🔑 Senha: ${MASTER_PASSWORD}\n`);
  } catch (error) {
    console.error("❌ Erro ao executar seed:", error);
    process.exitCode = 1;
  } finally {
    await closeDb().catch(err => {
      console.error("Falha ao encerrar conexão com o banco", err);
    });
  }
}

main().catch(error => {
  console.error("❌ Erro inesperado:", error);
  process.exit(1);
});
