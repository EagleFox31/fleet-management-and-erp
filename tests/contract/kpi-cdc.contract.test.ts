import { createServer, type Server } from "http";
import { eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { ALL_APP_ROLES, KPI_VIEWER_ROLES } from "../../shared/constants/roles";
import { EXPORTS_BASE_PATH } from "../../shared/contracts/exports";
import {
  avgCostPerInterventionResponseSchema,
  failuresResponseSchema,
  KPI_AVG_COST_PER_INTERVENTION_PATH,
  KPI_FAILURES_PATH,
  KPI_INCIDENTS_PER_MONTH_PATH,
  KPI_MAINTENANCE_COSTS_PATH,
  KPI_PREVENTIVE_COMPLIANCE_PATH,
  maintenanceCostsResponseSchema,
  preventiveComplianceResponseSchema,
} from "../../shared/contracts/kpi";
import {
  WORKSHOP_LABOR_RATES_PATH,
  workshopLaborRateSchema,
  workshopLaborRatesResponseSchema,
} from "../../shared/contracts/workshop-labor-rates";
import { workshopLaborRates } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";

/**
 * Niveau C, CDC #7 : indicateurs du cahier (rôles, formes), taux horaires, rapports exportables.
 *
 * Écrit en base (comptes TEST*, un taux daté 2099-12-31 retiré à la fin) : à ne jouer que sur
 * une base isolée. Les drapeaux `maintenance-report`, `exports` et `kpi-reports` sont posés
 * par le test puis restaurés.
 */
const RATE_DATE = "2099-12-31";
const previousFlags = process.env.FEATURE_FLAGS;
let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<string, string>();
/** Tous les rôles du schéma : un rôle ajouté plus tard est contrôlé sans retoucher ce test. */
const ROLES = ALL_APP_ROLES;

async function login(role: string) {
  const user = await createTestUser({ role: role as TestUserRole });
  ids.userIds.push(user.id);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  cookies.set(role, res.headers.get("set-cookie")!.split(";")[0]);
  return user;
}

async function call(method: string, path: string, role?: string, body?: unknown) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(role ? { Cookie: cookies.get(role)! } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const buffer = Buffer.from(await res.arrayBuffer());
  let json: unknown = null;
  try {
    json = JSON.parse(buffer.toString("utf8"));
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, buffer, body: json as any };
}

let adminId = 0;

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  for (const role of ROLES) {
    const user = await login(role);
    if (role === "admin") adminId = user.id;
  }
  await db.delete(workshopLaborRates).where(eq(workshopLaborRates.effectiveFrom, RATE_DATE));
}, 180000);

