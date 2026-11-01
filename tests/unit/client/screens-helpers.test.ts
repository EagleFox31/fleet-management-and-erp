import { describe, expect, it } from "vitest";
import { formatRate, formatAverageCost } from "../../../client/src/components/dashboard/kpi-tiles";
import { ageInDays, sortByAgeDesc } from "../../../client/src/components/billing/pending-invoices-table";
import { daysOfMonth, cellKey } from "../../../client/src/components/time-tracking/time-grid";
import { formatBackupSize, formatBackupDuration } from "../../../client/src/components/admin/backups-panel";

describe("helpers des écrans", () => {
  it("un taux nul s'affiche comme un tiret", () => {
    expect(formatRate(null)).toBe("—");
    expect(formatAverageCost(null)).toBe("—");
    expect(formatRate(0)).not.toBe("—");
  });

  it("ageInDays compte des jours pleins et jamais négatifs", () => {
    const now = new Date("2026-11-02T08:00:00Z");
    expect(ageInDays("2026-10-02", now)).toBe(31);
    expect(ageInDays("2026-12-01", now)).toBe(0);
  });

  it("sortByAgeDesc place la plus ancienne en premier sans muter", () => {
    const rows = [
      { clientId: 1, oldestOperationDate: "2026-10-10" },
      { clientId: 2, oldestOperationDate: "2026-09-01" },
    ] as never[];
    const sorted = sortByAgeDesc(rows);
    expect((sorted[0] as { clientId: number }).clientId).toBe(2);
    expect((rows[0] as { clientId: number }).clientId).toBe(1);
  });

  it("daysOfMonth gère février bissextile et cellKey est stable", () => {
    expect(daysOfMonth(2028, 2)).toHaveLength(29);
    expect(daysOfMonth(2026, 11)[29]).toBe("2026-11-30");
    expect(cellKey(4, "2026-11-01")).toBe("4|2026-11-01");
  });

  it("formate taille et durée de sauvegarde", () => {
    expect(formatBackupSize(null)).toBe("—");
    expect(typeof formatBackupSize(1048576)).toBe("string");
    expect(typeof formatBackupDuration(65000)).toBe("string");
  });
});
