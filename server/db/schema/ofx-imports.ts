import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { organizations } from "./organizations";
import { clients } from "./clients";

export const ofxImports = pgTable(
  "ofx_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    clientId: uuid("client_id").notNull(),
    fileHash: text("file_hash").notNull(),
    fileName: text("file_name").notNull(),
    imported: integer("imported").notNull().default(0),
    deduped: integer("deduped").notNull().default(0),
    reconciliation: jsonb("reconciliation").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  table => [
    index("ofx_imports_org_client_idx").on(table.orgId, table.clientId),
    index("ofx_imports_file_hash_idx").on(table.fileHash),
    foreignKey({
      name: "ofx_imports_org_fk",
      columns: [table.orgId],
      foreignColumns: [organizations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "ofx_imports_client_fk",
      columns: [table.clientId],
      foreignColumns: [clients.id],
    }).onDelete("cascade"),
  ],
);
