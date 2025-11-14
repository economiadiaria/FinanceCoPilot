import "dotenv/config";

import bcrypt from "bcrypt";
import { sql } from "drizzle-orm";

import { closeDb, initDb, type Database } from "../server/db/client";
import { pjCategories } from "../server/db/schema";
import { PostgresStorage } from "../server/storage";

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

const DEFAULT_ORG_ID = process.env.SEED_ORG_ID ?? "org-demo";
const MASTER_USER_ID = process.env.SEED_MASTER_USER_ID ?? "user-master-demo";
const MASTER_EMAIL = process.env.SEED_MASTER_EMAIL ?? "master@demo.finco";
const MASTER_PASSWORD = process.env.SEED_MASTER_PASSWORD ?? "master-demo";
const MASTER_NAME = process.env.SEED_MASTER_NAME ?? "Master Demo";

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

async function seedMasterUser(storage: PostgresStorage): Promise<void> {
  log("Garantindo usuário master padrão");
  const existing = await storage.getUserById(MASTER_USER_ID);
  if (existing) {
    log(`Usuário master ${MASTER_USER_ID} já existente, mantendo registro.`);
    return;
  }

  const passwordHash = await bcrypt.hash(MASTER_PASSWORD, 10);

  await storage.createUser({
    userId: MASTER_USER_ID,
    email: MASTER_EMAIL,
    passwordHash,
    role: "master",
    name: MASTER_NAME,
    organizationId: DEFAULT_ORG_ID,
    clientIds: [],
    managedConsultantIds: [],
    managedClientIds: [],
  });

  log(`Usuário master ${MASTER_EMAIL} criado com sucesso.`);
  log(`Organização padrão utilizada: ${DEFAULT_ORG_ID}`);
}

async function main(): Promise<void> {
  const db = initDb();
  const storage = new PostgresStorage(db);

  try {
    await seedGlobalCategories(db);
    await seedMasterUser(storage);

    log("Seed concluído com sucesso.");
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
