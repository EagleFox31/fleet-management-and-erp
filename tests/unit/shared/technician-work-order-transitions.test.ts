import { describe, expect, it } from "vitest";
import { canTechnicianTransition } from "../../../shared/constants/technician-work-order-transitions";

describe("canTechnicianTransition", () => {
  it.each([
    ["pending", "in_progress"],
    ["in_progress", "in_progress"],
    ["in_progress", "completed"],
    ["awaiting_parts", "in_progress"],
  ])("autorise %s -> %s", (from, to) => {
    expect(canTechnicianTransition(from, to)).toBe(true);
  });

  it.each([
    ["completed", "in_progress"],
    ["completed", "completed"],
    ["cancelled", "in_progress"],
    ["cancelled", "completed"],
    ["pending", "completed"],
    ["awaiting_parts", "completed"],
    ["in_progress", "pending"],
    ["in_progress", "cancelled"],
    ["statut_inconnu", "in_progress"],
  ])("refuse %s -> %s", (from, to) => {
    expect(canTechnicianTransition(from, to)).toBe(false);
  });
});
