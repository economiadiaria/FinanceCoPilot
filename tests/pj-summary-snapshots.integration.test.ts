import { describe, before, after, beforeEach, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import request from "supertest";
import bcrypt from "bcrypt";

import { registerRoutes } from "../server/routes";
import { setStorageProvider, MemStorage } from "../server/storage";
import type {
  BankAccount,
  BankSummarySnapshot,
  Client,
  PjClientCategory,
  User,
} from "@shared/schema";

const ORG_ID = "snapshot-org";
const CLIENT_ID = "snapshot-client";
const BANK_ACCOUNT_ID = "snapshot-bank-account";
const MASTER_EMAIL = "snapshot-master@pj.example.com";
const MASTER_PASSWORD = "snapshot-password";
const SNAPSHOT_REFRESHED_AT = "2024-03-01T12:00:00.000Z";

class SnapshotOnlyStorage extends MemStorage {
  override async getBankTransactions(): Promise<any> {
    throw new Error("getBankTransactions should not be called when snapshot exists");
  }
}

async function seedSnapshotStorage(storage: SnapshotOnlyStorage) {
  const master: User = {
    userId: "snapshot-master-id",
    email: MASTER_EMAIL,
    passwordHash: await bcrypt.hash(MASTER_PASSWORD, 10),
    role: "master",
    name: "Snapshot Master",
    organizationId: ORG_ID,
    clientIds: [CLIENT_ID],
    managedConsultantIds: [],
    managedClientIds: [CLIENT_ID],
  };

  const client: Client = {
    clientId: CLIENT_ID,
    name: "Snapshot Client",
    type: "PJ",
    email: "snapshot-client@pj.example.com",
    organizationId: ORG_ID,
    consultantId: null,
    masterId: master.userId,
  };

  const bankAccount: BankAccount = {
    id: BANK_ACCOUNT_ID,
    orgId: ORG_ID,
    clientId: CLIENT_ID,
    provider: "manual",
    bankOrg: null,
    bankFid: null,
    bankName: "Banco Snapshot",
    bankCode: null,
    branch: "0001",
    accountNumberMask: "***9999",
    accountType: "corrente",
    currency: "BRL",
    accountFingerprint: "snapshot-fingerprint",
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const snapshot: BankSummarySnapshot = {
    organizationId: ORG_ID,
    clientId: CLIENT_ID,
    bankAccountId: BANK_ACCOUNT_ID,
    window: "30d",
    totals: {
      totalIn: 5000,
      totalOut: 1200,
      balance: 3800,
    },
    kpis: {
      inflowCount: 10,
      outflowCount: 5,
      averageTicketIn: 500,
      averageTicketOut: 240,
      largestIn: 2000,
      largestOut: 600,
      averageDailyNetFlow: 190,
      cashConversionRatio: 0.76,
      receivableAmount: 900,
      receivableCount: 3,
      overdueReceivableAmount: 400,
      overdueReceivableCount: 1,
      projectedBalance: 4700,
    },
    refreshedAt: SNAPSHOT_REFRESHED_AT,
    metadata: {
      transactionCount: 15,
      coverageDays: 30,
      from: "2024-01-01",
      to: "2024-01-30",
      series: {
        dailyNetFlows: [
          { date: "2024-01-01", net: 100 },
          { date: "2024-01-02", net: 200 },
        ],
      },
    },
  };

  await storage.createUser(master);
  await storage.upsertClient(client);
  await storage.upsertBankAccount(bankAccount);
  await storage.setBankSummarySnapshots(ORG_ID, CLIENT_ID, BANK_ACCOUNT_ID, [snapshot]);

  const baseCategories = await storage.getPjCategories();
  const timestamp = new Date().toISOString();
  const categorySeeds: PjClientCategory[] = baseCategories.map(category => ({
    id: `${CLIENT_ID}-${category.code}`,
    orgId: ORG_ID,
    clientId: CLIENT_ID,
    name: category.name,
    description: category.description,
    parentId: null,
    baseCategoryId: category.id,
    acceptsPostings: category.acceptsPostings,
    level: category.level,
    path: category.path,
    sortOrder: category.sortOrder,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));

  await storage.bulkInsertPjClientCategories(ORG_ID, CLIENT_ID, categorySeeds);
}

describe("PJ summary with snapshots", () => {
  let appServer: import("http").Server;
  let storage: SnapshotOnlyStorage;

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    app.use(
      session({
        secret: "snapshot-secret",
        resave: false,
        saveUninitialized: false,
      })
    );

    storage = new SnapshotOnlyStorage();
    setStorageProvider(storage);
    await seedSnapshotStorage(storage);

    appServer = await registerRoutes(app);
  });

  after(async () => {
    if (appServer?.listening) {
      await new Promise<void>((resolve, reject) => {
        appServer.close(err => (err ? reject(err) : resolve()));
      });
    }
  });

  beforeEach(async () => {
    storage = new SnapshotOnlyStorage();
    setStorageProvider(storage);
    await seedSnapshotStorage(storage);
  });

  it("returns precomputed snapshot data without loading transactions", async () => {
    const agent = request.agent(appServer);
    await agent
      .post("/api/auth/login")
      .send({ email: MASTER_EMAIL, password: MASTER_PASSWORD })
      .expect(200);

    const response = await agent
      .get("/api/pj/summary")
      .query({
        clientId: CLIENT_ID,
        bankAccountId: BANK_ACCOUNT_ID,
        from: "01/01/2024",
        to: "30/01/2024",
      })
      .expect(200);

    const body = response.body;
    assert.equal(body.clientId, CLIENT_ID);
    assert.equal(body.bankAccountId, BANK_ACCOUNT_ID);
    assert.equal(body.from, "01/01/2024");
    assert.equal(body.to, "30/01/2024");
    assert.equal(body.metadata.dataSource, "snapshot");
    assert.equal(body.metadata.transactionCount, 15);
    assert.equal(body.metadata.coverageDays, 30);
    assert.equal(body.metadata.snapshotWindow, "30d");
    assert.equal(body.metadata.snapshotWindowDays, 30);
    assert.equal(body.metadata.generatedAt, SNAPSHOT_REFRESHED_AT);

    assert.deepEqual(body.totals, {
      totalIn: 5000,
      totalOut: 1200,
      balance: 3800,
    });

    assert.deepEqual(body.kpis, {
      inflowCount: 10,
      outflowCount: 5,
      averageTicketIn: 500,
      averageTicketOut: 240,
      largestIn: 2000,
      largestOut: 600,
      averageDailyNetFlow: 190,
      cashConversionRatio: 0.76,
      receivableAmount: 900,
      receivableCount: 3,
      overdueReceivableAmount: 400,
      overdueReceivableCount: 1,
      projectedBalance: 4700,
    });

    assert.deepEqual(body.series.dailyNetFlows, [
      { date: "01/01/2024", net: 100 },
      { date: "02/01/2024", net: 200 },
    ]);
  });
});

