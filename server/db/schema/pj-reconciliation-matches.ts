import {
  boolean,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { organizations } from "./organizations";
import { clients } from "./clients";
import { pjTransactions } from "./pj-transactions";
import { pjSaleLegs } from "./pj-sale-legs";

export const pjReconciliationMatches = pgTable(
  "pj_reconciliation_matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    clientId: uuid("client_id").notNull(),
    txId: uuid("tx_id").notNull(),
    legId: uuid("leg_id").notNull(),
    matchType: text("match_type").notNull(), // 'automatic', 'manual'
    confirmed: boolean("confirmed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: "string" }),
  },
  table => [
    index("pj_reconciliation_matches_org_client_idx").on(
      table.orgId,
      table.clientId,
    ),
    index("pj_reconciliation_matches_tx_idx").on(table.txId),
    index("pj_reconciliation_matches_leg_idx").on(table.legId),
    foreignKey({
      name: "pj_reconciliation_matches_org_fk",
      columns: [table.orgId],
      foreignColumns: [organizations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pj_reconciliation_matches_client_fk",
      columns: [table.clientId],
      foreignColumns: [clients.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pj_reconciliation_matches_tx_fk",
      columns: [table.txId],
      foreignColumns: [pjTransactions.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pj_reconciliation_matches_leg_fk",
      columns: [table.legId],
      foreignColumns: [pjSaleLegs.id],
    }).onDelete("cascade"),
  ],
);
