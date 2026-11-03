import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { vehicles } from "../../../shared/schema";
import { getMissionEligibility } from "../../../shared/constants/vehicle-eligibility";
import { classifyDocumentExpiry } from "../../../server/services/document-expiry-rule";

/**
 * P3-2, garde-fou « une règle, une source » : le jour de l'échéance.
 *
 * Règle métier décidée : un document dont l'échéance est AUJOURD'HUI est expiré
 * (lancement de mission bloqué) ; la veille de l'échéance il ne l'est pas ; le
 * lendemain il l'est. Trois emplacements la portent :
 *   - `getMissionEligibility` (shared) : le jour J bloque, conforme ;
 *   - `isDateExpired` de `vehicle-documentation-service.ts` (privée, testée par
 *     `getAllVehiclesWithDocStatus`, `getDocumentStats`, `getExpiredDocuments`) ;
 *   - `classifyDocumentExpiry` (alertes des documents typés).
 *
 * État constaté à l'écriture : les deux derniers rendent « pas expiré » au jour J
 * (comparaison stricte `<` / `days < 0`). Les tests de la règle qu'ils violent sont
 * posés en `it.fails` : verts tant que le défaut existe, ROUGES à la correction, ce
 * qui oblige à retirer le `.fails` (le test devient alors le garde-fou ordinaire).
 * Le défaut se corrige côté produit, pas ici.
 *
 * Référence temporelle : le service et `classifyDocumentExpiry` comptent en date UTC
 * (`toISOString().slice(0, 10)`), l'éligibilité en date LOCALE (accesseurs `getDate`...).
 * Pour ne pas dépendre de la machine, le fichier fixe le fuseau à Africa/Douala (UTC+1,
 * sans heure d'été) et le restaure ensuite ; l'éligibilité reçoit des `Date` construites
 * en local. D4 (divergence UTC / local entre les deux sources) en découle : voir plus bas.
 */

const dbState = vi.hoisted(() => ({ vehicleRows: [] as Record<string, unknown>[], vehiclesTable: undefined as unknown }));
vi.mock("../../../server/db", () => {
  const rowsFor = (table: unknown) => (table === dbState.vehiclesTable ? dbState.vehicleRows : []);
  return {
    db: {
      select: () => ({
        from: (table: unknown) => {
          const rows = rowsFor(table);
          return Object.assign(Promise.resolve(rows), { where: () => Promise.resolve(rows) });
        },
      }),
    },
  };
});

dbState.vehiclesTable = vehicles;

import { VehicleDocumentationService } from "../../../server/services/vehicle-documentation-service";

const NOW = "2026-11-03T10:00:00.000Z";
const TODAY = "2026-11-03";

