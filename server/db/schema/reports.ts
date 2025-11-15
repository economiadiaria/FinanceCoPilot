import {
  decimal,
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

import { organizations } from "./organizations";
import { clients } from "./clients";

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    clientId: uuid("client_id").notNull(),
    month: text("month").notNull(), // YYYY-MM format
    revenue: decimal("revenue", { precision: 15, scale: 2 }).notNull(),
    costs: decimal("costs", { precision: 15, scale: 2 }).notNull(),
    profit: decimal("profit", { precision: 15, scale: 2 }).notNull(),
    margin: decimal("margin", { precision: 8, scale: 4 }).notNull(),
    ticketMedio: decimal("ticket_medio", { precision: 15, scale: 2 }),
    topCosts: jsonb("top_costs").$type<Array<{ category: string; amount: number }>>(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  table => [
    uniqueIndex("reports_org_client_month_key").on(
      table.orgId,
      table.clientId,
      table.month,
    ),
    index("reports_org_client_idx").on(table.orgId, table.clientId),
    foreignKey({
      name: "reports_org_fk",
      columns: [table.orgId],
      foreignColumns: [organizations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "reports_client_fk",
      columns: [table.clientId],
      foreignColumns: [clients.id],
    }).onDelete("cascade"),
  ],
);
