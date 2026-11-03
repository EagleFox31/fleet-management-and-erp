import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { vehicles } from "../../../shared/schema";
import { getMissionEligibility } from "../../../shared/constants/vehicle-eligibility";
import { classifyDocumentExpiry } from "../../../server/services/document-expiry-rule";
import { isDriverLicenseExpiredOn, todayUtcDateOnly } from "../../../shared/constants/expiry-day";

/**
 * P3-2, garde-fou « une règle, une source » : le jour de l'échéance.
 *
 * Règle métier (D2 révisée, #224, 3 novembre 2026) : un document est VALABLE le jour
 * de son échéance et expiré le lendemain (J+1). Le permis suit la même règle. Trois
 * emplacements la portent pour les papiers véhicule, un pour le permis :
 *   - `getMissionEligibility` (shared) ;
 *   - `isDateExpired` de `vehicle-documentation-service.ts` (privée, testée par
 *     `getAllVehiclesWithDocStatus`, `getDocumentStats`, `getExpiredDocuments`) ;
 *   - `classifyDocumentExpiry` (alertes des documents typés) ;
 *   - `isDriverLicenseExpiredOn` (permis : check-list et lancement de mission).
 *
 * Toutes passent par `shared/constants/expiry-day.ts` : J-1 et J valables, J+1 expiré.
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
    [0, false, "le jour de l'échéance (dernier jour de validité)"],
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

  it("le jour de l'échéance : encore valable (statut, statistiques, liste)", async () => {
    const v = await verdicts(offset(0));
    expect([v.status, v.stats, v.list]).toEqual([false, false, false]);
  });

  it("le jour de l'échéance : compté « expire bientôt », pas « expiré »", async () => {
    seed(offset(0));
    expect(await assuranceStatus()).toBe("expiring");
  });

  it("frontière de fuseau : la date de référence bascule à minuit UTC, pas avant", async () => {
    seed("2026-11-04");
    // 23:59:59Z le 3 : l'échéance du 4 est encore dans le futur.
    vi.setSystemTime(new Date("2026-11-03T23:59:59.000Z"));
    expect(await assuranceStatus()).not.toBe("expired");
    // 00:00Z le 4 : jour J, encore valable.
    vi.setSystemTime(new Date("2026-11-04T00:00:00.000Z"));
    expect(await assuranceStatus()).not.toBe("expired");
    // 00:00Z le 5 : J+1, expirée.
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

  it("le jour de l'échéance : « due » (alerte de rappel), pas « expired »", () => {
    expect(classifyDocumentExpiry(offset(0), new Date(NOW))).toEqual({ status: "due", days: 0 });
  });
});

describe("une règle, une source : mêmes entrées, même verdict", () => {
  it.each([
    [1, false],
    [0, false],
    [-1, true],
  ])("échéance dans %i jour(s) : les cinq verdicts valent expiré=%s", async (days, expired) => {
    const v = await verdicts(offset(days));
    expect([v.eligibility, v.status, v.stats, v.list, v.rule]).toEqual([expired, expired, expired, expired, expired]);
  });
});

// D4 (décision produit : UTC partout). Le jour change à minuit UTC, soit 01:00 à Douala :
// entre 00:00 et 01:00 heure de Douala, le jour J est encore la veille (décalage accepté).
// Une assurance échéant le 4 n'est expirée nulle part le 4 (00:00Z à 23:59Z), l'est partout
// à 00:00Z le 5, que la machine soit en UTC ou à Douala.
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

  it("23:30Z le 3 (J-1) : l'échéance du 4 n'est expirée nulle part", async () => {
    expect(await expiredEverywhere("2026-11-03T23:30:00.000Z")).toEqual([false, false, false, false, false]);
  });

  it("00:00Z et 23:30Z le 4 (J) : l'échéance du 4 est encore valable partout", async () => {
    expect(await expiredEverywhere("2026-11-04T00:00:00.000Z")).toEqual([false, false, false, false, false]);
    expect(await expiredEverywhere("2026-11-04T23:30:00.000Z")).toEqual([false, false, false, false, false]);
  });

  it("00:00Z le 5 (J+1) : l'échéance du 4 est expirée partout", async () => {
    expect(await expiredEverywhere("2026-11-05T00:00:00.000Z")).toEqual([true, true, true, true, true]);
  });

  it("permis : même bascule, valable le 4, expiré à 00:00Z le 5", () => {
    const at = (instant: string) => isDriverLicenseExpiredOn("2026-11-04", todayUtcDateOnly(new Date(instant)));
    expect(at("2026-11-03T23:30:00.000Z")).toBe(false);
    expect(at("2026-11-04T23:30:00.000Z")).toBe(false);
    expect(at("2026-11-05T00:00:00.000Z")).toBe(true);
  });
});

describe("jour J : permis chauffeur (check-list et lancement)", () => {
  it.each([
    [1, false, "J-1 (échéance demain)"],
    [0, false, "J (échéance aujourd'hui, dernier jour de validité)"],
    [-1, true, "J+1 (échéance hier)"],
  ])("échéance dans %i jour(s) -> expiré=%s (%s)", (days, expired) => {
    expect(isDriverLicenseExpiredOn(offset(days), TODAY)).toBe(expired);
  });

  it("même verdict que les papiers véhicule à J-1, J et J+1", async () => {
    for (const days of [1, 0, -1]) {
      const v = await verdicts(offset(days));
      expect(isDriverLicenseExpiredOn(offset(days), TODAY)).toBe(v.eligibility);
    }
  });

  it("permis absent ou illisible : expiré ; horodatage lu par sa date UTC", () => {
    expect(isDriverLicenseExpiredOn(null, TODAY)).toBe(true);
    expect(isDriverLicenseExpiredOn("2026-02-30", TODAY)).toBe(true);
    expect(isDriverLicenseExpiredOn(new Date(`${TODAY}T23:30:00.000Z`), TODAY)).toBe(false);
  });
});

describe("jour J : getExpiredDocuments ne liste que les papiers échus (expiredDocuments)", () => {
  it("assurance échue d'hier listée, plaque qui expire aujourd'hui absente", async () => {
    dbState.vehicleRows = [
      { id: 1, registrationNumber: "TEST-1", ownerId: null, insuranceExpiry: offset(-1), licensePlateExpiry: offset(0), technicalInspectionDate: offset(1) },
    ];
    const [row] = await service.getExpiredDocuments();
    expect(row.expiredDocuments).toEqual([{ type: "assurance", expiryDate: offset(-1) }]);
  });

  it("sous Africa/Douala à 00:30 locale (23:30Z la veille), une échéance du jour UTC suivant n'est pas listée", async () => {
    vi.setSystemTime(new Date(`${offset(-1)}T23:30:00.000Z`));
    dbState.vehicleRows = [
      { id: 1, registrationNumber: "TEST-1", ownerId: null, insuranceExpiry: offset(-2), licensePlateExpiry: offset(-1), technicalInspectionDate: null },
    ];
    const [row] = await service.getExpiredDocuments();
    expect(row.expiredDocuments).toEqual([{ type: "assurance", expiryDate: offset(-2) }]);
  });
});
