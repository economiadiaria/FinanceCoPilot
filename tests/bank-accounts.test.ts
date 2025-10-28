import test from "node:test";
import assert from "node:assert/strict";

import { MemStorage } from "../server/storage";
import type { BankAccount } from "@shared/schema";

function createBankAccount(overrides: Partial<BankAccount> = {}): BankAccount {
  const timestamp = new Date().toISOString();
  return {
    id: "bank-account-default",
    orgId: "org-1",
    clientId: "client-1",
    provider: "manual",
    bankOrg: "Test Bank",
    bankFid: null,
    bankName: "Banco Teste",
    bankCode: "001",
    branch: "0001",
    accountNumberMask: "***1234",
    accountType: "checking",
    currency: "BRL",
    accountFingerprint: "fingerprint-123",
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

test("upsertBankAccount collapses duplicates by fingerprint", async () => {
  const storage = new MemStorage();
  const createdAt = "2024-01-01T00:00:00.000Z";

  const original = createBankAccount({
    id: "bank-account-1",
    createdAt,
    updatedAt: createdAt,
  });

  await storage.upsertBankAccount(original);

  const updatedAt = "2024-02-01T00:00:00.000Z";
  const updated = createBankAccount({
    id: "bank-account-1",
    bankName: "Banco Atualizado",
    accountFingerprint: original.accountFingerprint,
    createdAt,
    updatedAt,
  });

  const merged = await storage.upsertBankAccount(updated);
  assert.equal(merged.bankName, "Banco Atualizado");
  assert.equal(merged.createdAt, createdAt);
  assert.equal(merged.updatedAt, updatedAt);

  const accounts = await storage.getBankAccounts(original.orgId, original.clientId);
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].accountFingerprint, original.accountFingerprint);
  assert.equal(accounts[0].bankName, "Banco Atualizado");
});

test("identical fingerprints can exist across organizations", async () => {
  const storage = new MemStorage();
  const base = createBankAccount({
    id: "bank-account-cross-1",
    accountFingerprint: "shared-fingerprint",
    createdAt: "2024-03-01T00:00:00.000Z",
    updatedAt: "2024-03-01T00:00:00.000Z",
  });

  await storage.upsertBankAccount(base);

  const otherOrgAccount = createBankAccount({
    id: "bank-account-cross-2",
    orgId: "org-2",
    clientId: "client-2",
    accountFingerprint: "shared-fingerprint",
    bankName: "Banco Segundo",
    createdAt: "2024-03-02T00:00:00.000Z",
    updatedAt: "2024-03-02T00:00:00.000Z",
  });

  await storage.upsertBankAccount(otherOrgAccount);

  const orgOneAccounts = await storage.getBankAccounts("org-1");
  assert.equal(orgOneAccounts.length, 1);
  assert.equal(orgOneAccounts[0].bankName, base.bankName);

  const orgTwoAccounts = await storage.getBankAccounts("org-2");
  assert.equal(orgTwoAccounts.length, 1);
  assert.equal(orgTwoAccounts[0].bankName, "Banco Segundo");
  assert.equal(orgTwoAccounts[0].accountFingerprint, "shared-fingerprint");
});
