import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ALL_APP_ROLES } from "@shared/constants/roles";
import {
  FEATURE_FLAGS,
  FEATURE_KEYS,
  parseFeatureOverrides,
  resolveFeatureFlags,
} from "@shared/feature-flags";
import { EXPORT_PATHS, EXPORT_ROLE_MATRIX, canExport } from "@shared/contracts/exports";
import {
  VEHICLE_DOCUMENT_TYPE_SEED,
  vehicleDocumentTypeSchema,
} from "@shared/contracts/vehicle-document-types";
import { bookingsOverlap } from "@shared/contracts/work-order-booking";
import { DEFAULT_FUEL_PRICE_PER_LITER, fuelPriceAt } from "@shared/contracts/fuel-prices";
import { fuelAnomalyKeySchema } from "@shared/contracts/fuel-anomalies";
import { qualityCheckRequestSchema } from "@shared/contracts/quality-check";
import { dateRangeQuerySchema } from "@shared/contracts/common";
import { REALTIME_EVENTS, REALTIME_EVENT_NAMES, REUSED_REALTIME_EVENTS } from "@shared/contracts/realtime-events";
import { TIME_CODES, TIME_CODE_LABELS } from "@shared/contracts/time-tracking";
import { updateNotificationSettingsRequestSchema } from "@shared/contracts/notification-settings";

/**
 * SHOULD allumés par défaut après recette (lot V3). Chaque entrée est une décision versionnée :
 * l'ajouter ici dans la PR qui passe `defaultEnabled` à true, avec son e2e.
 */
const SHOULD_ACTIVATED_AFTER_RECETTE: ReadonlySet<string> = new Set(["tire-movements", "fuel-anomalies", "incidents"]);

describe("drapeaux de fonctionnalité", () => {
  it("clés en kebab-case, MUST et SHOULD recettés allumés par défaut, les autres coupés", () => {
    for (const key of FEATURE_KEYS) {
      expect(key).toMatch(/^[a-z]+(-[a-z]+)*$/);
      const expected = FEATURE_FLAGS[key].level === "must" || SHOULD_ACTIVATED_AFTER_RECETTE.has(key);
      expect(FEATURE_FLAGS[key].defaultEnabled, key).toBe(expected);
    }
  });

  it("un SHOULD recetté est bien un SHOULD connu", () => {
    for (const key of SHOULD_ACTIVATED_AFTER_RECETTE) {
      expect(FEATURE_FLAGS[key as keyof typeof FEATURE_FLAGS]?.level, key).toBe("should");
    }
  });

  it("applique les surcharges et rapporte les entrées invalides sans lever", () => {
    const parsed = parseFeatureOverrides(" incidents=on, exports=OFF, inconnu=on, captcha=peut-etre,, gps ");
    expect(parsed.overrides).toEqual({ incidents: true, exports: false });
    expect(parsed.ignored).toEqual(["inconnu=on", "captcha=peut-etre", "gps"]);
  });

  it("résout toutes les clés, défauts compris", () => {
    const flags = resolveFeatureFlags("incidents=1");
    expect(Object.keys(flags).sort()).toEqual([...FEATURE_KEYS].sort());
    expect(flags.incidents).toBe(true);
    expect(flags.exports).toBe(true);
    expect(flags.finance).toBe(false);
    expect(resolveFeatureFlags(undefined).incidents).toBe(true);
    expect(resolveFeatureFlags("incidents=off").incidents).toBe(false);
  });
});

describe("matrice des exports", () => {
  it("couvre les 8 routes avec des rôles existants", () => {
    expect(Object.keys(EXPORT_ROLE_MATRIX).sort()).toEqual([...EXPORT_PATHS].sort());
    for (const roles of Object.values(EXPORT_ROLE_MATRIX)) {
      for (const role of roles) expect(ALL_APP_ROLES).toContain(role);
    }
  });

  it("refuse partout client, chauffeur, technicien et utilisateur simple", () => {
    for (const path of EXPORT_PATHS) {
      for (const role of ["client", "driver", "technician", "user"]) expect(canExport(role, path)).toBe(false);
    }
  });

  it("refuse par défaut un chemin ou un rôle inconnu", () => {
    expect(canExport("admin", "inconnu")).toBe(false);
    expect(canExport(undefined, "inventory")).toBe(false);
    expect(canExport("admin", "monthly-report")).toBe(true);
    expect(canExport("warehouse", "client-invoices")).toBe(false);
    expect(canExport("workshop_manager", "supplier-invoices")).toBe(false);
  });
});

describe("référentiel des types de document", () => {
  // 11 et non 9 : taxe et autre sont semés au démarrage depuis le lot recette ; la graine du contrat les omettait.
  it("contient les 11 types semés au démarrage, valides, aux codes uniques", () => {
    expect(VEHICLE_DOCUMENT_TYPE_SEED).toHaveLength(11);
    expect(new Set(VEHICLE_DOCUMENT_TYPE_SEED.map((t) => t.code)).size).toBe(11);
    for (const type of VEHICLE_DOCUMENT_TYPE_SEED) expect(vehicleDocumentTypeSchema.parse(type)).toEqual(type);
  });
});

