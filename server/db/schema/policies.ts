import {
  foreignKey,
  index,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { organizations } from "./organizations";
import { clients } from "./clients";

export const policies = pgTable(
  "policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    clientId: uuid("client_id").notNull(),
    pfPolicy: jsonb("pf_policy").$type<Record<string, unknown>>(),
    pjPolicy: jsonb("pj_policy").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  table => [
    uniqueIndex("policies_org_client_key").on(table.orgId, table.clientId),
    index("policies_org_client_idx").on(table.orgId, table.clientId),
    foreignKey({
      name: "policies_org_fk",
      columns: [table.orgId],
      foreignColumns: [organizations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "policies_client_fk",
      columns: [table.clientId],
      foreignColumns: [clients.id],
    }).onDelete("cascade"),
  ],
);
