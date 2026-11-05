import { describe, expect, it } from "vitest";
import { canRoleRemovePartUsed } from "@shared/constants/roles";

describe("canRoleRemovePartUsed", () => {
  it.each(["admin", "warehouse", "workshop_manager"])("%s peut retirer sur un OT en cours", (role) => {
    expect(canRoleRemovePartUsed(role, "in_progress")).toBe(true);
  });
  it.each(["technician", "management", "client", undefined, null])("%s ne peut pas", (role) => {
    expect(canRoleRemovePartUsed(role as string | undefined, "in_progress")).toBe(false);
  });
  it.each(["completed", "cancelled"])("refuse sur un OT %s", (status) => {
    expect(canRoleRemovePartUsed("admin", status)).toBe(false);
  });
});
