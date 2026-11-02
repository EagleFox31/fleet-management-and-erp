import { describe, expect, it } from "vitest";
import { checkWorkOrderTransition, WORK_ORDER_STATUSES } from "../../../shared/constants/work-order-transitions";

describe("checkWorkOrderTransition", () => {
  it("garder le même statut est toujours permis, pour tout rôle", () => {
    for (const status of WORK_ORDER_STATUSES) {
      expect(checkWorkOrderTransition(status, status, "technician")).toEqual({ allowed: true });
    }
  });

  it("terminé et annulé ne bougent plus (409)", () => {
    for (const to of ["pending", "in_progress", "awaiting_parts", "cancelled"]) {
      expect(checkWorkOrderTransition("completed", to, "admin")).toMatchObject({ allowed: false, status: 409 });
    }
    expect(checkWorkOrderTransition("cancelled", "pending", "workshop_manager")).toMatchObject({ allowed: false, status: 409 });
  });

  it("chef d'atelier : transitions prévues", () => {
    expect(checkWorkOrderTransition("pending", "in_progress", "workshop_manager").allowed).toBe(true);
    expect(checkWorkOrderTransition("in_progress", "cancelled", "workshop_manager").allowed).toBe(true);
    expect(checkWorkOrderTransition("awaiting_parts", "completed", "workshop_manager")).toMatchObject({ allowed: false, status: 409 });
    expect(checkWorkOrderTransition("pending", "completed", "workshop_manager")).toMatchObject({ allowed: false, status: 409 });
  });

  it("technicien : ses gestes seulement, le reste en 403", () => {
    expect(checkWorkOrderTransition("pending", "in_progress", "technician").allowed).toBe(true);
    expect(checkWorkOrderTransition("in_progress", "completed", "technician").allowed).toBe(true);
    expect(checkWorkOrderTransition("awaiting_parts", "in_progress", "technician").allowed).toBe(true);
    expect(checkWorkOrderTransition("in_progress", "cancelled", "technician")).toMatchObject({ allowed: false, status: 403 });
    expect(checkWorkOrderTransition("in_progress", "pending", "technician")).toMatchObject({ allowed: false, status: 403 });
  });
});
