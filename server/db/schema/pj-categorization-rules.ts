import {
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { organizations } from "./organizations";
import { clients } from "./clients";
import { pjClientCategories } from "./pj-client-categories";

export const pjCategorizationRules = pgTable(
  "pj_categorization_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    clientId: uuid("client_id").notNull(),
    categoryId: uuid("category_id").notNull(),
    pattern: text("pattern").notNull(),
    matchType: text("match_type").notNull(), // 'exact', 'contains', 'startsWith'
    priority: integer("priority").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    isLearned: boolean("is_learned").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  table => [
    index("pj_categorization_rules_org_client_idx").on(
      table.orgId,
      table.clientId,
    ),
    index("pj_categorization_rules_category_idx").on(table.categoryId),
    index("pj_categorization_rules_active_idx").on(table.isActive),
    foreignKey({
      name: "pj_categorization_rules_org_fk",
      columns: [table.orgId],
      foreignColumns: [organizations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pj_categorization_rules_client_fk",
      columns: [table.clientId],
      foreignColumns: [clients.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pj_categorization_rules_category_fk",
      columns: [table.categoryId],
      foreignColumns: [pjClientCategories.id],
    }).onDelete("cascade"),
  ],
);
