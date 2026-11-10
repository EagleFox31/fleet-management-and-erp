import { describe, expect, it } from "vitest";
import { MISSION_READ_ROLES } from "@shared/constants/roles";
import { withoutFuelRecordMissionFields } from "../../../server/lib/fuel-record-scope";

const row = { id: 1, quantity: 2, missionId: 10, orderNumber: "BC-1", clientName: "CLIENT", destination: "DOUALA" };
const bare = { id: 1, quantity: 2, missionId: 10 };

describe("withoutFuelRecordMissionFields", () => {
  it.each(["technician", "client", "role_inconnu", "", null, undefined])("%s : numéro de commande, client et destination retirés", (role) => {
    expect(withoutFuelRecordMissionFields({ role }, [row], new Set([10]))).toEqual([bare]);
    expect(withoutFuelRecordMissionFields({ role }, row)).toEqual(bare);
  });

  it("MISSION_READ_ROLES hors chauffeur : ligne inchangée, sans ensemble de missions", () => {
    for (const role of MISSION_READ_ROLES.filter((r) => r !== "driver")) {
      expect(withoutFuelRecordMissionFields({ role }, row), role).toBe(row);
    }
  });

  it("chauffeur : champs gardés sur les pleins de ses missions seulement", () => {
    const own = new Set([10]);
    const other = { ...row, id: 2, missionId: 11 };
    const noMission = { ...row, id: 3, missionId: null };
    expect(withoutFuelRecordMissionFields({ role: "driver" }, [row, other, noMission], own)).toEqual([
      row,
      { id: 2, quantity: 2, missionId: 11 },
      { id: 3, quantity: 2, missionId: null },
    ]);
  });

  it("chauffeur sans ensemble de missions ou ensemble vide : échec fermé", () => {
    expect(withoutFuelRecordMissionFields({ role: "driver" }, row)).toEqual(bare);
    expect(withoutFuelRecordMissionFields({ role: "driver" }, row, new Set())).toEqual(bare);
  });

  it("lecteur absent : échec fermé ; valeurs non objet laissées telles quelles", () => {
    expect(withoutFuelRecordMissionFields(undefined, row)).toEqual(bare);
    expect(withoutFuelRecordMissionFields({ role: "technician" }, [null, 3])).toEqual([null, 3]);
  });
});
