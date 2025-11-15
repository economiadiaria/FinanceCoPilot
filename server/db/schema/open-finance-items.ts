import {
  boolean,
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

export const openFinanceItems = pgTable(
  "open_finance_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    clientId: uuid("client_id").notNull(),
    itemId: text("item_id").notNull(),
    connectorId: text("connector_id"),
    institution: text("institution").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true, mode: "string" }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  table => [
    uniqueIndex("open_finance_items_org_client_item_key").on(
      table.orgId,
      table.clientId,
      table.itemId,
    ),
    index("open_finance_items_org_client_idx").on(table.orgId, table.clientId),
    foreignKey({
      name: "open_finance_items_org_fk",
      columns: [table.orgId],
      foreignColumns: [organizations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "open_finance_items_client_fk",
      columns: [table.clientId],
      foreignColumns: [clients.id],
    }).onDelete("cascade"),
  ],
);
