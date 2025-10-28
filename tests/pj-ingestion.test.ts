import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCategorizationRules,
  calculateSettlementPlan,
  extractPattern,
  isDuplicateTransaction,
  matchesPattern,
  normalizeOfxAmount,
} from "../server/pj-ingestion-helpers";
import type {
  BankTransaction,
  CategorizationRule,
  PaymentMethod,
} from "@shared/schema";

test("calculateSettlementPlan falls back to D+1 when no method is provided", () => {
  const plan = calculateSettlementPlan("10/01/2024", undefined, 1, 500);
  assert.equal(plan.length, 1);
  assert.deepEqual(plan[0], {
    n: 1,
    due: "11/01/2024",
    expected: 500,
  });
});

test("calculateSettlementPlan respects D+2 configuration", () => {
  const method: PaymentMethod = {
    id: "card-1",
    name: "Cartão Crédito",
    liquidacao: "D+2",
  };

  const plan = calculateSettlementPlan("05/03/2024", method, 1, 1000);
  assert.deepEqual(plan, [
    { n: 1, due: "07/03/2024", expected: 1000 },
  ]);
});

test("calculateSettlementPlan splits installments when configured per parcel", () => {
  const method: PaymentMethod = {
    id: "gateway-1",
    name: "Gateway Parcelado",
    liquidacao: "D+30_por_parcela",
  };

  const plan = calculateSettlementPlan("15/04/2024", method, 3, 900);
  assert.equal(plan.length, 3);
  assert.deepEqual(plan, [
    { n: 1, due: "15/05/2024", expected: 300 },
    { n: 2, due: "15/06/2024", expected: 300 },
    { n: 3, due: "15/07/2024", expected: 300 },
  ]);
});

test("normalizeOfxAmount enforces debit/credit conventions", () => {
  const credit = normalizeOfxAmount("100.237", "CREDIT");
  assert.equal(credit.amount, 100.24);
  assert.equal(credit.adjusted, false);

  const debit = normalizeOfxAmount("125,10", "DEBIT");
  assert.equal(debit.amount, -125.1);
  assert.equal(debit.adjusted, true);

  const debitAlreadyNegative = normalizeOfxAmount("-42.30", "DEBIT");
  assert.equal(debitAlreadyNegative.amount, -42.3);
  assert.equal(debitAlreadyNegative.adjusted, false);

  const debitWrongSign = normalizeOfxAmount("55.00", "DEBIT");
  assert.equal(debitWrongSign.amount, -55);
  assert.equal(debitWrongSign.adjusted, true);

  const creditWrongSign = normalizeOfxAmount("-78.33", "CREDIT");
  assert.equal(creditWrongSign.amount, 78.33);
  assert.equal(creditWrongSign.adjusted, true);
});

test("isDuplicateTransaction detects duplicates by FITID and date+amount", () => {
  const existing: BankTransaction[] = [
    {
      bankTxId: "tx-1",
      date: "01/01/2024",
      desc: "Venda cartão",
      amount: 100,
      accountId: "acc-1",
      fitid: "ABC123",
      sourceHash: "hash-a",
      linkedLegs: [],
      reconciled: false,
    },
  ];

  const candidateSameFitid = {
    date: "02/01/2024",
    desc: "Outra venda",
    amount: 200,
    fitid: "ABC123",
  };

  assert.equal(isDuplicateTransaction(existing, [], candidateSameFitid), true);

  const pending: BankTransaction[] = [
    {
      bankTxId: "tx-2",
      date: "03/01/2024",
      desc: "Transferência",
      amount: -50,
      accountId: "acc-1",
      sourceHash: "hash-b",
      linkedLegs: [],
      reconciled: false,
    },
  ];

  const candidateSameSignature = {
    date: "03/01/2024",
    desc: "Transferência duplicada",
    amount: -50,
  };

  assert.equal(isDuplicateTransaction(existing, pending, candidateSameSignature), true);

  const candidateUnique = {
    date: "04/01/2024",
    desc: "Pix cliente",
    amount: 350,
  };

  assert.equal(isDuplicateTransaction(existing, pending, candidateUnique), false);
});

test("applyCategorizationRules tags only matching transactions", () => {
  const transactions: BankTransaction[] = [
    {
      bankTxId: "tx-10",
      date: "10/02/2024",
      desc: "Stripe* assinatura",
      amount: -120,
      accountId: "acc-1",
      sourceHash: "hash-c",
      linkedLegs: [],
      reconciled: false,
    },
    {
      bankTxId: "tx-11",
      date: "11/02/2024",
      desc: "Pix cliente X",
      amount: 500,
      accountId: "acc-1",
      sourceHash: "hash-d",
      linkedLegs: [],
      reconciled: false,
    },
  ];

  const rules: CategorizationRule[] = [
    {
      ruleId: "rule-1",
      pattern: "stripe",
      matchType: "contains",
      action: {
        type: "categorize_as_expense",
        category: "COMERCIAL_MKT",
        subcategory: "Assinaturas",
        autoConfirm: false,
      },
      confidence: 80,
      learnedFrom: { bankTxId: "tx-0", date: "01/02/2024" },
      appliedCount: 0,
      enabled: true,
      createdAt: new Date().toISOString(),
      dfcCategory: "COMERCIAL_MKT",
      dfcItem: "Assinaturas",
    },
    {
      ruleId: "rule-2",
      pattern: "pix",
      matchType: "contains",
      action: {
        type: "categorize_as_expense",
        category: "GEA",
        subcategory: "Folha",
        autoConfirm: false,
      },
      confidence: 50,
      learnedFrom: { bankTxId: "tx-5", date: "02/02/2024" },
      appliedCount: 5,
      enabled: false,
      createdAt: new Date().toISOString(),
    },
  ];

  const count = applyCategorizationRules(transactions, rules);
  assert.equal(count, 1);
  assert.deepEqual(transactions[0].categorizedAs, {
    group: "COMERCIAL_MKT",
    subcategory: "Assinaturas",
    auto: true,
  });
  assert.equal(transactions[0].categorizedBy, "rule");
  assert.equal(transactions[0].categorizedRuleId, "rule-1");
  assert.equal(transactions[1].categorizedAs, undefined);
});

test("matchesPattern respects strategies", () => {
  assert.equal(matchesPattern("Stripe pagamento", "stripe", "contains"), true);
  assert.equal(matchesPattern("Stripe pagamento", "Stripe pagamento", "exact"), true);
  assert.equal(matchesPattern("Stripe pagamento", "stripe pagamento", "startsWith"), true);
  assert.equal(matchesPattern("Stripe pagamento", "pagamento", "exact"), false);
});

test("extractPattern derives helpful defaults", () => {
  assert.equal(extractPattern("Pagamento fornecedor XPTO", "contains"), "Pagamento");
  assert.equal(extractPattern("Netflix assinatura", "startsWith"), "Netflix as");
  assert.equal(extractPattern("PIX Cliente", "exact"), "PIX Cliente");
});
