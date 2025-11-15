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

export const positions = pgTable(
  "positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    clientId: uuid("client_id").notNull(),
    asset: text("asset").notNull(),
    class: text("class").notNull(),
    value: decimal("value", { precision: 15, scale: 2 }).notNull(),
    rate: decimal("rate", { precision: 8, scale: 4 }),
    liquidity: text("liquidity"),
    maturity: date("maturity"),
    provider: text("provider").notNull().default("manual"),
    providerPosId: text("provider_pos_id"),
    providerAccountId: text("provider_account_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  table => [
    uniqueIndex("positions_org_client_provider_pos_key")
      .on(table.orgId, table.clientId, table.providerPosId)
      .where(sql`${table.providerPosId} IS NOT NULL`),
    uniqueIndex("positions_org_client_asset_provider_key").on(
      table.orgId,
      table.clientId,
      table.asset,
      table.provider,
    ),
    index("positions_org_client_idx").on(table.orgId, table.clientId),
    foreignKey({
      name: "positions_org_fk",
      columns: [table.orgId],
      foreignColumns: [organizations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "positions_client_fk",
      columns: [table.clientId],
      foreignColumns: [clients.id],
    }).onDelete("cascade"),
  ],
);
