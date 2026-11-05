import { describe, expect, it } from "vitest";
import { computeWithholdings, daysSinceDeposit } from "../../../shared/finance/withholding";

/**
 * Retenues à la source sur facture client (lot F1). Cas tirés des Excel du client :
 * - « RELEVE DE COMPTE CNPCC », feuille « attente paiement » : RETENUS TVA = HT × 19,25 %,
 *   RETENUS IS = HT × 2,2 %, NET = TTC − retTVA − retIS, COMPTEUR = aujourd'hui − date de dépôt ;
 * - « SUIVI OPERATION & FACTURATION », feuille OPERATION : IS = TTC × 2,2 %, TVA retenue vide.
 * La base de l'IS (HT ou TTC) reste un paramètre : question client n°2, non tranchée.
 */

const CNPCC = { vatWithholdingRate: 19.25, isWithholdingRate: 2.2, isBase: "ht" } as const;
const MAERSK = { vatWithholdingRate: 0, isWithholdingRate: 2.2, isBase: "ttc" } as const;

describe("computeWithholdings", () => {
  it.each([
    // HT, TTC Excel arrondi, retTVA, retIS, net (Excel : 2 977 497,6 / 340 285,44 / 15 127 234,56)
    [15467520, 18445018, 2977498, 340285, 15127235],
    [5800320, 6916882, 1116562, 127607, 5672713],
    [8086528, 9643185, 1556657, 177904, 7908624],
  ])("CNPCC, IS sur le HT : HT %i", (amountHt, amountTtc, vat, is, net) => {
    expect(computeWithholdings({ amountHt, amountTtc }, CNPCC)).toEqual({
      withholdingVatAmount: vat,
      withholdingIsAmount: is,
      netPayable: net,
    });
  });

  it.each([
    [1897500, 41745, 1855755],
    [5550000, 122100, 5427900],
  ])("OPERATION (MAERSK), IS sur le TTC, sans retenue TVA : TTC %i", (amountTtc, is, net) => {
    expect(computeWithholdings({ amountHt: Math.round(amountTtc / 1.1925), amountTtc }, MAERSK)).toEqual({
      withholdingVatAmount: 0,
      withholdingIsAmount: is,
      netPayable: net,
    });
  });

  it("la base de l'IS change le montant : même facture, HT puis TTC", () => {
    const amounts = { amountHt: 1000000, amountTtc: 1192500 };
    expect(computeWithholdings(amounts, { ...CNPCC, isBase: "ht" }).withholdingIsAmount).toBe(22000);
    expect(computeWithholdings(amounts, { ...CNPCC, isBase: "ttc" }).withholdingIsAmount).toBe(26235);
  });

  it("le net se calcule sur les retenues arrondies au FCFA", () => {
    const r = computeWithholdings({ amountHt: 101, amountTtc: 120 }, { vatWithholdingRate: 19.25, isWithholdingRate: 2.2, isBase: "ht" });
    expect(r).toEqual({ withholdingVatAmount: 19, withholdingIsAmount: 2, netPayable: 99 });
  });

  it("client sans retenue : net = TTC", () => {
    expect(computeWithholdings({ amountHt: 100, amountTtc: 119 }, { vatWithholdingRate: 0, isWithholdingRate: 0, isBase: "ht" }).netPayable).toBe(119);
  });

  it.each([
    [{ amountHt: -1, amountTtc: 0 }, CNPCC],
    [{ amountHt: 0, amountTtc: Number.NaN }, CNPCC],
    [{ amountHt: 10, amountTtc: 12 }, { ...CNPCC, isWithholdingRate: 101 }],
    [{ amountHt: 10, amountTtc: 12 }, { ...CNPCC, vatWithholdingRate: -0.5 }],
  ])("refuse un montant ou un taux hors bornes (%o, %o)", (amounts, rates) => {
    expect(() => computeWithholdings(amounts, rates)).toThrow(RangeError);
  });
});

describe("daysSinceDeposit", () => {
  it("jours écoulés depuis le dépôt, comme TODAY() − dépôt", () => {
    expect(daysSinceDeposit("2026-10-10", "2026-11-05")).toBe(26);
    expect(daysSinceDeposit("2026-11-05", "2026-11-05")).toBe(0);
  });

  it("indépendant de l'heure : passage d'heure d'hiver compris", () => {
    expect(daysSinceDeposit("2026-10-24", "2026-10-26")).toBe(2);
  });

  it("sans dépôt : null", () => {
    expect(daysSinceDeposit(null, "2026-11-05")).toBeNull();
    expect(daysSinceDeposit(undefined, "2026-11-05")).toBeNull();
  });

  it("refuse une date mal formée", () => {
    expect(() => daysSinceDeposit("05/11/2026", "2026-11-05")).toThrow(RangeError);
  });
});
