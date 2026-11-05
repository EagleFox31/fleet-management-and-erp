import { describe, expect, it } from "vitest";
import { periodsOverlap, pickTariff, tariffBodySchema, tariffListQuerySchema, tariffListResponseSchema } from "../../../shared/contracts/tariff-grid";

const base = {
  id: 1,
  clientId: null,
  origin: "Douala",
  destination: "N'Djamena",
  cargoType: "",
  pricingUnit: "ton" as const,
  unitPrice: 100,
  validFrom: "2026-01-01",
  validTo: null,
  active: true,
};
const q = { origin: "douala", destination: "n'djamena", date: "2026-06-01" };

describe("pickTariff", () => {
  it("rien d'éligible : null (jamais un prix inventé)", () => {
    expect(pickTariff([], q)).toBeNull();
    expect(pickTariff([{ ...base, active: false }], q)).toBeNull();
    expect(pickTariff([{ ...base, destination: "Kome" }], q)).toBeNull();
  });
  it("trajet insensible à la casse, période bornée (fin incluse)", () => {
    expect(pickTariff([base], q)?.tariffId).toBe(1);
    expect(pickTariff([{ ...base, validTo: "2026-06-01" }], q)?.tariffId).toBe(1);
    expect(pickTariff([{ ...base, validTo: "2026-05-31" }], q)).toBeNull();
    expect(pickTariff([{ ...base, validFrom: "2026-06-02" }], q)).toBeNull();
  });
  it("le tarif du client passe devant le générique, un autre client est ignoré", () => {
    const rows = [base, { ...base, id: 2, clientId: 7, unitPrice: 90 }, { ...base, id: 3, clientId: 8, unitPrice: 1 }];
    expect(pickTariff(rows, { ...q, clientId: 7 })).toMatchObject({ tariffId: 2, source: "client", unitPrice: 90 });
    expect(pickTariff(rows, q)).toMatchObject({ tariffId: 1, source: "generic" });
  });
  it("marchandise : le type exact passe devant le tarif sans type ; un autre type est écarté", () => {
    const rows = [base, { ...base, id: 2, cargoType: "Coton", unitPrice: 120 }, { ...base, id: 3, cargoType: "Ciment" }];
    expect(pickTariff(rows, { ...q, cargoType: "coton" })?.tariffId).toBe(2);
    expect(pickTariff(rows, { ...q, cargoType: "Sable" })?.tariffId).toBe(1);
  });
  it("à rang égal, la période la plus récente l'emporte", () => {
    const rows = [{ ...base, validTo: "2026-12-31" }, { ...base, id: 2, validFrom: "2026-03-01", validTo: "2026-12-31" }];
    expect(pickTariff(rows, q)?.tariffId).toBe(2);
  });
});

describe("periodsOverlap", () => {
  it("chevauchement, contiguïté et période ouverte", () => {
    expect(periodsOverlap({ validFrom: "2026-01-01", validTo: "2026-03-31" }, { validFrom: "2026-03-31", validTo: null })).toBe(true);
    expect(periodsOverlap({ validFrom: "2026-01-01", validTo: "2026-03-30" }, { validFrom: "2026-03-31", validTo: null })).toBe(false);
    expect(periodsOverlap({ validFrom: "2026-01-01", validTo: null }, { validFrom: "2030-01-01", validTo: null })).toBe(true);
  });
});

describe("tariffBodySchema", () => {
  const ok = { origin: "A", destination: "B", pricingUnit: "trip", unitPrice: 10, validFrom: "2026-01-01" };
  it("accepte un corps minimal, refuse unité inconnue, prix négatif, date impossible", () => {
    expect(tariffBodySchema.safeParse(ok).success).toBe(true);
    expect(tariffBodySchema.safeParse({ ...ok, pricingUnit: "kg" }).success).toBe(false);
    expect(tariffBodySchema.safeParse({ ...ok, unitPrice: -1 }).success).toBe(false);
    expect(tariffBodySchema.safeParse({ ...ok, unitPrice: 10.5 }).success).toBe(false);
    expect(tariffBodySchema.safeParse({ ...ok, validFrom: "2026-02-30" }).success).toBe(false);
    expect(tariffBodySchema.safeParse({ ...ok, origin: " " }).success).toBe(false);
  });
});

describe("liste paginée", () => {
  it("la requête borne limit (1-200) et offset (>= 0) et convertit les chaînes", () => {
    expect(tariffListQuerySchema.parse({ limit: "25", offset: "50" })).toMatchObject({ limit: 25, offset: 50 });
    expect(tariffListQuerySchema.parse({})).toEqual({});
    for (const bad of [{ limit: "0" }, { limit: "201" }, { limit: "x" }, { offset: "-1" }]) {
      expect(tariffListQuerySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
  it("la réponse exige total, limit et offset", () => {
    expect(tariffListResponseSchema.safeParse({ rows: [] }).success).toBe(false);
    expect(tariffListResponseSchema.safeParse({ rows: [], total: 0, limit: 50, offset: 0 }).success).toBe(true);
  });
});
