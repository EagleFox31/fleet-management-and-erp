import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseReportPeriod } from "../../../server/lib/report-period";
import {
  INVENTORY_REPORT_ROLES,
  TECHNICIAN_REPORT_ROLES,
  canReadInventoryReport,
  canReadTechnicianReport,
} from "../../../shared/constants/roles";

describe("parseReportPeriod", () => {
  it("refuse un jour qui n'existe pas au calendrier (2033-02-30)", () => {
    expect(() => parseReportPeriod({ startDate: "2033-02-30", endDate: "2033-03-31" })).toThrow(/invalide/);
    expect(() => parseReportPeriod({ startDate: "2033-02-01", endDate: "2033-02-30" })).toThrow(/invalide/);
  });

  it("accepte une date réelle et un 29 février bissextile", () => {
    const { startDate, endDate } = parseReportPeriod({ startDate: "2032-02-29", endDate: "2032-03-31" });
    expect(startDate.toISOString().slice(0, 10)).toBe("2032-02-29");
    expect(endDate.getTime()).toBeGreaterThan(startDate.getTime());
  });
});

describe("rôles des rapports : garde serveur et écran /reports", () => {
  it("logistique, chauffeur, technicien et client ne lisent aucun des deux rapports", () => {
    for (const role of ["logistics", "driver", "technician", "client"]) {
      expect(canReadInventoryReport(role)).toBe(false);
      expect(canReadTechnicianReport(role)).toBe(false);
    }
    expect(canReadInventoryReport("secretary")).toBe(true);
    expect(canReadTechnicianReport("secretary")).toBe(false);
  });

  it("les gardes et l'écran lisent la même source", () => {
    const root = path.resolve(__dirname, "../../..");
    const auth = readFileSync(path.join(root, "server/middleware/auth.ts"), "utf8");
    expect(auth).toContain("isInventoryReportReader = authorize([...INVENTORY_REPORT_ROLES])");
    expect(auth).toContain("isTechnicianReportReader = authorize([...TECHNICIAN_REPORT_ROLES])");
    const screen = readFileSync(path.join(root, "client/src/pages/reports/index.tsx"), "utf8");
    expect(screen).toMatch(/canReadInventoryReport\(user\?\.role\) \? \[\s*\{ value: "parts-inventory"/);
    expect(screen).toMatch(/canReadTechnicianReport\(user\?\.role\) \? \[\s*\{ value: "technician-performance"/);
    expect(INVENTORY_REPORT_ROLES).toEqual(expect.arrayContaining([...TECHNICIAN_REPORT_ROLES]));
  });
});
