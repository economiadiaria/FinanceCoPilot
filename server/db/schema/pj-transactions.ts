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
import { pjClientCategories } from "./pj-client-categories";

export const pjTransactions = pgTable(
  "pj_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    clientId: uuid("client_id").notNull(),
    date: date("date").notNull(),
    desc: text("desc").notNull(),
    amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
    categoryId: uuid("category_id"),
    fitid: text("fitid"),
    accountId: text("account_id"),
    bankName: text("bank_name"),
    fileHash: text("file_hash"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  table => [
    uniqueIndex("pj_transactions_org_client_fitid_key")
      .on(table.orgId, table.clientId, table.fitid)
      .where(sql`${table.fitid} IS NOT NULL`),
    index("pj_transactions_org_client_date_idx").on(
      table.orgId,
      table.clientId,
      table.date,
    ),
    index("pj_transactions_category_idx").on(table.categoryId),
    index("pj_transactions_fitid_idx").on(table.fitid),
    index("pj_transactions_file_hash_idx").on(table.fileHash),
    foreignKey({
      name: "pj_transactions_org_fk",
      columns: [table.orgId],
      foreignColumns: [organizations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pj_transactions_client_fk",
      columns: [table.clientId],
      foreignColumns: [clients.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pj_transactions_category_fk",
      columns: [table.categoryId],
      foreignColumns: [pjClientCategories.id],
    }).onDelete("set null"),
  ],
);