describe("double affectation", () => {
  const d = (h: number) => new Date(Date.UTC(2026, 10, 2, h));

  it("détecte un chevauchement, y compris avec un créneau ouvert", () => {
    expect(bookingsOverlap({ from: d(8), to: d(10) }, { from: d(9), to: d(11) })).toBe(true);
    expect(bookingsOverlap({ from: d(8), to: null }, { from: d(15), to: d(16) })).toBe(true);
  });

  it("accepte deux créneaux qui se touchent sans se chevaucher", () => {
    expect(bookingsOverlap({ from: d(8), to: d(10) }, { from: d(10), to: d(12) })).toBe(false);
  });
});

describe("prix du carburant daté", () => {
  const prices = [
    { effectiveFrom: "2000-01-01", pricePerLiter: 828 },
    { effectiveFrom: "2026-11-01", pricePerLiter: 843 },
  ];

  it("garde 828 le 30 octobre et applique 843 le 2 novembre", () => {
    expect(fuelPriceAt(prices, "2026-10-30")).toBe(828);
    expect(fuelPriceAt(prices, "2026-11-01")).toBe(843);
    expect(fuelPriceAt(prices, "2026-11-02")).toBe(843);
  });

  it("retombe sur le prix historique sans référentiel", () => {
    expect(fuelPriceAt([], "2026-11-02")).toBe(DEFAULT_FUEL_PRICE_PER_LITER);
  });

  it("valide la clé d'anomalie dérivée", () => {
    expect(fuelAnomalyKeySchema.safeParse("consumption-gap:412").success).toBe(true);
    expect(fuelAnomalyKeySchema.safeParse("412").success).toBe(false);
  });
});

describe("règles de validation", () => {
  it("un contrôle qualité refusé exige un motif", () => {
    expect(qualityCheckRequestSchema.safeParse({ result: "failed" }).success).toBe(false);
    expect(qualityCheckRequestSchema.safeParse({ result: "failed", reason: "Fuite persistante" }).success).toBe(true);
    expect(qualityCheckRequestSchema.safeParse({ result: "passed" }).success).toBe(true);
  });

  it("une période commence avant de finir", () => {
    expect(dateRangeQuerySchema.safeParse({ from: "2026-11-02", to: "2026-10-01" }).success).toBe(false);
    expect(dateRangeQuerySchema.safeParse({ from: "2026-10-01", to: "2026-11-02" }).success).toBe(true);
  });

  it("un thème de notification n'apparaît qu'une fois par mise à jour", () => {
    expect(updateNotificationSettingsRequestSchema.safeParse([{ topic: "fuel" }, { topic: "fuel" }]).success).toBe(false);
  });

  it("chaque code de pointage a un libellé", () => {
    expect(Object.keys(TIME_CODE_LABELS).sort()).toEqual([...TIME_CODES].sort());
  });
});

describe("événements temps réel du lot", () => {
  const existingEvents = (() => {
    const source = readFileSync(join(process.cwd(), "client/src/hooks/useRealTimeSync.ts"), "utf8");
    const counts = new Map<string, number>();
    for (const m of source.matchAll(/case ["']([a-z_]+)["']/g)) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
    return counts;
  })();

  it("noms en snake_case, non réutilisés, au plus un case par événement côté client", () => {
    const reused = new Set<string>(REUSED_REALTIME_EVENTS);
    for (const name of REALTIME_EVENT_NAMES) {
      expect(name).toMatch(/^[a-z]+(_[a-z]+)+$/);
      expect(reused.has(name)).toBe(false);
      // un doublon de case = vraie collision ; un seul case (ajouté par le lot) est attendu
      expect(existingEvents.get(name) ?? 0).toBeLessThanOrEqual(1);
    }
  });

  it("les événements réutilisés existent déjà côté client", () => {
    for (const name of REUSED_REALTIME_EVENTS) expect(existingEvents.has(name)).toBe(true);
  });

  it("broadcast réservé aux référentiels, rôles existants ailleurs", () => {
    for (const [name, def] of Object.entries(REALTIME_EVENTS)) {
      const scope = def.scope;
      if (scope === "user") continue;
      if (scope.type === "broadcast") expect(["fuel_price_changed", "vehicle_document_type_changed"]).toContain(name);
      if (scope.type === "roles") for (const role of scope.roles) expect(ALL_APP_ROLES).toContain(role);
      expect(def.invalidates.length).toBeGreaterThan(0);
    }
  });
});

describe("contrats partagés", () => {
  it("n'importent rien du serveur ni du client", () => {
    const dir = join(process.cwd(), "shared/contracts");
    for (const file of readdirSync(dir)) {
      const source = readFileSync(join(dir, file), "utf8");
      expect(source, file).not.toMatch(/from ["'](@\/|\.\.\/\.\.\/(server|client)|server\/|client\/)/);
    }
  });
});