/** Date `YYYY-MM-DD` décalée de `days` jours par rapport à TODAY (UTC). */
function offset(days: number): string {
  const d = new Date(`${TODAY}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const service = new VehicleDocumentationService();

function seed(insuranceExpiry: string | Date | null) {
  dbState.vehicleRows = [
    { id: 1, registrationNumber: "TEST-1", ownerId: null, insuranceExpiry, licensePlateExpiry: null, technicalInspectionDate: null },
  ];
}

const assuranceStatus = async () => (await service.getAllVehiclesWithDocStatus())[0].documentStatus.assurance;

/** Verdict « expiré » de chaque source pour une assurance échéant à `expiry`. */
async function verdicts(expiry: string) {
  seed(expiry);
  const today = new Date();
  return {
    eligibility: getMissionEligibility({ insuranceExpiry: localDate(expiry) }, localDate(TODAY, 10)).blockers.some((b) => b.code === "insurance"),
    status: (await assuranceStatus()) === "expired",
    stats: (await service.getDocumentStats()).expiredAssurance === 1,
    list: (await service.getExpiredDocuments()).length === 1,
    rule: classifyDocumentExpiry(expiry, today).status === "expired",
  };
}

const INITIAL_TZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "Africa/Douala";
});
afterAll(() => {
  if (INITIAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = INITIAL_TZ;
});

/** Date locale (minuit) du jour calendaire `YYYY-MM-DD` : ce que lit l'éligibilité, quel que soit le fuseau. */
function localDate(dateOnly: string, hour = 0): Date {
  const [y, m, d] = dateOnly.split("-").map(Number);
  return new Date(y, m - 1, d, hour);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("jour J : éligibilité mission (règle de référence)", () => {
  it.each([
    [1, false, "la veille de l'échéance (échéance demain)"],
    [0, true, "le jour de l'échéance"],
    [-1, true, "le lendemain de l'échéance (échéance hier)"],
  ])("échéance dans %i jour(s) -> bloquant=%s (%s)", (days, blocked) => {
    const result = getMissionEligibility({ insuranceExpiry: localDate(offset(days)) }, localDate(TODAY, 10));
    expect(result.blockers.some((b) => b.code === "insurance")).toBe(blocked);
  });
});

describe("jour J : vehicle-documentation-service (isDateExpired, privée)", () => {
  it("la veille de l'échéance (échéance demain) : valide, pas expiré", async () => {
    const v = await verdicts(offset(1));
    expect([v.status, v.stats, v.list]).toEqual([false, false, false]);
  });

  it("le lendemain de l'échéance (échéance hier) : expiré partout", async () => {
    const v = await verdicts(offset(-1));
    expect([v.status, v.stats, v.list]).toEqual([true, true, true]);
  });

  // Défaut connu : `dateOnly < today` laisse passer l'échéance du jour.
  it.fails("le jour de l'échéance : expiré (statut, statistiques, liste)", async () => {
    const v = await verdicts(offset(0));
    expect([v.status, v.stats, v.list]).toEqual([true, true, true]);
  });

  it("frontière de fuseau : la date de référence bascule à minuit UTC, pas avant", async () => {
    seed("2026-11-04");
    // 23:59:59Z le 3 : l'échéance du 4 est encore dans le futur.
    vi.setSystemTime(new Date("2026-11-03T23:59:59.000Z"));
    expect(await assuranceStatus()).not.toBe("expired");
    // Deux jours plus tard : échue sans ambiguïté.
    vi.setSystemTime(new Date("2026-11-05T00:00:00.000Z"));
    expect(await assuranceStatus()).toBe("expired");
  });

  it("une date reçue en horodatage ISO ou en Date compte comme sa date calendaire", async () => {
    seed("2026-11-02T23:30:00.000Z");
    expect(await assuranceStatus()).toBe("expired");
    seed(new Date("2026-12-31T00:00:00.000Z"));
    expect(await assuranceStatus()).not.toBe("expired");
  });
});

describe("jour J : classifyDocumentExpiry (documents typés)", () => {
  it("la veille valide, le lendemain expiré", () => {
    expect(classifyDocumentExpiry(offset(1), new Date(NOW)).status).not.toBe("expired");
    expect(classifyDocumentExpiry(offset(-1), new Date(NOW)).status).toBe("expired");
  });

  // Défaut connu : `days < 0` classe l'échéance du jour « due ». Un test existant
  // (document-expiry-rule.test.ts) fige ce « due » : arbitrage produit à rendre.
  it.fails("le jour de l'échéance : expiré", () => {
    expect(classifyDocumentExpiry(offset(0), new Date(NOW)).status).toBe("expired");
  });
});

describe("une règle, une source : mêmes entrées, même verdict", () => {
  it.each([1, -1])("échéance dans %i jour(s) : éligibilité, service et règle concordent", async (days) => {
    const v = await verdicts(offset(days));
    expect(new Set([v.eligibility, v.status, v.stats, v.list, v.rule]).size).toBe(1);
  });

  // Rougit dès que les cinq verdicts concordent aussi au jour J : retirer alors `.fails`.
  it.fails("échéance aujourd'hui : éligibilité, service et règle concordent", async () => {
    const v = await verdicts(offset(0));
    expect(new Set([v.eligibility, v.status, v.stats, v.list, v.rule]).size).toBe(1);
  });
});

describe("D4 : date UTC du service contre date locale de l'éligibilité", () => {
  // À 23:30Z le 3 novembre il est 00:30 le 4 à Douala (UTC+1). Une assurance échéant le 4
  // bloque l'éligibilité (jour J en local) mais le service, en UTC, est encore le 3 : elle
  // n'est pas expirée, même une fois D1 corrigé. Quelle date fait foi (UTC ou Douala)
  // est un arbitrage produit ; le test fige la concordance attendue.
  const instant = "2026-11-03T23:30:00.000Z";
  const dayJLocal = "2026-11-04";

  beforeEach(() => {
    seed(dayJLocal);
    vi.setSystemTime(new Date(instant));
  });

  it.fails("les deux sources voient la même date entre minuit local et minuit UTC", async () => {
    const eligibility = getMissionEligibility({ insuranceExpiry: dayJLocal }, new Date()).blockers.some((b) => b.code === "insurance");
    const service = (await assuranceStatus()) === "expired";
    expect(service).toBe(eligibility);
  });
});
