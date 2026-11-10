import { describe, expect, it } from "vitest";
import {
  driverDocumentDedupeKey,
  driverExpiryFindings,
  driverExpiryStage,
  type DriverExpiryInput,
} from "../../../server/services/driver-document-expiry";

const today = new Date("2026-11-10T15:30:00Z");

const driver = (over: Partial<DriverExpiryInput> = {}): DriverExpiryInput => ({
  id: 7,
  firstName: "Paul",
  lastName: "Mbarga",
  licenseExpiry: null,
  cniExpiry: null,
  cpcTrainingDate: null,
  ...over,
});

describe("paliers d'échéance des papiers chauffeur (V5a)", () => {
  it.each([
    ["2026-12-10", "j30", 30],
    ["2026-12-11", null, 31],
    ["2026-11-17", "j7", 7],
    ["2026-11-18", "j30", 8],
    ["2026-11-10", "j7", 0],
    ["2026-11-09", "expired", -1],
    ["2025-01-01", "expired", -678],
  ])("%s -> %s", (expiry, stage, days) => {
    const found = driverExpiryStage(expiry, today);
    if (stage === null) expect(found).toBeNull();
    else expect(found).toEqual({ stage, days });
  });

  it("date absente ou invalide : aucun palier", () => {
    expect(driverExpiryStage(null, today)).toBeNull();
    expect(driverExpiryStage("", today)).toBeNull();
    expect(driverExpiryStage("pas-une-date", today)).toBeNull();
  });
});

describe("constats par chauffeur", () => {
  it("permis à J-30, CNI à J-7, CPC échue : trois constats, priorités croissantes", () => {
    // Formation du 2024-11-08 : valide jusqu'au 2026-11-09 (731 jours), donc échue d'un jour.
    const found = driverExpiryFindings(
      driver({ licenseExpiry: "2026-12-10", cniExpiry: "2026-11-15", cpcTrainingDate: "2024-11-08" }),
      today,
    );
    const by = Object.fromEntries(found.map((f) => [f.kind, f]));
    expect(by.license).toMatchObject({ stage: "j30", priority: "medium", days: 30 });
    expect(by.cni).toMatchObject({ stage: "j7", priority: "high", days: 5 });
    expect(by.cpc).toMatchObject({ stage: "expired", priority: "critical", days: -1, expiry: "2026-11-09" });
    expect(found).toHaveLength(3);
  });

  it("rien à signaler au-delà de 30 jours ni sans date", () => {
    expect(driverExpiryFindings(driver(), today)).toEqual([]);
    expect(driverExpiryFindings(driver({ licenseExpiry: "2027-06-01", cniExpiry: "2027-06-01" }), today)).toEqual([]);
  });

  it("le message nomme le chauffeur et le document, sans numéro de pièce", () => {
    const [f] = driverExpiryFindings(driver({ licenseExpiry: "2026-11-12" }), today);
    expect(f.title).toBe("Permis de conduire à renouveler sous 7 jours (Paul Mbarga, 12/11/2026)");
    expect(f.message).toBe("Chauffeur Paul Mbarga - Permis de conduire expire dans 2 jour(s)");
  });

  it("les titres des paliers diffèrent (sinon l'émission écarte J-7 derrière un J-30 non lu)", () => {
    const titleAt = (d: string) => driverExpiryFindings(driver({ licenseExpiry: "2026-12-05" }), new Date(d))[0].title;
    const titles = [titleAt("2026-11-10T08:00:00Z"), titleAt("2026-11-30T08:00:00Z"), titleAt("2026-12-07T08:00:00Z")];
    expect(new Set(titles).size).toBe(3);
  });

  it("jour J : valable, message dédié", () => {
    const [f] = driverExpiryFindings(driver({ cniExpiry: "2026-11-10" }), today);
    expect(f.stage).toBe("j7");
    expect(f.message).toContain("dernier jour de validité");
  });

  it("pas de doublon : mêmes entrées, mêmes clés ; un palier ou un renouvellement change la clé", () => {
    const input = driver({ licenseExpiry: "2026-11-12" });
    const first = driverExpiryFindings(input, today).map((f) => f.dedupeKey);
    const again = driverExpiryFindings(input, new Date("2026-11-10T22:00:00Z")).map((f) => f.dedupeKey);
    expect(again).toEqual(first);
    // Le lendemain, même palier : même clé (pas de nouvelle alerte pour J-1 contre J-2).
    expect(driverExpiryFindings(input, new Date("2026-11-11T08:00:00Z")).map((f) => f.dedupeKey)).toEqual(first);
    // Passage à l'échu : nouvelle clé.
    const expired = driverExpiryFindings(input, new Date("2026-11-13T08:00:00Z")).map((f) => f.dedupeKey);
    expect(expired).not.toEqual(first);
    // Renouvellement : nouvelle date, nouvelle clé.
    expect(driverDocumentDedupeKey(7, "license", "2028-11-12", "j30")).not.toBe(first[0]);
    expect(first[0]).toBe("driver_doc:license:j7:7:2026-11-12");
  });
});
