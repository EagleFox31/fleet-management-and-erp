import { describe, expect, it } from "vitest";
import { vehicleTires } from "../../../shared/schema";
import {
  getVehicleTireStatusLabel,
  TIRE_SCRAP_REASONS,
  tireRemovalSchema,
  VEHICLE_TIRE_STATUS_LABELS,
  vehicleTireStatusAfterRemoval,
} from "../../../shared/constants/tire-removal";

describe("démontage pneu : destination obligatoire", () => {
  it("refuse un démontage sans destination", () => {
    expect(tireRemovalSchema.safeParse({ removalMileage: 1000 }).success).toBe(false);
  });

  it("refuse un rebut sans motif, accepte un retour en stock sans motif", () => {
    const scrap = tireRemovalSchema.safeParse({ destination: "scrap" });
    expect(scrap.success).toBe(false);
    expect(scrap.error?.issues[0].path).toEqual(["scrapReason"]);
    expect(tireRemovalSchema.safeParse({ destination: "stock" }).success).toBe(true);
  });

  it("le statut du montage dit où est allé le pneu", () => {
    expect(vehicleTireStatusAfterRemoval({ destination: "stock" })).toBe("removed");
    expect(vehicleTireStatusAfterRemoval({ destination: "scrap", scrapReason: "damaged" })).toBe("damaged");
  });

  it("motifs de rebut et libellés couvrent l'énumération `vehicle_tires.status`", () => {
    const statuses = vehicleTires.status.enumValues;
    for (const reason of TIRE_SCRAP_REASONS) expect(statuses).toContain(reason);
    expect(Object.keys(VEHICLE_TIRE_STATUS_LABELS).sort()).toEqual([...statuses].sort());
    expect(getVehicleTireStatusLabel("active")).toBe("Monté");
  });
});
