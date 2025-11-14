import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const appStorage = pgTable("app_storage", {
  key: text("key").primaryKey(),
  value: jsonb("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});
