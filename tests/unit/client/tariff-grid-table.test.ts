import { describe, expect, it } from "vitest";
import { tariffBodyOf } from "@/components/operations/tariff-grid-table";
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
