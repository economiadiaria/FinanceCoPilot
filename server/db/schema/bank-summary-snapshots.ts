import {
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { bankAccounts } from "./bank-accounts";

const organizations = pgTable("organizations", {
  id: uuid("id").notNull(),
});

const clients = pgTable("clients", {
  id: uuid("id").notNull(),
  orgId: uuid("org_id").notNull(),
});

export const bankAccountSummarySnapshots = pgTable(
  "bank_account_summary_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    clientId: uuid("client_id").notNull(),
    bankAccountId: uuid("bank_account_id").notNull(),
    window: text("window").notNull(),
    totals: jsonb("totals").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    kpis: jsonb("kpis").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  table => [
    uniqueIndex("bank_account_summary_snapshots_unique_window").on(
      table.orgId,
      table.clientId,
      table.bankAccountId,
      table.window,
    ),
    index("bank_account_summary_snapshots_org_client_idx").on(
      table.orgId,
      table.clientId,
    ),
    foreignKey({
      name: "bank_account_summary_snapshots_org_fk",
      columns: [table.orgId],
      foreignColumns: [organizations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "bank_account_summary_snapshots_client_fk",
      columns: [table.clientId],
      foreignColumns: [clients.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "bank_account_summary_snapshots_account_fk",
      columns: [table.bankAccountId],
      foreignColumns: [bankAccounts.id],
    }).onDelete("cascade"),
  ],
);
