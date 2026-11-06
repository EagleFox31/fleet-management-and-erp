import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  addDays,
  averageCost,
  classifyPreventive,
  effectiveDueDate,
  fillMonthSeries,
  groupCosts,
  isoDateInZone,
  laborRateAt,
  monthKeysBetween,
  monthlyAverage,
  parseToleranceDays,
  preventiveDueDay,
  preventiveWindowEnd,
  resolveKpiWindow,
  resolveReportPeriod,
  summarizePreventive,
  workOrderCost,
} from "../../../server/lib/kpi-rules";
import { formatReportCell, renderReport, sheetName, type ReportDefinition } from "../../../server/lib/report-export";
import { buildKpiReport, type KpiReportData } from "../../../server/lib/kpi-report-definition";
import { maintenanceCostsQuerySchema } from "../../../shared/contracts/kpi";
import { EXPORT_ROLE_MATRIX, kpiReportQuerySchema } from "../../../shared/contracts/exports";
import { KPI_VIEWER_ROLES } from "../../../shared/constants/roles";

describe("fuseau Africa/Douala", () => {
  it("lit le jour calendaire de Douala, pas celui de l'UTC", () => {
    // 23:30 UTC = 00:30 le lendemain à Douala (UTC+1)
    expect(isoDateInZone(new Date("2026-10-31T23:30:00Z"))).toBe("2026-11-01");
    expect(isoDateInZone(new Date("2026-10-31T22:59:00Z"))).toBe("2026-10-31");
  });

  it("sans période : 12 mois calendaires dont le mois en cours", () => {
    const w = resolveKpiWindow({}, new Date("2026-10-31T10:00:00Z"));
    expect(w).toEqual({ from: "2025-11-01", to: "2026-10-31", toExclusive: "2026-11-01" });
  });

  it("respecte une période demandée", () => {
    expect(resolveKpiWindow({ from: "2026-01-15", to: "2026-02-10" }).toExclusive).toBe("2026-02-11");
  });
});

describe("pannes : série et moyenne", () => {
  it("liste tous les mois, y compris les mois à zéro", () => {
    expect(monthKeysBetween("2026-01-20", "2026-04-02")).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
    const rows = [{ month: "2026-01", count: 3 }, { month: "2026-04", count: 1 }, { month: "2025-12", count: 9 }];
    expect(fillMonthSeries(rows, "2026-01-01", "2026-04-30")).toEqual([
      { month: "2026-01", count: 3 },
      { month: "2026-02", count: 0 },
      { month: "2026-03", count: 0 },
      { month: "2026-04", count: 1 },
    ]);
  });

  it("moyenne = total / nombre de mois de la période (zéros compris)", () => {
    expect(monthlyAverage(4, 4)).toBe(1);
    expect(monthlyAverage(3, 12)).toBe(0.25);
    expect(monthlyAverage(10, 3)).toBe(3.33);
    expect(monthlyAverage(5, 0)).toBe(0);
  });

  it("une période inversée ne produit aucun mois", () => {
    expect(monthKeysBetween("2026-05-01", "2026-04-01")).toEqual([]);
  });
});

