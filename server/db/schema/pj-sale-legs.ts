import {
  boolean,
  decimal,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  date,
} from "drizzle-orm/pg-core";

import { organizations } from "./organizations";
import { clients } from "./clients";
import { pjSales } from "./pj-sales";
import { pjTransactions } from "./pj-transactions";

export const pjSaleLegs = pgTable(
  "pj_sale_legs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    clientId: uuid("client_id").notNull(),
    saleId: uuid("sale_id").notNull(),
    parcelN: integer("parcel_n").notNull(),
    expectedDate: date("expected_date").notNull(),
    expectedValue: decimal("expected_value", { precision: 15, scale: 2 }).notNull(),
    settled: boolean("settled").notNull().default(false),
    settledDate: date("settled_date"),
    settledValue: decimal("settled_value", { precision: 15, scale: 2 }),
    matchedTxId: uuid("matched_tx_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  table => [
    uniqueIndex("pj_sale_legs_sale_parcel_key").on(table.saleId, table.parcelN),
    index("pj_sale_legs_org_client_idx").on(table.orgId, table.clientId),
    index("pj_sale_legs_expected_date_idx").on(table.expectedDate),
    index("pj_sale_legs_settled_idx").on(table.settled),
    index("pj_sale_legs_matched_tx_idx").on(table.matchedTxId),
    foreignKey({
      name: "pj_sale_legs_org_fk",
      columns: [table.orgId],
      foreignColumns: [organizations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pj_sale_legs_client_fk",
      columns: [table.clientId],
      foreignColumns: [clients.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pj_sale_legs_sale_fk",
      columns: [table.saleId],
      foreignColumns: [pjSales.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pj_sale_legs_matched_tx_fk",
      columns: [table.matchedTxId],
      foreignColumns: [pjTransactions.id],
    }).onDelete("set null"),
  ],
);
