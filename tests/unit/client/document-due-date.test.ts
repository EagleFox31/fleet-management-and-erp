import { describe, expect, it } from "vitest";
import { proposeDueDate } from "@/lib/document-due-date";

describe("echeance proposee d'un document", () => {
  it("ajoute la duree de validite en mois", () => {
    expect(proposeDueDate(new Date(2026, 9, 30), 12)).toBe("2027-10-30");
    expect(proposeDueDate(new Date(2026, 9, 30), 6)).toBe("2027-04-30");
  });

  it("ramene le jour a la fin du mois cible", () => {
    expect(proposeDueDate(new Date(2026, 0, 31), 1)).toBe("2026-02-28");
    expect(proposeDueDate(new Date(2027, 11, 31), 2)).toBe("2028-02-29");
  });

  it("ne propose rien sans duree fixe ou sans date valide", () => {
    expect(proposeDueDate(new Date(2026, 9, 30), null)).toBeNull();
    expect(proposeDueDate(new Date(2026, 9, 30), 0)).toBeNull();
    expect(proposeDueDate(new Date("x"), 12)).toBeNull();
  });
});
