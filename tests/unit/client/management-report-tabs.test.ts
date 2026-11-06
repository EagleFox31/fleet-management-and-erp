import { describe, expect, it } from "vitest";
import { defaultFeatureFlags, resolveClientFeatureFlags } from "@/hooks/use-feature";
import {
  DEFAULT_REPORT_TAB,
  REPORT_TAB_DEFS,
  reportTabForLocation,
  visibleReportTabs,
} from "@/lib/management-report-tabs";

/**
 * Onglets de /management/reports : mêmes drapeaux que la barre latérale.
 *
 * Constat : « Trésorerie & Recouvrement » (finance) et « Distribution & Envois »
 * (report-schedules) restaient affichés drapeaux éteints, alors que le menu les masquait.
 */
const off = resolveClientFeatureFlags({ finance: false, "report-schedules": false });
const on = resolveClientFeatureFlags({ finance: true, "report-schedules": true });

describe("onglets des rapports de direction", () => {
  it("drapeaux éteints : les onglets finance et envois sont absents", () => {
    const values = visibleReportTabs(REPORT_TAB_DEFS, off).map((t) => t.value);
    expect(values).toEqual(["board_pack", "fleet", "drivers"]);
  });

  it("drapeaux allumés : les cinq onglets sont présents", () => {
    expect(visibleReportTabs(REPORT_TAB_DEFS, on)).toHaveLength(5);
  });

  it("défauts du catalogue (avant la réponse du serveur) : finance et envois masqués", () => {
    const values = visibleReportTabs(REPORT_TAB_DEFS, defaultFeatureFlags()).map((t) => t.value);
    expect(values).not.toContain("finance");
    expect(values).not.toContain("scheduled");
  });

  it("URL directe vers un onglet masqué : retombe sur l'onglet par défaut", () => {
    expect(reportTabForLocation("/management/reports/finance", off)).toBe(DEFAULT_REPORT_TAB);
    expect(reportTabForLocation("/management/reports/scheduled", off)).toBe(DEFAULT_REPORT_TAB);
  });

  it("l'onglet affiché fait toujours partie des onglets visibles", () => {
    for (const flags of [off, on]) {
      const visible = visibleReportTabs(REPORT_TAB_DEFS, flags).map((t) => t.value);
      for (const tab of REPORT_TAB_DEFS) {
        expect(visible).toContain(reportTabForLocation(tab.path, flags));
      }
      expect(visible).toContain(reportTabForLocation("/management/reports", flags));
    }
  });

  it("URL directe drapeau allumé, ou onglet sans drapeau : l'onglet demandé", () => {
    expect(reportTabForLocation("/management/reports/finance", on)).toBe("finance");
    expect(reportTabForLocation("/management/reports/scheduled", on)).toBe("scheduled");
    expect(reportTabForLocation("/management/reports/fleet", off)).toBe("fleet");
    expect(reportTabForLocation("/management/reports/drivers", off)).toBe("drivers");
    expect(reportTabForLocation("/management/reports", off)).toBe("board_pack");
  });
});
