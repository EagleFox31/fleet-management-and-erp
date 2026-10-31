import { describe, expect, it } from "vitest";
import { ApiError } from "../../../client/src/lib/api-error";
import {
  NO_DATA,
  UNAVAILABLE,
  kpiTileText,
  shouldRetryKpi,
} from "../../../client/src/components/dashboard/kpi-tiles";

const err = (status: number) => new ApiError(status, "x", null);

describe("tuiles KPI", () => {
  it("une erreur, dont 501, affiche « Indisponible », jamais « Aucune donnée »", () => {
    expect(kpiTileText({ isLoading: false, isError: true }, 12, null)).toEqual({ value: UNAVAILABLE });
    expect(kpiTileText({ isLoading: false, isError: true }, 12, "sur 3 mois").subValue).toBeUndefined();
  });

  it("« Aucune donnée » est réservé à une réponse reçue mais vide", () => {
    expect(kpiTileText({ isLoading: false, isError: false }, "—", null)).toEqual({ value: "—", subValue: NO_DATA });
    expect(kpiTileText({ isLoading: false, isError: false }, 4, "sur 2 mois")).toEqual({ value: 4, subValue: "sur 2 mois" });
    expect(kpiTileText({ isLoading: true, isError: false }, 4, null)).toEqual({ value: "…" });
  });

  it("pas de nouvel essai sur un 4xx ou un 501 ; un seul sur réseau ou autre 5xx", () => {
    for (const s of [400, 401, 403, 404, 501]) expect(shouldRetryKpi(0, err(s))).toBe(false);
    for (const e of [err(500), err(503), new TypeError("Failed to fetch")]) {
      expect(shouldRetryKpi(0, e)).toBe(true);
      expect(shouldRetryKpi(1, e)).toBe(false);
    }
  });
});
