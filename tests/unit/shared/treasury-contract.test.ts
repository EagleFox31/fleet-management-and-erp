import { describe, expect, it } from "vitest";
import {
  createTreasuryAccountSchema,
  createTreasuryEntrySchema,
  createTreasuryTransferSchema,
  currentTreasuryMonth,
  ledgerOf,
  ledgerToCsv,
  nextMonth,
  treasuryLedgerQuerySchema,
} from "../../../shared/contracts/treasury";


const entry = { accountId: 1, entryDate: "2026-11-05", label: "Appro caisse", direction: "in", amount: "1250" };

describe("journal de trésorerie : montants et dates", () => {
  it("ramène un montant à deux décimales, virgule comprise, sans flottant", () => {
    expect(createTreasuryEntrySchema.parse({ ...entry, amount: "10,5" }).amount).toBe("10.50");
    expect(createTreasuryEntrySchema.parse({ ...entry, amount: 0.3 }).amount).toBe("0.30");
    expect(createTreasuryEntrySchema.parse(entry).amount).toBe("1250.00");
    expect(createTreasuryEntrySchema.parse({ ...entry, amount: "007.5" }).amount).toBe("7.50");
    // 13 chiffres entiers et des centimes : exact, aucun arrondi de flottant.
    expect(createTreasuryEntrySchema.parse({ ...entry, amount: "9999999999999.99" }).amount).toBe("9999999999999.99");
    expect(createTreasuryAccountSchema.parse({ code: "X", label: "x", kind: "cash", openingBalance: "-0" }).openingBalance).toBe("0.00");
    expect(createTreasuryAccountSchema.parse({ code: "X", label: "x", kind: "cash", openingBalance: "-12.3" }).openingBalance).toBe("-12.30");
  });

  it("refuse un montant nul, négatif, à trois décimales ou illisible", () => {
    for (const amount of ["0", "-5", "1.234", "abc", "", "1e3"]) {
      expect(createTreasuryEntrySchema.safeParse({ ...entry, amount }).success, amount).toBe(false);
    }
  });

  it("refuse une date impossible", () => {
    expect(createTreasuryEntrySchema.safeParse({ ...entry, entryDate: "2026-02-30" }).success).toBe(false);
    expect(createTreasuryEntrySchema.safeParse({ ...entry, entryDate: "05/11/2026" }).success).toBe(false);
  });

  it("une écriture ne porte ni auteur ni numéro de groupe de virement saisis par le client", () => {
    const parsed = createTreasuryEntrySchema.parse({ ...entry, createdBy: 99, transferGroup: "x", id: 7 });
    expect(parsed).not.toHaveProperty("createdBy");
    expect(parsed).not.toHaveProperty("transferGroup");
    expect(parsed).not.toHaveProperty("id");
  });

  it("le compte : code en majuscules, solde d'ouverture signé", () => {
    const account = createTreasuryAccountSchema.parse({ code: "caisse-1", label: "Caisse", kind: "cash", openingBalance: "-100" });
    expect(account.code).toBe("CAISSE-1");
    expect(account.openingBalance).toBe("-100.00");
    expect(createTreasuryAccountSchema.safeParse({ code: "a b", label: "x", kind: "cash" }).success).toBe(false);
    expect(createTreasuryAccountSchema.safeParse({ code: "A", label: "x", kind: "coffre" }).success).toBe(false);
  });
});

describe("journal de trésorerie : virement interne", () => {
  const transfer = { fromAccountId: 1, toAccountId: 2, entryDate: "2026-11-05", amount: "500", label: "Banque vers caisse" };

  it("accepte deux comptes différents", () => {
    expect(createTreasuryTransferSchema.parse(transfer).amount).toBe("500.00");
  });

  it("refuse un virement d'un compte vers lui-même", () => {
    expect(createTreasuryTransferSchema.safeParse({ ...transfer, toAccountId: 1 }).success).toBe(false);
  });

  it("refuse un montant nul", () => {
    expect(createTreasuryTransferSchema.safeParse({ ...transfer, amount: "0" }).success).toBe(false);
  });
});