describe("préventif : échéance, tolérance, retard", () => {
  it("l'échéance figée l'emporte sur la date de début", () => {
    expect(effectiveDueDate("2026-03-10", "2026-03-25")).toBe("2026-03-10");
    expect(effectiveDueDate(null, "2026-03-25")).toBe("2026-03-25");
    expect(effectiveDueDate(null, null)).toBeNull();
  });

  it("rien n'est échu aujourd'hui : la fenêtre s'arrête à la veille (Douala)", () => {
    const today = isoDateInZone(new Date("2026-10-31T23:30:00Z")); // 1er novembre à Douala
    expect(preventiveWindowEnd("2026-12-31", today)).toBe("2026-10-31");
    expect(preventiveWindowEnd("2026-10-15", today)).toBe("2026-10-15");
  });

  it("réalisé à temps = clos au plus tard à l'échéance (tolérance 0)", () => {
    expect(classifyPreventive({ status: "completed", due: "2026-03-10", doneOn: "2026-03-10" })).toBe("onTime");
    expect(classifyPreventive({ status: "completed", due: "2026-03-10", doneOn: "2026-03-11" })).toBe("late");
  });

  it("la tolérance repousse la limite de N jours", () => {
    const occ = { status: "completed", due: "2026-03-10", doneOn: "2026-03-12" };
    expect(classifyPreventive(occ, 1)).toBe("late");
    expect(classifyPreventive(occ, 2)).toBe("onTime");
  });

  it("annulé compte comme non réalisé, ouvert comme en retard", () => {
    expect(classifyPreventive({ status: "cancelled", due: "2026-03-10", doneOn: null })).toBe("cancelled");
    expect(classifyPreventive({ status: "pending", due: "2026-03-10", doneOn: null })).toBe("late");
    expect(classifyPreventive({ status: "completed", due: "2026-03-10", doneOn: null })).toBe("late");
  });

  it("le dénominateur compte annulés et planifications sans OT", () => {
    const s = summarizePreventive(
      [
        { status: "completed", due: "2026-03-10", doneOn: "2026-03-09" },
        { status: "completed", due: "2026-03-11", doneOn: "2026-03-20" },
        { status: "cancelled", due: "2026-03-12", doneOn: null },
        { status: "pending", due: "2026-03-13", doneOn: null },
      ],
      1,
    );
    expect(s).toEqual({ planned: 5, doneOnTime: 1, rate: 0.2, late: 3, cancelled: 1, withoutWorkOrder: 1 });
  });

  it("aucune échéance : taux nul (null), pas zéro", () => {
    expect(summarizePreventive([], 0).rate).toBeNull();
  });

  it("tolérance lue dans l'environnement : entière, bornée, 0 si illisible", () => {
    expect(parseToleranceDays(undefined)).toBe(0);
    expect(parseToleranceDays("")).toBe(0);
    expect(parseToleranceDays("3")).toBe(3);
    expect(parseToleranceDays("-2")).toBe(0);
    expect(parseToleranceDays("1.5")).toBe(0);
    expect(parseToleranceDays("abc")).toBe(0);
    expect(parseToleranceDays("400")).toBe(30);
  });

  it("l'échéance posée à la génération suit la date d'expiration, lue à Douala", () => {
    expect(preventiveDueDay("2026-12-05")).toBe("2026-12-05");
    expect(preventiveDueDay(new Date("2026-12-05T00:00:00Z"))).toBe("2026-12-05");
    expect(preventiveDueDay(null, new Date("2026-10-31T23:30:00Z"))).toBe("2026-11-01");
    expect(preventiveDueDay("n'importe quoi", new Date("2026-10-31T10:00:00Z"))).toBe("2026-10-31");
  });

  it("addDays traverse les fins de mois et d'année", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("coût d'une intervention", () => {
  const rates = [
    { effectiveFrom: "2026-01-01", hourlyRateHt: 5000 },
    { effectiveFrom: "2026-06-01", hourlyRateHt: 6000 },
  ];

  it("prend le taux au plus grand effective_from inférieur ou égal à la date", () => {
    expect(laborRateAt(rates, "2025-12-31")).toBeNull();
    expect(laborRateAt(rates, "2026-01-01")).toBe(5000);
    expect(laborRateAt(rates, "2026-05-31")).toBe(5000);
    expect(laborRateAt(rates, "2026-06-01")).toBe(6000);
    expect(laborRateAt([], "2026-06-01")).toBeNull();
  });

  it("valorise les heures réelles quand un taux existe, sinon garde le coût saisi", () => {
    expect(workOrderCost({ cost: 1000, hours: 2.5, rate: 6000, parts: 3000, tires: 0 })).toEqual({
      labor: 15000, parts: 3000, tires: 0, total: 18000, laborMissing: false,
    });
    expect(workOrderCost({ cost: 10000, hours: 2, rate: null, parts: 3000, tires: 0 })).toEqual({
      labor: 10000, parts: 3000, tires: 0, total: 13000, laborMissing: false,
    });
    // heures sans saisie ni taux : main-d'oeuvre manquante
    expect(workOrderCost({ cost: 0, hours: 2, rate: null, parts: 500, tires: 0 }).laborMissing).toBe(true);
  });

  it("ajoute les rotations de pneus, comme l'écran et le PDF de l'OT (WO5)", () => {
    expect(workOrderCost({ cost: 0, hours: 2, rate: 5000, parts: 3000, tires: 2500 })).toEqual({
      labor: 10000, parts: 3000, tires: 2500, total: 15500, laborMissing: false,
    });
  });

  it("jamais de double comptage : cost et heures ne s'additionnent pas", () => {
    expect(workOrderCost({ cost: 10000, hours: 1, rate: 5000, parts: 0, tires: 0 }).total).toBe(5000);
  });

  it("arrondit au FCFA par composante : labor + parts + tires = total", () => {
    const c = workOrderCost({ cost: 0, hours: 1.333, rate: 5000, parts: 100.4, tires: 49.6 });
    expect(c.labor).toBe(6665);
    expect(c.parts).toBe(100);
    expect(c.tires).toBe(50);
    expect(c.total).toBe(c.labor + c.parts + c.tires);
  });

  it("ventile par groupe, moyenne arrondie, null si vide", () => {
    const row = (key: string, total: number, isPreventive: boolean) => ({
      key, label: key.toUpperCase(), isPreventive, labor: total, parts: 0, tires: 0, total, laborMissing: false,
    });
    const groups = groupCosts([row("a", 10000, true), row("a", 5000, false), row("b", 2000, false)], (r) => ({ key: r.key, label: r.label }));
    expect(groups).toEqual([
      { key: "a", label: "A", interventions: 2, totalCost: 15000, averageCost: 7500 },
      { key: "b", label: "B", interventions: 1, totalCost: 2000, averageCost: 2000 },
    ]);
    expect(averageCost(38000, 3)).toBe(12667);
    expect(averageCost(0, 0)).toBeNull();
  });
});

describe("période d'un rapport", () => {
  const now = new Date("2026-10-31T10:00:00Z");

  it("sans date : la dernière période terminée", () => {
    expect(resolveReportPeriod("month", {}, now)).toEqual({ kind: "month", from: "2026-09-01", to: "2026-09-30", label: "Septembre 2026" });
    expect(resolveReportPeriod("quarter", {}, now)).toEqual({ kind: "quarter", from: "2026-07-01", to: "2026-09-30", label: "T3 2026" });
    expect(resolveReportPeriod("quarter", {}, new Date("2026-02-10T10:00:00Z"))).toMatchObject({ from: "2025-10-01", to: "2025-12-31", label: "T4 2025" });
  });

  it("une seule date : la période calendaire qui la contient", () => {
    expect(resolveReportPeriod("month", { from: "2026-02-14" }, now)).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    expect(resolveReportPeriod("quarter", { to: "2026-05-02" }, now)).toMatchObject({ from: "2026-04-01", to: "2026-06-30", label: "T2 2026" });
  });

  it("deux dates : exactement cette fenêtre", () => {
    expect(resolveReportPeriod("month", { from: "2026-03-05", to: "2026-03-20" }, now)).toEqual({
      kind: "month", from: "2026-03-05", to: "2026-03-20", label: "2026-03-05 au 2026-03-20",
    });
    expect(resolveReportPeriod("month", { from: "2026-03-01", to: "2026-03-31" }, now).label).toBe("Mars 2026");
  });
});

describe("contrats", () => {
  it("le chef d'atelier lit les indicateurs, comme la direction et l'administrateur", () => {
    expect([...KPI_VIEWER_ROLES].sort()).toEqual(["admin", "management", "workshop_manager"]);
    expect(EXPORT_ROLE_MATRIX["kpi-report"]).toBe(KPI_VIEWER_ROLES);
  });

  it("requête de coûts : groupBy type par défaut, période cohérente", () => {
    expect(maintenanceCostsQuerySchema.parse({}).groupBy).toBe("type");
    expect(maintenanceCostsQuerySchema.safeParse({ groupBy: "driver" }).success).toBe(false);
    expect(maintenanceCostsQuerySchema.safeParse({ from: "2026-05-01", to: "2026-04-01" }).success).toBe(false);
  });

  it("requête de rapport : mensuel et Excel par défaut", () => {
    expect(kpiReportQuerySchema.parse({})).toEqual({ period: "month", format: "xlsx" });
    expect(kpiReportQuerySchema.safeParse({ format: "csv" }).success).toBe(false);
    expect(kpiReportQuerySchema.safeParse({ period: "year" }).success).toBe(false);
  });
});

describe("export de rapport", () => {
  const def: ReportDefinition = {
    title: "Rapport de test",
    subtitle: "Période du 2026-09-01 au 2026-09-30",
    sections: [
      {
        title: "Coûts par type",
        columns: [
          { header: "Type", key: "label" },
          { header: "Interventions", key: "n", kind: "integer" },
          { header: "Coût total", key: "total", kind: "amount" },
          { header: "Part", key: "share", kind: "percent" },
        ],
        rows: [
          { label: "Préventif", n: 2, total: 1234567, share: 0.6667 },
          { label: "Correctif", n: 0, total: 0, share: null },
        ],
        note: "Montants HT.",
      },
    ],
  };

  it("formate les valeurs sans espace insécable ni zéro inventé", () => {
    expect(formatReportCell(1234567, "amount")).toBe("1 234 567");
    expect(formatReportCell(0.6667, "percent")).toBe("66,7 %");
    expect(formatReportCell(1234.5, "decimal")).toBe("1 234,50");
    expect(formatReportCell(null, "amount")).toBe("-");
    expect(formatReportCell("texte")).toBe("texte");
  });

  it("produit un classeur lisible : en-têtes, nombres typés, cellule vide pour null", () => {
    const buf = renderReport(def, "xlsx");
    const wb = XLSX.read(buf, { type: "buffer" });
    expect(wb.SheetNames).toEqual(["Coûts par type"]);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Coûts par type"], { header: 1, defval: null });
    expect(rows[3]).toEqual(["Type", "Interventions", "Coût total", "Part"]);
    expect(rows[4]).toEqual(["Préventif", 2, 1234567, 0.6667]);
    expect(rows[5]).toEqual(["Correctif", 0, 0, null]);
  });

  it("produit un PDF", () => {
    const buf = renderReport(def, "pdf");
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("rend un classeur valide même sans section", () => {
    const wb = XLSX.read(renderReport({ title: "Vide", sections: [] }, "xlsx"), { type: "buffer" });
    expect(wb.SheetNames).toHaveLength(1);
  });

  it("nomme les feuilles sans caractère interdit, sans doublon, en 31 caractères", () => {
    const used = new Set<string>();
    expect(sheetName("Coûts / véhicule [2026]", used)).toBe("Coûts véhicule 2026");
    expect(sheetName("Coûts / véhicule [2026]", used)).toBe("Coûts véhicule 2026 2");
    expect(sheetName("x".repeat(50), used)).toHaveLength(31);
  });

  it("assemble le rapport des indicateurs avec ses cinq sections", () => {
    const data: KpiReportData = {
      period: { kind: "month", from: "2026-09-01", to: "2026-09-30", label: "Septembre 2026" },
      failures: { from: "2026-09-01", to: "2026-09-30", months: 1, total: 2, monthlyAverage: 2, series: [{ month: "2026-09", count: 2 }], byVehicle: [{ vehicleId: 1, registrationNumber: "AA-111-BB", count: 2 }] },
      preventive: { planned: 4, doneOnTime: 3, rate: 0.75, late: 1, cancelled: 0, withoutWorkOrder: 0, toleranceDays: 0, periodEnd: "2026-09-30" },
      cost: { interventions: 2, totalCost: 30000, averageCost: 15000, laborValued: false, laborTotal: 20000, partsTotal: 10000, missingCostCount: 0 },
      costByType: { groupBy: "type", laborValued: false, missingCostCount: 0, total: { interventions: 2, totalCost: 30000, averageCost: 15000 }, groups: [] },
      costByVehicle: { groupBy: "vehicle", laborValued: false, missingCostCount: 0, total: { interventions: 2, totalCost: 30000, averageCost: 15000 }, groups: [] },
    };
    const def2 = buildKpiReport(data);
    expect(def2.title).toContain("mensuel");
    expect(def2.sections.map((s) => s.title)).toEqual(["Synthèse", "Pannes par mois", "Pannes par véhicule", "Coûts par type", "Coûts par véhicule"]);
    expect(def2.sections[0].note).toContain("Aucun taux horaire");
    expect(renderReport(def2, "xlsx").length).toBeGreaterThan(0);
    expect(renderReport(def2, "pdf").length).toBeGreaterThan(0);
  });
});
