import { describe, expect, it } from "vitest";
import { wouldLeaveNoActiveAdmin } from "../../../server/lib/last-admin-rule";

describe("wouldLeaveNoActiveAdmin", () => {
  it("vrai quand la cible est le seul administrateur actif", () => {
    expect(wouldLeaveNoActiveAdmin([7], 7)).toBe(true);
  });
  it("faux quand un autre administrateur actif reste", () => {
    expect(wouldLeaveNoActiveAdmin([7, 8], 7)).toBe(false);
    expect(wouldLeaveNoActiveAdmin([7, 8, 9], 9)).toBe(false);
  });
  it("faux quand la cible n'est pas un administrateur actif (rien à retirer)", () => {
    expect(wouldLeaveNoActiveAdmin([8], 7)).toBe(false);
    expect(wouldLeaveNoActiveAdmin([], 7)).toBe(false);
  });
});
