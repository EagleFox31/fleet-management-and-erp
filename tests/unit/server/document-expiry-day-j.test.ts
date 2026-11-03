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
 * D1 et D2 corrigés (les anciens `it.fails` sont des `it`) : les trois sources rendent
 * « expiré » au jour J, via `shared/constants/expiry-day.ts`.
 *
 * Référence temporelle (D4, décision produit) : la date du jour est la date UTC partout.
 * Le fichier tourne sous Africa/Douala (UTC+1, sans heure d'été) pour prouver que le
 * fuseau de la machine ne change rien ; le bloc D4 rejoue aussi en UTC.
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
    eligibility: getMissionEligibility({ insuranceExpiry: utcDate(expiry) }, utcDate(TODAY, 10)).blockers.some((b) => b.code === "insurance"),
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

/** Instant UTC (minuit + `hour`) du jour calendaire `YYYY-MM-DD` : la date de référence est UTC partout. */
function utcDate(dateOnly: string, hour = 0): Date {
  return new Date(`${dateOnly}T${String(hour).padStart(2, "0")}:00:00.000Z`);
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
    const result = getMissionEligibility({ insuranceExpiry: utcDate(offset(days)) }, utcDate(TODAY, 10));
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
  it("le jour de l'échéance : expiré (statut, statistiques, liste)", async () => {
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
  it("le jour de l'échéance : expiré", () => {
    expect(classifyDocumentExpiry(offset(0), new Date(NOW)).status).toBe("expired");
  });
});

describe("une règle, une source : mêmes entrées, même verdict", () => {
  it.each([1, -1])("échéance dans %i jour(s) : éligibilité, service et règle concordent", async (days) => {
    const v = await verdicts(offset(days));
    expect(new Set([v.eligibility, v.status, v.stats, v.list, v.rule]).size).toBe(1);
  });

  // Rougit dès que les cinq verdicts concordent aussi au jour J : retirer alors `.fails`.
  it("échéance aujourd'hui : éligibilité, service et règle concordent", async () => {
    const v = await verdicts(offset(0));
    expect(new Set([v.eligibility, v.status, v.stats, v.list, v.rule]).size).toBe(1);
  });
});

// D4 (décision produit : UTC partout). Le jour change à minuit UTC, soit 01:00 à Douala :
// entre 00:00 et 01:00 heure de Douala, le jour J est encore la veille (décalage accepté).
// Une assurance échéant le 4 n'est expirée nulle part à 23:30Z le 3, l'est partout à 00:00Z
// le 4, que la machine soit en UTC ou à Douala.
describe.each(["Africa/Douala", "UTC"])("D4 : date UTC partout (machine en %s)", (tz) => {
  const previousTz = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = tz;
    seed("2026-11-04");
  });
  afterEach(() => {
    process.env.TZ = previousTz;
  });

  async function expiredEverywhere(instant: string): Promise<boolean[]> {
    vi.setSystemTime(new Date(instant));
    const now = new Date();
    return [
      getMissionEligibility({ insuranceExpiry: "2026-11-04" }, now).blockers.some((b) => b.code === "insurance"),
      (await assuranceStatus()) === "expired",
      (await service.getDocumentStats()).expiredAssurance === 1,
      (await service.getExpiredDocuments()).length === 1,
      classifyDocumentExpiry("2026-11-04", now).status === "expired",
    ];
  }

  it("23:30Z le 3 : l'échéance du 4 n'est expirée nulle part", async () => {
    expect(await expiredEverywhere("2026-11-03T23:30:00.000Z")).toEqual([false, false, false, false, false]);
  });

  it("00:00Z le 4 : l'échéance du 4 est expirée partout", async () => {
    expect(await expiredEverywhere("2026-11-04T00:00:00.000Z")).toEqual([true, true, true, true, true]);
  });
});
