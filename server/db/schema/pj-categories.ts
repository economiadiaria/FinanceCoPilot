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

export const pjCategories = pgTable(
  "pj_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    parentId: uuid("parent_id"),
    isCore: boolean("is_core").notNull().default(false),
    acceptsPostings: boolean("accepts_postings").notNull().default(true),
    level: integer("level").notNull(),
    path: text("path").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  table => [
    uniqueIndex("pj_categories_code_key").on(table.code),
    uniqueIndex("pj_categories_parent_name_key").on(table.parentId, table.name),
    index("pj_categories_parent_idx").on(table.parentId),
    index("pj_categories_level_idx").on(table.level),
    index("pj_categories_path_idx").on(table.path),
    foreignKey({
      name: "pj_categories_parent_fk",
      columns: [table.parentId],
      foreignColumns: [table.id],
    }).onDelete("set null"),
  ],
);
