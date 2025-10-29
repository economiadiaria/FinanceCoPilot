import {
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { pjCategories } from "./pj-categories";

const organizations = pgTable("organizations", {
  id: uuid("id").notNull(),
});

const clients = pgTable("clients", {
  id: uuid("id").notNull(),
  orgId: uuid("org_id").notNull(),
});

export const pjClientCategories = pgTable(
  "pj_client_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    clientId: uuid("client_id").notNull(),
    baseCategoryId: uuid("base_category_id"),
    name: text("name").notNull(),
    description: text("description"),
    parentId: uuid("parent_id"),
    level: integer("level").notNull().default(0),
    path: text("path").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    acceptsPostings: boolean("accepts_postings").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  table => [
    uniqueIndex("pj_client_categories_org_client_path_key").on(
      table.orgId,
      table.clientId,
      table.path,
    ),
    index("pj_client_categories_org_client_idx").on(table.orgId, table.clientId),
    index("pj_client_categories_parent_idx").on(table.parentId),
    index("pj_client_categories_base_idx").on(table.baseCategoryId),
    foreignKey({
      name: "pj_client_categories_parent_fk",
      columns: [table.parentId],
      foreignColumns: [table.id],
    }).onDelete("set null"),
    foreignKey({
      name: "pj_client_categories_base_fk",
      columns: [table.baseCategoryId],
      foreignColumns: [pjCategories.id],
    }).onDelete("set null"),
    foreignKey({
      name: "pj_client_categories_org_fk",
      columns: [table.orgId],
      foreignColumns: [organizations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pj_client_categories_client_fk",
      columns: [table.clientId],
      foreignColumns: [clients.id],
    }).onDelete("cascade"),
  ],
);
