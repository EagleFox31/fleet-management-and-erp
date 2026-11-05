import { describe, expect, it } from "vitest";
import { withDriverCpcVerdict } from "../../../server/lib/mission-driver-cpc";

/** Cloison de #127 sur le verdict CPC joint aux affectations de mission. */
describe("verdict CPC d'une affectation de mission", () => {
  const TODAY = "2026-11-05";
  const driver = { id: 7, firstName: "A", cpcStatus: "FORMÉ", cpcTrainingDate: "2024-08-26" };

  it("personnel : verdict et libellé fixe, date de formation retirée", () => {
    const out = withDriverCpcVerdict(driver, { id: 1, role: "logistics" }, undefined, TODAY)!;
    expect(out.cpcEligible).toBe(false);
    expect(out.cpcIneligibleReason).toBe("Formation CPC expirée.");
    expect("cpcTrainingDate" in out).toBe(false);
  });

  it("client : aucun champ de verdict", () => {
    const out = withDriverCpcVerdict(driver, { id: 1, role: "client" }, undefined, TODAY)!;
    expect("cpcEligible" in out).toBe(false);
    expect("cpcIneligibleReason" in out).toBe(false);
    expect("cpcTrainingDate" in out).toBe(false);
  });

  it("chauffeur : verdict pour sa fiche, rien pour celle d'un collègue", () => {
    expect(withDriverCpcVerdict(driver, { id: 1, role: "driver" }, [7], TODAY)!.cpcEligible).toBe(false);
    const other = withDriverCpcVerdict(driver, { id: 1, role: "driver" }, [8], TODAY)!;
    expect("cpcEligible" in other).toBe(false);
    expect("cpcIneligibleReason" in other).toBe(false);
  });

  it("sans lecteur ou sans chauffeur : rien", () => {
    expect("cpcEligible" in withDriverCpcVerdict(driver, undefined, undefined, TODAY)!).toBe(false);
    expect(withDriverCpcVerdict(null, { id: 1, role: "admin" }, undefined)).toBeNull();
  });

  it("chauffeur éligible : true et raison null", () => {
    const out = withDriverCpcVerdict({ id: 7, cpcStatus: "FORMÉ", cpcTrainingDate: "2026-07-27" }, { id: 1, role: "admin" }, undefined, TODAY)!;
    expect(out).toMatchObject({ cpcEligible: true, cpcIneligibleReason: null });
  });

  it("expose le code stable à côté du libellé", () => {
    const out = withDriverCpcVerdict(driver, { id: 1, role: "logistics" }, undefined, TODAY)!;
    expect(out.cpcIneligibleCode).toBe("EXPIRED");
    const ok = withDriverCpcVerdict({ id: 7, cpcStatus: "FORMÉ", cpcTrainingDate: "2026-07-27" }, { id: 1, role: "admin" }, undefined, TODAY)!;
    expect(ok.cpcIneligibleCode).toBeNull();
  });

  it("ne renvoie jamais cpcTrainingDate, quel que soit le lecteur", () => {
    const readers: Array<[string, Parameters<typeof withDriverCpcVerdict>[1], number[] | undefined]> = [
      ["admin", { id: 1, role: "admin" }, undefined],
      ["logistics", { id: 1, role: "logistics" }, undefined],
      ["client", { id: 1, role: "client" }, undefined],
      ["chauffeur sur sa fiche", { id: 1, role: "driver" }, [7]],
      ["chauffeur sur la fiche d'un autre", { id: 1, role: "driver" }, [8]],
      ["chauffeur sans fiche", { id: 1, role: "driver" }, []],
      ["lecteur indéfini", undefined, undefined],
    ];
    for (const [name, reader, scope] of readers) {
      const out = withDriverCpcVerdict(driver, reader, scope, TODAY)!;
      expect("cpcTrainingDate" in out, name).toBe(false);
      expect(JSON.stringify(out), name).not.toContain("2024-08-26");
    }
  });
});
