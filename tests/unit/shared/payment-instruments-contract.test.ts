import { describe, expect, it } from "vitest";
import {
  DEFAULT_ALERT_DAYS,
  PAYMENT_INSTRUMENT_ALERTS,
  PAYMENT_INSTRUMENT_ALERT_LABELS,
  PAYMENT_INSTRUMENT_STATUSES,
  PAYMENT_INSTRUMENT_STATUS_LABELS,
  closePaymentInstrumentSchema,
  createPaymentInstrumentSchema,
  listPaymentInstrumentsQuerySchema,
  payPaymentInstrumentSchema,
  paymentInstrumentAlert,
  updatePaymentInstrumentSchema,
} from "../../../shared/contracts/payment-instruments";

/** Lot T4 : contrat des traites et chèques (alerte d'échéance, schémas de saisie). */
const base = {
  kind: "traite",
  number: "TR-001",
  drawer: "CFAO",
  drawee: "TAY",
  amount: "2500000",
  issueDate: "2026-10-01",
  dueDate: "2026-11-30",
};

describe("paymentInstrumentAlert", () => {
  it("échéance passée, proche (bornes incluses) ou lointaine, pour une échéance en attente", () => {
    expect(paymentInstrumentAlert("pending", -1)).toBe("overdue");
    expect(paymentInstrumentAlert("pending", 0)).toBe("due_soon");
    expect(paymentInstrumentAlert("pending", DEFAULT_ALERT_DAYS)).toBe("due_soon");
    expect(paymentInstrumentAlert("pending", DEFAULT_ALERT_DAYS + 1)).toBe("none");
    expect(paymentInstrumentAlert("pending", 10, 10)).toBe("due_soon");
  });

  it("aucune alerte hors attente, même échue", () => {
    for (const status of PAYMENT_INSTRUMENT_STATUSES.filter((s) => s !== "pending")) {
      expect(paymentInstrumentAlert(status, -30), status).toBe("none");
    }
  });

  it("chaque statut et chaque alerte ont un libellé (« none » vide)", () => {
    for (const s of PAYMENT_INSTRUMENT_STATUSES) expect(PAYMENT_INSTRUMENT_STATUS_LABELS[s]).toBeTruthy();
    for (const a of PAYMENT_INSTRUMENT_ALERTS) expect(typeof PAYMENT_INSTRUMENT_ALERT_LABELS[a]).toBe("string");
    expect(PAYMENT_INSTRUMENT_ALERT_LABELS.none).toBe("");
  });
});

describe("schémas de saisie", () => {
  it("création : sens « à payer » par défaut, montant normalisé, échéance le jour d'émission admise", () => {
    const parsed = createPaymentInstrumentSchema.parse(base);
    expect(parsed.direction).toBe("outgoing");
    expect(createPaymentInstrumentSchema.safeParse({ ...base, dueDate: base.issueDate }).success).toBe(true);
  });

  it("création : refuse échéance avant émission, montant nul, champ inconnu, date invalide", () => {
    expect(createPaymentInstrumentSchema.safeParse({ ...base, dueDate: "2026-09-30" }).success).toBe(false);
    expect(createPaymentInstrumentSchema.safeParse({ ...base, amount: "0" }).success).toBe(false);
    expect(createPaymentInstrumentSchema.safeParse({ ...base, status: "paid" }).success).toBe(false);
    expect(createPaymentInstrumentSchema.safeParse({ ...base, treasuryEntryId: 1 }).success).toBe(false);
    expect(createPaymentInstrumentSchema.safeParse({ ...base, dueDate: "2026-02-30" }).success).toBe(false);
    expect(createPaymentInstrumentSchema.safeParse({ ...base, drawer: "   " }).success).toBe(false);
  });

  it("correction : au moins un champ, jamais le statut ni le paiement", () => {
    expect(updatePaymentInstrumentSchema.safeParse({ amount: "10" }).success).toBe(true);
    expect(updatePaymentInstrumentSchema.safeParse({}).success).toBe(false);
    expect(updatePaymentInstrumentSchema.safeParse({ status: "paid" }).success).toBe(false);
    expect(updatePaymentInstrumentSchema.safeParse({ paidAt: "2026-11-01" }).success).toBe(false);
  });

  it("paiement et clôture : champs stricts ; « payée » ne passe pas par la clôture", () => {
    expect(payPaymentInstrumentSchema.safeParse({ accountId: 3, paidAt: "2026-11-05" }).success).toBe(true);
    expect(payPaymentInstrumentSchema.safeParse({ accountId: 3 }).success).toBe(false);
    expect(payPaymentInstrumentSchema.safeParse({ accountId: 3, paidAt: "2026-11-05", amount: "1" }).success).toBe(false);
    expect(closePaymentInstrumentSchema.safeParse({ status: "bounced" }).success).toBe(true);
    expect(closePaymentInstrumentSchema.safeParse({ status: "paid" }).success).toBe(false);
    expect(closePaymentInstrumentSchema.safeParse({ status: "pending" }).success).toBe(false);
  });

  it("liste : seuil d'alerte par défaut et borné", () => {
    expect(listPaymentInstrumentsQuerySchema.parse({}).alertDays).toBe(DEFAULT_ALERT_DAYS);
    expect(listPaymentInstrumentsQuerySchema.parse({ alertDays: "15" }).alertDays).toBe(15);
    expect(listPaymentInstrumentsQuerySchema.safeParse({ alertDays: "999" }).success).toBe(false);
    expect(listPaymentInstrumentsQuerySchema.safeParse({ status: "lost" }).success).toBe(false);
  });
});