afterAll(async () => {
  if (previousFlags === undefined) delete process.env.FEATURE_FLAGS;
  else process.env.FEATURE_FLAGS = previousFlags;
  await db.delete(workshopLaborRates).where(eq(workshopLaborRates.effectiveFrom, RATE_DATE));
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

const ALLOWED = ["admin", "management", "workshop_manager"] as const;
/** Tous les autres rôles : technicien et client, mais aussi chauffeur, secrétariat, logistique, magasin… */
const DENIED = ALL_APP_ROLES.filter((role) => !(ALLOWED as readonly string[]).includes(role));

describe("rôles des indicateurs", () => {
  it("les lecteurs des indicateurs sont exactement direction, admin et chef d'atelier", () => {
    expect([...KPI_VIEWER_ROLES].sort()).toEqual([...ALLOWED].sort());
  });

  it("les rôles refusés couvrent chauffeur, secrétariat, logistique et magasin", () => {
    expect(DENIED).toEqual(expect.arrayContaining(["driver", "secretary", "logistics", "warehouse", "technician", "client"]));
  });
});

const PATHS = [
  KPI_INCIDENTS_PER_MONTH_PATH,
  KPI_FAILURES_PATH,
  KPI_PREVENTIVE_COMPLIANCE_PATH,
  KPI_AVG_COST_PER_INTERVENTION_PATH,
  KPI_MAINTENANCE_COSTS_PATH,
];

describe("/api/kpi/* : rôles", { timeout: 120000 }, () => {
  it.each(PATHS)("%s : 401 sans session, 403 pour tout rôle hors lecteurs, 200 direction, admin et chef d'atelier", async (path) => {
    const q = "?from=2001-01-01&to=2001-12-31";
    expect((await call("GET", path + q)).status).toBe(401);
    for (const role of DENIED) expect((await call("GET", path + q, role)).status, role).toBe(403);
    for (const role of ALLOWED) expect((await call("GET", path + q, role)).status, role).toBe(200);
  });
});

describe("/api/kpi/* : formes et erreurs", { timeout: 120000 }, () => {
  const q = "?from=2001-01-01&to=2001-12-31";

  it("pannes : tous les mois de la période, zéros compris", async () => {
    const res = await call("GET", KPI_FAILURES_PATH + q, "workshop_manager");
    expect(failuresResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.series).toHaveLength(12);
    expect(res.body.total).toBe(0);
    expect(res.body.monthlyAverage).toBe(0);
  });

  it("préventif : formes du contrat et fenêtre arrêtée à la veille", async () => {
    const res = await call("GET", KPI_PREVENTIVE_COMPLIANCE_PATH + q, "management");
    expect(preventiveComplianceResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.rate).toBeNull();
    // Fenêtre qui déborde dans le futur, sous la limite de 36 mois de `kpi-period.ts`.
    const year = new Date().getUTCFullYear();
    const futureEnd = `${year + 2}-01-01`;
    const future = await call("GET", `${KPI_PREVENTIVE_COMPLIANCE_PATH}?from=${year}-01-01&to=${futureEnd}`, "admin");
    expect(future.status).toBe(200);
    expect(future.body.periodEnd < futureEnd).toBe(true);
  });

  it("coût moyen et ventilations : formes du contrat", async () => {
    const avg = await call("GET", KPI_AVG_COST_PER_INTERVENTION_PATH + q, "admin");
    expect(avgCostPerInterventionResponseSchema.safeParse(avg.body).success).toBe(true);
    for (const groupBy of ["type", "vehicle"]) {
      const res = await call("GET", `${KPI_MAINTENANCE_COSTS_PATH}${q}&groupBy=${groupBy}`, "workshop_manager");
      expect(maintenanceCostsResponseSchema.safeParse(res.body).success).toBe(true);
      expect(res.body.groupBy).toBe(groupBy);
    }
    const byType = await call("GET", `${KPI_MAINTENANCE_COSTS_PATH}${q}`, "admin");
    expect(byType.body.groupBy).toBe("type");
    expect(byType.body.groups.map((g: { key: string }) => g.key)).toEqual(["preventive", "corrective"]);
  });

  it("période inversée, date mal formée ou regroupement inconnu : 400 sans détail technique", async () => {
    const bad = [
      `${KPI_FAILURES_PATH}?from=2021-01-01&to=2020-01-01`,
      `${KPI_PREVENTIVE_COMPLIANCE_PATH}?from=hier`,
      `${KPI_MAINTENANCE_COSTS_PATH}?groupBy=chauffeur`,
      `${KPI_MAINTENANCE_COSTS_PATH}?from=2021-01-01&to=2020-01-01`,
      // Période démesurée ou date hors calendrier : refusées avant tout calcul (plus de 500).
      `${KPI_FAILURES_PATH}?from=2001-01-01&to=9999-12-30`,
      `${KPI_PREVENTIVE_COMPLIANCE_PATH}?to=2026-02-31`,
      `${KPI_MAINTENANCE_COSTS_PATH}?from=2020-01-01&to=2023-01-31`,
    ];
    for (const path of bad) {
      const res = await call("GET", path, "management");
      expect(res.status, path).toBe(400);
      expect(res.body).toMatchObject({ code: expect.any(String), message: expect.any(String) });
      expect(res.body.message).not.toMatch(/zod|invalid_type|stack|select /i);
    }
  });
});

describe("/api/workshop-labor-rates", { timeout: 120000 }, () => {
  it("drapeau coupé : 404, même pour l'administrateur", async () => {
    delete process.env.FEATURE_FLAGS;
    expect((await call("GET", WORKSHOP_LABOR_RATES_PATH, "admin")).status).toBe(404);
  });

  it("administrateur seul : 401 sans session, 403 pour les autres rôles", async () => {
    process.env.FEATURE_FLAGS = "maintenance-report=on";
    expect((await call("GET", WORKSHOP_LABOR_RATES_PATH)).status).toBe(401);
    for (const role of ALL_APP_ROLES.filter((r) => r !== "admin")) {
      expect((await call("GET", WORKSHOP_LABOR_RATES_PATH, role)).status, role).toBe(403);
      expect((await call("POST", WORKSHOP_LABOR_RATES_PATH, role, { effectiveFrom: RATE_DATE, hourlyRateHt: 5000 })).status, role).toBe(403);
    }
  });

  it("crée un taux daté (201, created_by = auteur), le liste, refuse la même date en 409", async () => {
    process.env.FEATURE_FLAGS = "maintenance-report=on";
    const created = await call("POST", WORKSHOP_LABOR_RATES_PATH, "admin", { effectiveFrom: RATE_DATE, hourlyRateHt: 5000 });
    expect(created.status).toBe(201);
    expect(workshopLaborRateSchema.safeParse(created.body).success).toBe(true);
    expect(created.body).toMatchObject({ effectiveFrom: RATE_DATE, hourlyRateHt: 5000, createdBy: adminId });

    const list = await call("GET", WORKSHOP_LABOR_RATES_PATH, "admin");
    expect(list.status).toBe(200);
    expect(workshopLaborRatesResponseSchema.safeParse(list.body).success).toBe(true);
    expect(list.body.some((r: { id: number }) => r.id === created.body.id)).toBe(true);

    const dup = await call("POST", WORKSHOP_LABOR_RATES_PATH, "admin", { effectiveFrom: RATE_DATE, hourlyRateHt: 6000 });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toMatch(/date d'effet/);
    expect(dup.body.message).not.toMatch(/constraint|workshop_labor_rates|duplicate key/i);
  });

  it("taux négatif, date absente ou mal formée : 400", async () => {
    process.env.FEATURE_FLAGS = "maintenance-report=on";
    for (const body of [
      { effectiveFrom: "2099-01-01", hourlyRateHt: -1 },
      { hourlyRateHt: 5000 },
      { effectiveFrom: "demain", hourlyRateHt: 5000 },
      { effectiveFrom: "2099-01-01", hourlyRateHt: "beaucoup" },
    ]) {
      const res = await call("POST", WORKSHOP_LABOR_RATES_PATH, "admin", body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });
});

describe("/api/exports/kpi-report", { timeout: 180000 }, () => {
  const path = `${EXPORTS_BASE_PATH}/kpi-report`;
  const range = "from=2001-01-01&to=2001-03-31";

  it("drapeau kpi-reports coupé : 404", async () => {
    process.env.FEATURE_FLAGS = "exports=on";
    expect((await call("GET", `${path}?${range}`, "admin")).status).toBe(404);
  });

  it("drapeaux allumés : 401 sans session, 403 pour tout rôle hors lecteurs, 200 direction, admin et chef d'atelier", async () => {
    process.env.FEATURE_FLAGS = "exports=on,kpi-reports=on";
    expect((await call("GET", `${path}?${range}`)).status).toBe(401);
    for (const role of DENIED) expect((await call("GET", `${path}?${range}`, role)).status, role).toBe(403);
    for (const role of ALLOWED) expect((await call("GET", `${path}?${range}`, role)).status, role).toBe(200);
  });

  it("Excel par défaut : cinq feuilles lisibles, nom de fichier en pièce jointe", async () => {
    process.env.FEATURE_FLAGS = "exports=on,kpi-reports=on";
    const res = await call("GET", `${path}?period=quarter&${range}`, "workshop_manager");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/spreadsheetml\.sheet/);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="rapport_kpi_trimestriel_[A-Za-z0-9_.-]+\.xlsx"$/);
    const wb = XLSX.read(res.buffer, { type: "buffer" });
    expect(wb.SheetNames).toEqual(["Synthèse", "Pannes par mois", "Pannes par véhicule", "Coûts par type", "Coûts par véhicule"]);
  });

  it("PDF sur demande", async () => {
    process.env.FEATURE_FLAGS = "exports=on,kpi-reports=on";
    const res = await call("GET", `${path}?period=month&format=pdf&${range}`, "management");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/pdf/);
    expect(res.buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(res.headers.get("content-disposition")).toMatch(/\.pdf"$/);
  });

  it("sans période : dernier mois terminé ; paramètres invalides : 400", async () => {
    process.env.FEATURE_FLAGS = "exports=on,kpi-reports=on";
    expect((await call("GET", path, "admin")).status).toBe(200);
    for (const q of [
      "format=csv",
      "period=annee",
      "from=2021-01-01&to=2020-01-01",
      "from=hier",
      "from=2001-01-01&to=9999-12-30",
      "to=2026-02-31",
    ]) {
      const res = await call("GET", `${path}?${q}`, "admin");
      expect(res.status, q).toBe(400);
      expect(res.body).toMatchObject({ code: expect.any(String), message: expect.any(String) });
    }
  });
});
