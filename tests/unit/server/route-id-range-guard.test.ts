import { describe, expect, it, vi } from "vitest";
import { AppError } from "../../../server/lib/app-error";
import { MAX_DB_INTEGER_ID } from "../../../server/lib/route-id";
import {
  hasOutOfRangeNumericSegment,
  ROUTE_ID_OUT_OF_RANGE_MESSAGE,
  routeIdRangeGuard,
} from "../../../server/middleware/route-id-range-guard";

function run(path: string) {
  const next = vi.fn();
  routeIdRangeGuard({ path, requestId: "t" } as any, {} as any, next);
  return next.mock.calls[0]?.[0];
}

describe("routeIdRangeGuard : id de route hors int4", () => {
  it("MAX_DB_INTEGER_ID passe", () => {
    expect(run(`/drivers/${MAX_DB_INTEGER_ID}`)).toBeUndefined();
  });

  it("MAX + 1 : AppError 400 lisible", () => {
    const err = run(`/drivers/${MAX_DB_INTEGER_ID + 1}`);
    expect(err).toBeInstanceOf(AppError);
    expect(err.status ?? err.statusCode).toBe(400);
    expect(err.message).toBe(ROUTE_ID_OUT_OF_RANGE_MESSAGE);
  });

  it("n'importe quel segment est contrôlé, pas seulement le dernier", () => {
    expect(hasOutOfRangeNumericSegment("/supplier-invoices/99999999999/settlements/1")).toBe(true);
    expect(hasOutOfRangeNumericSegment("/work-orders/12/part-requirements/99999999999999999999")).toBe(true);
  });

  it("variantes lues par parseInt : encodée, suffixe, signe, décimale, espace → refusées", () => {
    for (const path of [
      "/drivers/%39%39%39%39%39%39%39%39%39%39%39",
      "/vehicles/check/99999999999AB",
      "/drivers/99999999999abc",
      "/drivers/-99999999999",
      "/drivers/+99999999999",
      "/drivers/99999999999.5",
      "/drivers/%2099999999999",
    ]) {
      expect(hasOutOfRangeNumericSegment(path), path).toBe(true);
      expect(run(path), path).toBeInstanceOf(AppError);
    }
  });

  it("segments sans entier de tête hors plage ignorés", () => {
    for (const path of [
      "/workflows/acquisition-1730000000000-abc/documents",
      "/statistics/maintenance-cost/year",
      "/drivers/-12",
      "/drivers/12.5",
      "/drivers/%E0%A4%A",
      "/",
      "",
    ]) {
      expect(hasOutOfRangeNumericSegment(path), path).toBe(false);
      expect(run(path), path).toBeUndefined();
    }
  });

  it("zéros de tête : la valeur compte, pas la longueur", () => {
    expect(hasOutOfRangeNumericSegment("/drivers/0000000000001")).toBe(false);
  });
});
