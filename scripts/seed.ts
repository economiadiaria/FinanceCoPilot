import { sql } from "drizzle-orm";

import { closeDb, initDb } from "../server/db/client";
import { pjCategories } from "../server/db/schema";

type BaseCategorySeed = {
  id: string;
  code: string;
  name: string;
  description: string;
  sortOrder: number;
};

const baseCategorySeeds: BaseCategorySeed[] = [
  {
    id: "seed-pj-category-receita",
    code: "RECEITA",
    name: "Receitas",
    description: "Entradas operacionais de vendas e serviços.",
    sortOrder: 10,
  },
  {
    id: "seed-pj-category-deducoes-receita",
    code: "DEDUCOES_RECEITA",
    name: "(-) Deduções da Receita",
    description: "Descontos, impostos e devoluções associados às receitas.",
    sortOrder: 20,
  },
  {
    id: "seed-pj-category-gea",
    code: "GEA",
    name: "(-) Despesas Gerais e Administrativas",
    description: "Custos operacionais administrativos.",
    sortOrder: 30,
  },
  {
    id: "seed-pj-category-comercial-mkt",
    code: "COMERCIAL_MKT",
    name: "(-) Despesas Comerciais e Marketing",
    description: "Gastos comerciais e de marketing.",
    sortOrder: 40,
  },
  {
    id: "seed-pj-category-financeiras",
    code: "FINANCEIRAS",
    name: "(-/+) Despesas e Receitas Financeiras",
    description: "Receitas e despesas financeiras.",
    sortOrder: 50,
  },
  {
    id: "seed-pj-category-outras",
    code: "OUTRAS",
    name: "(-/+) Outras Despesas e Receitas Não Operacionais",
    description: "Eventos não operacionais.",
    sortOrder: 60,
  },
];

async function seedBaseCategories() {
  const db = initDb();
  const timestamp = new Date().toISOString();

  const values = baseCategorySeeds.map(seed => ({
    id: seed.id,
    code: seed.code,
    name: seed.name,
    description: seed.description,
    parentId: null,
    isCore: true,
    acceptsPostings: false,
    level: 1,
    path: seed.code,
    sortOrder: seed.sortOrder,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));

  await db.transaction(async trx => {
    await trx
      .insert(pjCategories)
      .values(values)
      .onConflictDoUpdate({
        target: pjCategories.code,
        set: {
          id: sql`excluded.id`,
          name: sql`excluded.name`,
          description: sql`excluded.description`,
          parentId: sql`excluded.parent_id`,
          isCore: sql`excluded.is_core`,
          acceptsPostings: sql`excluded.accepts_postings`,
          level: sql`excluded.level`,
          path: sql`excluded.path`,
          sortOrder: sql`excluded.sort_order`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  });

  console.log(`Seeded ${baseCategorySeeds.length} PJ base categories.`);
}

async function main() {
  try {
    await seedBaseCategories();
  } catch (error) {
    console.error("Failed to run seed script.");
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  } finally {
    await closeDb().catch(closeError => {
      console.error("Failed to close database connection after seeding.");
      console.error(closeError instanceof Error ? closeError.stack ?? closeError.message : closeError);
    });
  }
}

main();
