import { describe, expect, it, vi } from "vitest";
import {
  PREVENTIVE_DATE_CHECK_MIN_INTERVAL_MS as INTERVAL,
  isPreventiveDateCheckDue,
  runPreventiveDateCheck,
} from "../../../server/jobs/preventive-date-check";
import { isDateBasedDueAlreadyHandled } from "../../../server/lib/preventive-due";

describe("fréquence du préventif par date (V5a)", () => {
  it("dû au premier passage, puis seulement après l'intervalle", () => {
    expect(isPreventiveDateCheckDue(null, 1_000)).toBe(true);
    expect(isPreventiveDateCheckDue(1_000, 1_000 + INTERVAL - 1)).toBe(false);
    expect(isPreventiveDateCheckDue(1_000, 1_000 + INTERVAL)).toBe(true);
  });

  it("un passage compte les OT créés et ne lève jamais", async () => {
    expect(await runPreventiveDateCheck({ check: async () => [{ id: 1 }, { id: 2 }] })).toBe(2);
    const failing = vi.fn().mockRejectedValue(new Error("base coupée"));
    expect(await runPreventiveDateCheck({ check: failing })).toBe(0);
    expect(failing).toHaveBeenCalledTimes(1);
  });
});

describe("échéance par date déjà prise en charge (idempotence)", () => {
  const due = "2026-11-20";
  it.each([
    ["aucun OT", [], false],
    ["OT en attente", [{ status: "pending", dueDate: null }], true],
    ["OT démarré", [{ status: "in_progress", dueDate: due }], true],
    ["OT en attente de pièces", [{ status: "awaiting_parts", dueDate: null }], true],
    ["OT clos pour la même échéance", [{ status: "completed", dueDate: due }], true],
    ["OT clos pour une échéance postérieure", [{ status: "completed", dueDate: "2026-12-01" }], true],
    ["OT clos pour une échéance antérieure : nouvelle échéance", [{ status: "completed", dueDate: "2026-05-01" }], false],
    ["OT clos sans échéance enregistrée", [{ status: "completed", dueDate: null }], false],
    ["OT annulé, même échéance : on recrée", [{ status: "cancelled", dueDate: due }], false],
  ] as const)("%s", (_label, existing, expected) => {
    expect(isDateBasedDueAlreadyHandled(existing, due)).toBe(expected);
  });
});
