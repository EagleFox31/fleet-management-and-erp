import { describe, expect, it } from "vitest";
import { pageRangeLabel, tariffBodyOf } from "@/components/operations/tariff-grid-table";
import { tariffBodySchema } from "@shared/contracts/tariff-grid";
import { canWriteTariffGrid } from "@shared/constants/roles";

const draft = {
  clientId: "",
  origin: " Douala ",
  destination: "N'Djamena",
  cargoType: "",
  pricingUnit: "ton" as const,
  unitPrice: "125000",
  validFrom: "2026-01-01",
  validTo: "",
  notes: " ",
};

describe("grille tarifaire (écran)", () => {
  it("champs vides : tarif générique, sans fin, sans note ; texte rogné ; corps accepté par le contrat", () => {
    const body = tariffBodyOf(draft);
    expect(body).toMatchObject({ clientId: null, origin: "Douala", validTo: null, notes: null, unitPrice: 125000, active: true });
    expect(tariffBodySchema.safeParse(body).success).toBe(true);
    expect(tariffBodyOf({ ...draft, clientId: "7" }).clientId).toBe(7);
  });
  it("écriture : admin et direction seulement", () => {
    expect(["admin", "management", "secretary", "logistics", null].map(canWriteTariffGrid)).toEqual([true, true, false, false, false]);
  });
});

describe("pageRangeLabel", () => {
  it("première page, dernière page partielle, liste vide", () => {
    expect(pageRangeLabel({ total: 130, limit: 50, offset: 0 })).toBe("1-50 sur 130");
    expect(pageRangeLabel({ total: 130, limit: 50, offset: 100 })).toBe("101-130 sur 130");
    expect(pageRangeLabel({ total: 0, limit: 50, offset: 0 })).toBe("0 sur 0");
  });
});