describe("journal de trésorerie : solde courant (référence)", () => {
  it("cumule dans l'ordre et donne totaux et solde final", () => {
    const result = ledgerOf("1000.00", [
      { direction: "in", amount: "250.50" },
      { direction: "out", amount: "100.25" },
      { direction: "out", amount: "2000.00" },
    ]);
    expect(result.balances).toEqual(["1250.50", "1150.25", "-849.75"]);
    expect(result.totals).toEqual({ in: "250.50", out: "2100.25", net: "-1849.75" });
    expect(result.closing).toBe("-849.75");
  });

  it("un journal vide garde le solde d'ouverture", () => {
    expect(ledgerOf("42.00", [])).toEqual({ balances: [], totals: { in: "0.00", out: "0.00", net: "0.00" }, closing: "42.00" });
  });

  it("un virement est neutre sur la somme des deux comptes", () => {
    const from = ledgerOf("800.00", [{ direction: "out", amount: "300.00" }]);
    const to = ledgerOf("50.00", [{ direction: "in", amount: "300.00" }]);
    expect(Number(from.closing) + Number(to.closing)).toBe(850);
  });

  it("les centimes ne dérivent pas sur de longues séries", () => {
    const entries = Array.from({ length: 1000 }, () => ({ direction: "in" as const, amount: "0.10" }));
    expect(ledgerOf("0.00", entries).closing).toBe("100.00");
  });
});

describe("journal de trésorerie : mois et export", () => {
  it("mois suivant, passage d'année compris", () => {
    expect(nextMonth("2026-11")).toBe("2026-12");
    expect(nextMonth("2026-12")).toBe("2027-01");
  });

  it("mois en cours lu à Douala : le 31 à 23 h 30 UTC, c'est déjà le mois suivant", () => {
    expect(currentTreasuryMonth(new Date("2026-10-31T23:30:00Z"))).toBe("2026-11");
    expect(currentTreasuryMonth(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01");
    expect(currentTreasuryMonth(new Date("2026-11-15T12:00:00Z"))).toBe("2026-11");
  });

  it("ids du corps bornés au type integer et stricts", () => {
    const base = { entryDate: "2026-11-05", label: "x", direction: "in", amount: "1" };
    expect(createTreasuryEntrySchema.safeParse({ ...base, accountId: 2147483647 }).success).toBe(true);
    expect(createTreasuryEntrySchema.safeParse({ ...base, accountId: 2147483648 }).success).toBe(false);
    expect(createTreasuryEntrySchema.safeParse({ ...base, accountId: "12" }).success).toBe(false);
  });

  it("requête : mois valide ou refus", () => {
    expect(treasuryLedgerQuerySchema.parse({ month: "2026-11" }).format).toBe("json");
    expect(treasuryLedgerQuerySchema.safeParse({ month: "2026-13" }).success).toBe(false);
    expect(treasuryLedgerQuerySchema.safeParse({ format: "xml" }).success).toBe(false);
  });

  it("l'export neutralise une formule et protège les séparateurs", () => {
    const base = { id: 1, accountId: 1, entryDate: "2026-11-05", pieceRef: null, direction: "out" as const, amount: "5.00", category: "autre" as const, counterpartyLabel: null, transferGroup: null, notes: null, vehicleId: null, missionId: null, clientId: null, supplierId: null, fuelRecordId: null, supplierSettlementId: null, balanceAfter: "95.00" };
    const csv = ledgerToCsv({
      account: { id: 1, code: "C", label: "Caisse", kind: "cash", bankName: null, openingBalance: "100.00", openingDate: null, isActive: true, currentBalance: "95.00" },
      month: "2026-11",
      openingBalance: "100.00",
      entries: [{ ...base, label: "=HYPERLINK(\"x\")" }, { ...base, id: 2, label: "a;b" }],
      totals: { in: "0.00", out: "10.00", net: "-10.00" },
      closingBalance: "90.00",
    });
    expect(csv.startsWith("﻿Date;")).toBe(true);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("\"a;b\"");
    expect(csv).toContain("Total du mois");
  });
});
