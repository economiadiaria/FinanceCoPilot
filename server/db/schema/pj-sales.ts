import {
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

export const pjSales = pgTable(
  "pj_sales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    clientId: uuid("client_id").notNull(),
    saleId: text("sale_id").notNull(),
    saleDate: date("sale_date").notNull(),
    customerName: text("customer_name").notNull(),
    totalValue: decimal("total_value", { precision: 15, scale: 2 }).notNull(),
    numParcels: integer("num_parcels").notNull().default(1),
    settlementPlan: text("settlement_plan").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  table => [
    uniqueIndex("pj_sales_org_client_sale_id_key").on(
      table.orgId,
      table.clientId,
      table.saleId,
    ),
    index("pj_sales_org_client_date_idx").on(
      table.orgId,
      table.clientId,
      table.saleDate,
    ),
    foreignKey({
      name: "pj_sales_org_fk",
      columns: [table.orgId],
      foreignColumns: [organizations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pj_sales_client_fk",
      columns: [table.clientId],
      foreignColumns: [clients.id],
    }).onDelete("cascade"),
  ],
);
