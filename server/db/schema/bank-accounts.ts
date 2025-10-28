import {
  boolean,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const organizations = pgTable("organizations", {
  id: uuid("id").notNull(),
});

const clients = pgTable("clients", {
  id: uuid("id").notNull(),
  orgId: uuid("org_id").notNull(),
});

export const bankAccounts = pgTable(
  "bank_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    clientId: uuid("client_id").notNull(),
    provider: text("provider").notNull(),
    bankOrg: text("bank_org"),
    bankFid: text("bank_fid"),
    bankName: text("bank_name").notNull(),
    bankCode: text("bank_code"),
    branch: text("branch"),
    accountNumberMask: text("account_number_mask").notNull(),
    accountType: text("account_type").notNull(),
    currency: text("currency").notNull(),
    accountFingerprint: text("account_fingerprint").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  table => [
    uniqueIndex("bank_accounts_org_fingerprint_key").on(
      table.orgId,
      table.accountFingerprint,
    ),
    index("bank_accounts_org_client_active_idx").on(
      table.orgId,
      table.clientId,
      table.isActive,
    ),
    foreignKey({
      name: "bank_accounts_org_id_organizations_fk",
      columns: [table.orgId],
      foreignColumns: [organizations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "bank_accounts_client_id_clients_fk",
      columns: [table.clientId],
      foreignColumns: [clients.id],
    }).onDelete("cascade"),
  ],
);
