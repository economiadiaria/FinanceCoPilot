import {
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { organizations } from "./organizations";
import { users } from "./users";

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(), // 'PF', 'PJ', or 'BOTH'
    email: text("email").notNull(),
    consultantId: uuid("consultant_id"),
    masterId: uuid("master_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  table => [
    uniqueIndex("clients_org_email_key").on(table.orgId, table.email),
    index("clients_org_idx").on(table.orgId),
    index("clients_consultant_idx").on(table.consultantId),
    index("clients_master_idx").on(table.masterId),
    foreignKey({
      name: "clients_org_fk",
      columns: [table.orgId],
      foreignColumns: [organizations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "clients_consultant_fk",
      columns: [table.consultantId],
      foreignColumns: [users.id],
    }).onDelete("set null"),
    foreignKey({
      name: "clients_master_fk",
      columns: [table.masterId],
      foreignColumns: [users.id],
    }).onDelete("set null"),
  ],
);
