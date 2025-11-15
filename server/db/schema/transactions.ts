import {
  decimal,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  date,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { organizations } from "./organizations";
import { clients } from "./clients";

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    clientId: uuid("client_id").notNull(),
    date: date("date").notNull(),
    desc: text("desc").notNull(),
    amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
    category: text("category"),
    subcategory: text("subcategory"),
    status: text("status").notNull().default("pendente"),
    fitid: text("fitid"),
    accountId: text("account_id"),
    bankName: text("bank_name"),
    provider: text("provider"),
    providerTxId: text("provider_tx_id"),
    providerAccountId: text("provider_account_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  table => [
    uniqueIndex("transactions_org_client_provider_tx_key").on(
      table.orgId,
      table.clientId,
      table.providerTxId,
    ),
    uniqueIndex("transactions_org_client_fitid_key")
      .on(table.orgId, table.clientId, table.fitid)
      .where(sql`${table.fitid} IS NOT NULL`),
    index("transactions_org_client_date_idx").on(
      table.orgId,
      table.clientId,
      table.date,
    ),
    index("transactions_fitid_idx").on(table.fitid),
    index("transactions_provider_tx_id_idx").on(table.providerTxId),
    index("transactions_status_idx").on(table.status),
    index("transactions_category_idx").on(table.category),
    foreignKey({
      name: "transactions_org_fk",
      columns: [table.orgId],
      foreignColumns: [organizations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "transactions_client_fk",
      columns: [table.clientId],
      foreignColumns: [clients.id],
    }).onDelete("cascade"),
  ],
);
