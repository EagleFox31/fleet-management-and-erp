import { describe, expect, it } from "vitest";
import { buildDriverPatchPayload, isCpcTrainingDateChanged } from "../../../client/src/lib/driver-patch-payload";

describe("corps du PATCH chauffeur : cpcTrainingDate seulement si modifiée", () => {
  it("date inchangée : absente du corps, le reste est conservé", () => {
    const out = buildDriverPatchPayload({ firstName: "A", cpcTrainingDate: "2026-01-10" }, "2026-01-10T00:00:00.000Z");
    expect(out).toEqual({ firstName: "A" });
    expect("cpcTrainingDate" in out).toBe(false);
  });

  it("date modifiée : envoyée", () => {
    expect(buildDriverPatchPayload({ firstName: "A", cpcTrainingDate: "2026-02-01" }, "2026-01-10")).toEqual({
      firstName: "A",
      cpcTrainingDate: "2026-02-01",
    });
  });

  it("date effacée : null envoyé pour vider la date", () => {
    expect(buildDriverPatchPayload({ cpcTrainingDate: null }, "2026-01-10")).toEqual({ cpcTrainingDate: null });
    expect(buildDriverPatchPayload({ cpcTrainingDate: "" }, "2026-01-10")).toEqual({ cpcTrainingDate: "" });
  });

  it("absente avant et après (vide, null, undefined) : inchangée", () => {
    for (const next of ["", null, undefined]) {
      for (const loaded of ["", null, undefined]) {
        expect(isCpcTrainingDateChanged(next, loaded)).toBe(false);
      }
    }
    expect("cpcTrainingDate" in buildDriverPatchPayload({ cpcTrainingDate: "" }, null)).toBe(false);
  });

  it("date saisie alors qu'il n'y en avait pas : envoyée", () => {
    expect(buildDriverPatchPayload({ cpcTrainingDate: "2026-02-01" }, null)).toEqual({ cpcTrainingDate: "2026-02-01" });
  });
});
