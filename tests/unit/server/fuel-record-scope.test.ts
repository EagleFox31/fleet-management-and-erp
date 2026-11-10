import { describe, expect, it } from "vitest";
import { MISSION_READ_ROLES } from "@shared/constants/roles";
import { withoutFuelRecordMissionFields } from "../../../server/lib/fuel-record-scope";

const row = { id: 1, quantity: 2, orderNumber: "BC-1", clientName: "CLIENT", destination: "DOUALA" };

describe("withoutFuelRecordMissionFields", () => {
  it.each(["technician", "client", "", null, undefined])("%s : numéro de commande, client et destination retirés", (role) => {
    expect(withoutFuelRecordMissionFields({ role }, [row])).toEqual([{ id: 1, quantity: 2 }]);
    expect(withoutFuelRecordMissionFields({ role }, row)).toEqual({ id: 1, quantity: 2 });
  });

  it("MISSION_READ_ROLES : ligne inchangée", () => {
    for (const role of MISSION_READ_ROLES) expect(withoutFuelRecordMissionFields({ role }, row), role).toBe(row);
  });

  it("lecteur absent : échec fermé ; valeurs non objet laissées telles quelles", () => {
    expect(withoutFuelRecordMissionFields(undefined, row)).toEqual({ id: 1, quantity: 2 });
    expect(withoutFuelRecordMissionFields({ role: "technician" }, [null, 3])).toEqual([null, 3]);
  });
});
