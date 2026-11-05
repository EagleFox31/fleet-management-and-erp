import { describe, expect, it } from "vitest";
import { canReadMissionPrice, redactMissionPrice } from "../../../server/lib/mission-price-scope";

const row = { id: 1, agreedPrice: "125000", tariffGridId: 7, status: "planned" };

describe("redactMissionPrice", () => {
  it("lecteurs de la grille : ligne intacte ; les autres et l'absent (échec fermé) : clés à null", () => {
    for (const role of ["admin", "management", "secretary", "logistics"]) {
      expect(canReadMissionPrice({ role }), role).toBe(true);
      expect(redactMissionPrice({ role }, row)).toBe(row);
    }
    for (const reader of [{ role: "technician" }, { role: "driver" }, { role: "client" }, { role: null }, null, undefined]) {
      expect(redactMissionPrice(reader, row)).toEqual({ ...row, agreedPrice: null, tariffGridId: null });
    }
  });
  it("imbriqué (liste, { mission }, trame) : expurgé à toute profondeur sans modifier l'entrée", () => {
    const input = [{ mission: row, vehicle: { id: 2 } }, { payload: { mission: row } }];
    const out = redactMissionPrice(null, input) as any;
    expect(out[0].mission.agreedPrice).toBeNull();
    expect(out[1].payload.mission.tariffGridId).toBeNull();
    expect(out[0].vehicle).toEqual({ id: 2 });
    expect(input[0].mission.agreedPrice).toBe("125000");
  });
  it("une dateinstance reste intacte", () => {
    const d = new Date();
    expect((redactMissionPrice(null, { at: d }) as any).at).toBe(d);
  });
});
