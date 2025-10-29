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
    parentId: uuid("parent_id"),
    level: integer("level").notNull().default(0),
    path: text("path").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  table => [
    uniqueIndex("pj_categories_code_key").on(table.code),
    uniqueIndex("pj_categories_path_key").on(table.path),
    index("pj_categories_parent_idx").on(table.parentId),
    index("pj_categories_level_idx").on(table.level),
    foreignKey({
      name: "pj_categories_parent_fk",
      columns: [table.parentId],
      foreignColumns: [table.id],
    }).onDelete("set null"),
  ],
);
