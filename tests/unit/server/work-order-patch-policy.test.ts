import { describe, expect, it } from "vitest";
import { AppError } from "../../../server/lib/app-error";
import {
  validateWorkOrderPatch,
  WORK_ORDER_FIELDS_FORBIDDEN_ERROR,
  WORK_ORDER_NOT_ASSIGNED_ERROR,
  WORK_ORDER_PATCH_FIELDS_BY_ROLE,
} from "../../../server/lib/work-order-patch-policy";

const workOrder = { vehicleId: 7, technicianId: 42 };
const admin = { id: 1, role: "admin" };
const tech = { id: 42, role: "technician" };

function refusal(run: () => unknown): AppError {
  try {
    run();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("aucun refus");
}

describe("validateWorkOrderPatch", () => {
  it("aucune colonne tenue par le serveur dans une liste blanche", () => {
    for (const fields of Object.values(WORK_ORDER_PATCH_FIELDS_BY_ROLE)) {
      for (const owned of ["id", "createdBy", "createdAt", "updatedBy", "updatedAt", "cost", "vehicleId"]) {
        expect(fields).not.toContain(owned);
      }
    }
    expect(WORK_ORDER_PATCH_FIELDS_BY_ROLE.technician).not.toContain("technicianId");
  });

  it("pose updatedBy sur l'auteur et garde les champs permis", () => {
    expect(validateWorkOrderPatch({ user: admin, workOrder, body: { title: "T", technicianId: 3 } })).toEqual({
      title: "T",
      technicianId: 3,
      updatedBy: 1,
    });
  });

  it("refuse une colonne serveur avec le champ en cause (403)", () => {
    const error = refusal(() => validateWorkOrderPatch({ user: admin, workOrder, body: { cost: "5", title: "T" } }));
    expect(error.status).toBe(403);
    expect(error.message).toBe(WORK_ORDER_FIELDS_FORBIDDEN_ERROR);
    expect(error.fieldErrors?.map((e) => e.field)).toEqual(["cost"]);
  });

  it("véhicule inchangé et copies du véhicule ignorés ; véhicule changé refusé", () => {
    const body = { vehicleId: "7", vehicleRegistration: "X", vehicleBrand: "X", vehicleModel: "X", title: "T" };
    expect(validateWorkOrderPatch({ user: admin, workOrder, body })).toEqual({ title: "T", updatedBy: 1 });
    const error = refusal(() => validateWorkOrderPatch({ user: admin, workOrder, body: { vehicleId: 8 } }));
    expect(error.status).toBe(403);
    expect(error.fieldErrors?.[0].message).toMatch(/ne change pas/);
  });

  it("technicien : son OT seulement, sans affectation", () => {
    expect(validateWorkOrderPatch({ user: tech, workOrder, body: { status: "in_progress" } })).toEqual({
      status: "in_progress",
      updatedBy: 42,
    });
    expect(refusal(() => validateWorkOrderPatch({ user: tech, workOrder: { ...workOrder, technicianId: 9 }, body: {} })).message).toBe(
      WORK_ORDER_NOT_ASSIGNED_ERROR,
    );
    expect(refusal(() => validateWorkOrderPatch({ user: tech, workOrder: { ...workOrder, technicianId: null }, body: {} })).status).toBe(403);
    const error = refusal(() => validateWorkOrderPatch({ user: tech, workOrder, body: { technicianId: 42 } }));
    expect(error.fieldErrors?.map((e) => e.field)).toEqual(["technicianId"]);
  });

  it("rôle sans liste blanche refusé ; type invalide en 400", () => {
    expect(refusal(() => validateWorkOrderPatch({ user: { id: 5, role: "warehouse" }, workOrder, body: {} })).status).toBe(403);
    expect(refusal(() => validateWorkOrderPatch({ user: admin, workOrder, body: { title: "   " } })).status).toBe(400);
    expect(refusal(() => validateWorkOrderPatch({ user: admin, workOrder, body: { duration: "deux" } })).status).toBe(400);
    expect(refusal(() => validateWorkOrderPatch({ user: admin, workOrder, body: [] })).status).toBe(400);
  });
});
