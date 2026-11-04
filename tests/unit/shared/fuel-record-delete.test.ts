import { describe, expect, it } from "vitest";
import { canDeleteFuelRecord, hasMovedFuelCard } from "@shared/constants/fuel-record-delete";

const moved = { debitAmount: "1234.00", creditAmount: "0" };
const physical = { debitAmount: "0", creditAmount: null };

describe("canDeleteFuelRecord", () => {
  it("débit de carte : admin, logistique, secrétariat, pas le chef d'atelier", () => {
    for (const role of ["admin", "logistics", "secretary"]) expect(canDeleteFuelRecord(role, moved)).toBe(true);
    expect(canDeleteFuelRecord("workshop_manager", moved)).toBe(false);
    expect(canDeleteFuelRecord("technician", moved)).toBe(false);
  });
  it("crédit non nul : même règle qu'un débit", () => {
    expect(canDeleteFuelRecord("workshop_manager", { creditAmount: 50 })).toBe(false);
    expect(canDeleteFuelRecord("logistics", { creditAmount: 50 })).toBe(true);
  });
  it("plein physique : admin et chef d'atelier seulement", () => {
    expect(canDeleteFuelRecord("admin", physical)).toBe(true);
    expect(canDeleteFuelRecord("workshop_manager", physical)).toBe(true);
    expect(canDeleteFuelRecord("logistics", physical)).toBe(false);
    expect(canDeleteFuelRecord("secretary", physical)).toBe(false);
  });
  it("sans rôle : refusé ; montants absents ou non numériques : plein physique", () => {
    expect(canDeleteFuelRecord(undefined, physical)).toBe(false);
    expect(hasMovedFuelCard({})).toBe(false);
    expect(hasMovedFuelCard({ debitAmount: "abc" })).toBe(false);
  });
});
