import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REALTIME_EVENTS } from "@shared/contracts/realtime-events";
import { EVENT_SATELLITES, SATELLITE_GROUPS, satelliteTargetsOf, type SatelliteGroupName } from "@/lib/realtime-satellites";

/**
 * Garde-fou de la couche 3 (AGENTS.md §2) : un événement de stock, d'argent ou de statut qui
 * oublie un écran satellite laisse cet écran périmé jusqu'au rechargement (`staleTime` 5 min,
 * sans polling). Cas réel : la réception de commande fournisseur ne levait pas l'alerte stock bas
 * chez le chef d'atelier (#177) ; l'audit du 3 novembre 2026 en a trouvé quatorze autres.
 */

const ROOT = resolve(__dirname, "../../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "_archive" || name === "node_modules") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/**
 * Événements émis par le serveur : premier argument littéral d'une fonction d'émission
 * (`broadcastUpdate`, `broadcastPurchaseOrderUpdate`, `emitMissionEvent`, `diffuser`…), appel optionnel
 * compris (`broadcast?.("…")`, invisible avant L1f : `mission_budget_updated` échappait au garde-fou), et
 * `'eventType', '…'` des déclencheurs SQL de `init-database.ts` et de `server/db/triggers/*.sql`.
 */
function emittedEvents(): Set<string> {
  const names = new Set<string>();
  const call = /\b\w*(?:broadcast|emit|diffuser)\w*(?:\?\.)?\(\s*["'`]([a-z]+(?:_[a-z]+)+)["'`]/gi;
  const sql = /'eventType',\s*'([a-z]+(?:_[a-z]+)+)'/g;
  for (const file of sourceFiles(join(ROOT, "server"))) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(call)) names.add(match[1]);
    for (const match of text.matchAll(sql)) names.add(match[1]);
  }
  // Déclencheurs dont le nom d'événement passe par une variable : `event_type := '…'` ou
  // `event_type := CASE WHEN … THEN '…' ELSE '…' END`. Seule source de `work_order_status_changed`.
  const assigned = /\bevent_type\s*:=\s*(?:'([a-z]+(?:_[a-z]+)+)'|CASE\b([\s\S]*?)\bEND\b)/gi;
  const branch = /\b(?:THEN|ELSE)\s+'([a-z]+(?:_[a-z]+)+)'/gi;
  for (const name of readdirSync(join(ROOT, "server/db/triggers")).filter((n) => n.endsWith(".sql"))) {
    const text = readFileSync(join(ROOT, "server/db/triggers", name), "utf8");
    for (const match of text.matchAll(sql)) names.add(match[1]);
    for (const match of text.matchAll(assigned)) {
      if (match[1]) names.add(match[1]);
      else for (const arm of match[2].matchAll(branch)) names.add(arm[1]);
    }
  }
  return names;
}

/** Premiers éléments des `queryKey` littérales posées par le client, et leurs gabarits `${…}`. */
function clientQueryKeys(): { exact: Set<string>; templates: Set<string> } {
  const exact = new Set<string>();
  const templates = new Set<string>();
  const literal = /queryKey:\s*\[\s*["'`]([^"'`]+)["'`]/g;
  for (const file of sourceFiles(join(ROOT, "client/src"))) {
    for (const match of readFileSync(file, "utf8").matchAll(literal)) {
      (match[1].includes("${") ? templates : exact).add(match[1]);
    }
  }
  // Constantes de chemin des contrats, prises pour clé par `useContractQuery` (KPI notamment).
  const contractPath = /export const \w+_PATH\s*=\s*["'`](\/api\/[^"'`$]+)["'`]/g;
  for (const file of sourceFiles(join(ROOT, "shared/contracts"))) {
    for (const match of readFileSync(file, "utf8").matchAll(contractPath)) exact.add(match[1]);
  }
  return { exact, templates };
}

/** Faits métier suivis par le garde-fou : un événement de ces familles doit être à la table. */
const TRACKED_FAMILIES: Array<[family: string, pattern: RegExp]> = [
  ["stock", /^(part_used|part_requirement|purchase_order|parts_delivered|part_received|warehouse_stock|part_catalog)/],
  ["argent", /^(fuel_card|fuel_record|client_invoice|supplier_invoice|mission_budget)/],
  // Heures d'une tâche d'OT : main-d'oeuvre valorisée dans les KPI de coût (`kpi-service`, `loadCostRows`).
  ["coût OT", /^work_order_item/],
  ["statut", /^(work_order_(created|updated|status_changed|deleted|awaiting_parts)|vehicle_(updated|status_changed|mileage_updated|maintenance_position_updated)|mission_|document_renewal_request|document_renewal_quick|vehicle_document_updated|alert_)/],
];

/**
 * Événements des familles suivies encore absents de la table. Liste gelée, figée par égalité
 * stricte : elle ne peut que diminuer, en modifiant aussi le test d'égalité. Ajouter un événement ici demande de justifier pourquoi aucun écran satellite ne bouge.
 */
const NOT_YET_IN_TABLE: string[] = [];

/** Entrées de la table sans émetteur serveur connu (case client déjà prêt). Liste gelée. */
const TABLE_WITHOUT_EMITTER = ["alert_read", "alert_updated", "mission_completed", "mission_status_changed"];

/**
 * Écran satellite : compteur, statistique, tableau de bord, alerte ou valeur. Toute clé de ce
 * type posée par un écran doit être rafraîchie par au moins un événement. « count » n'est pas
 * lu dans « account » : une liste de comptes est un référentiel, pas un compteur.
 */
const SATELLITE_KEY = /(dashboard|statistics|stats|kpi|alerts|low-on-stock|low-stock|reorder|inventory-value|stock-value|awaiting-parts|balance|summary|(?<!ac)count|overdue|compliance)/;

/**
 * Écrans satellites qu'aucun événement ne rafraîchit encore. Liste gelée : retirer une clé dès
 * qu'un événement la couvre ; ne jamais en ajouter sans événement serveur à venir nommé.
 */
const UNCOVERED_SATELLITES: string[] = [
  // Relances d'acquisition véhicule : aucun événement serveur, l'écran invalide lui-même après action.
  "/api/workflows/stats",
];

const emitted = emittedEvents();
const { exact: clientKeys, templates: clientTemplates } = clientQueryKeys();

const realtimeSyncText = [
  readFileSync(join(ROOT, "client/src/hooks/useRealTimeSync.ts"), "utf8"),
  readFileSync(join(ROOT, "client/src/lib/app-toast.ts"), "utf8"),
].join("\n");

function coveredKeys(): Set<string> {
  const covered = new Set<string>();
  for (const group of Object.values(SATELLITE_GROUPS)) for (const key of group.keys) covered.add(key);
  for (const event of Object.values(REALTIME_EVENTS)) for (const key of event.invalidates) covered.add(key);
  for (const match of realtimeSyncText.matchAll(/queryKey:\s*\[\s*["'`]([^"'`$]+)["'`]/g)) covered.add(match[1]);
  return covered;
}

describe("couche 3 : table des écrans satellites", () => {
  it("le balayage trouve les émetteurs serveur et les clés client", () => {
    expect(emitted.size).toBeGreaterThan(50);
    expect(clientKeys.size).toBeGreaterThan(100);
    expect(emitted.has("purchase_order_status_updated")).toBe(true);
    expect(emitted.has("parts_delivered")).toBe(true);
  });

  it("chaque événement de stock, d'argent ou de statut émis par le serveur est à la table", () => {
    const missing = [...emitted]
      .filter((event) => TRACKED_FAMILIES.some(([, pattern]) => pattern.test(event)))
      .filter((event) => !(event in EVENT_SATELLITES) && !NOT_YET_IN_TABLE.includes(event))
      .sort();
    expect(missing).toEqual([]);
  });

  it("un événement de stock porte un groupe de stock, un événement d'argent un groupe d'argent", () => {
    const required: Array<[family: string, groups: readonly SatelliteGroupName[]]> = [
      ["stock", ["stock", "partRequirements"]],
      ["argent", ["fuel", "clientMoney", "supplierMoney", "missionBudgets"]],
      ["coût OT", ["workOrderCost"]],
    ];
    const wrong = required.flatMap(([family, groups]) => {
      const pattern = TRACKED_FAMILIES.find(([name]) => name === family)![1];
      return Object.entries(EVENT_SATELLITES)
        .filter(([event, assigned]) => pattern.test(event) && !assigned.some((group) => groups.includes(group)))
        .map(([event]) => `${family}: ${event}`);
    });
    expect(wrong).toEqual([]);
  });

  it("chaque entrée de la table correspond à un événement émis (pas d'entrée morte)", () => {
    const dead = Object.keys(EVENT_SATELLITES)
      .filter((event) => !emitted.has(event) && !(event in REALTIME_EVENTS) && !TABLE_WITHOUT_EMITTER.includes(event))
      .sort();
    expect(dead).toEqual([]);
  });

  it("la liste des entrées sans émetteur est figée et justifiée", () => {
    for (const event of TABLE_WITHOUT_EMITTER) expect(emitted.has(event)).toBe(false);
    expect([...TABLE_WITHOUT_EMITTER].sort()).toEqual(["alert_read", "alert_updated", "mission_completed", "mission_status_changed"]);
  });

  it("chaque clé d'un groupe est posée par un écran (sinon l'invalidation est un no-op)", () => {
    const groups = Object.entries(SATELLITE_GROUPS) as Array<[SatelliteGroupName, { keys: readonly string[] }]>;
    const orphans = groups.flatMap(([name, group]) => group.keys.filter((key) => !clientKeys.has(key)).map((key) => `${name}: ${key}`));
    expect(orphans).toEqual([]);
  });

  it("chaque préfixe d'un groupe vise au moins une clé construite par un écran", () => {
    const all = [...clientKeys, ...clientTemplates];
    const groups = Object.entries(SATELLITE_GROUPS) as Array<[SatelliteGroupName, { prefixes?: readonly string[] }]>;
    const orphans = groups.flatMap(([name, group]) =>
      (group.prefixes ?? []).filter((prefix) => !all.some((key) => key.startsWith(prefix))).map((prefix) => `${name}: ${prefix}`),
    );
    expect(orphans).toEqual([]);
  });

  it("chaque groupe est utilisé par au moins un événement", () => {
    const used = new Set(Object.values(EVENT_SATELLITES).flat());
    expect(Object.keys(SATELLITE_GROUPS).filter((name) => !used.has(name as SatelliteGroupName))).toEqual([]);
  });

  it("chaque écran satellite (compteur, statistique, tableau de bord) est rafraîchi par un événement", () => {
    const covered = coveredKeys();
    const uncovered = [...clientKeys]
      .filter((key) => key.startsWith("/api/") && SATELLITE_KEY.test(key))
      .filter((key) => !covered.has(key) && !UNCOVERED_SATELLITES.includes(key))
      .sort();
    expect(uncovered).toEqual([]);
  });

  it("les listes gelées ne grandissent pas (égalité stricte)", () => {
    expect([...NOT_YET_IN_TABLE].sort()).toEqual([]);
    expect([...UNCOVERED_SATELLITES].sort()).toEqual(["/api/workflows/stats"]);
  });

  it("le carburant d'un véhicule (fiche véhicule) suit les événements carburant", () => {
    const { keys, prefixes } = satelliteTargetsOf("fuel_record_changed");
    expect(keys).toContain("/api/fuel-card/vehicle");
    expect(prefixes).toContain("/api/fuel-records/vehicle/");
  });

  it("une clé de la liste gelée n'y reste pas une fois couverte", () => {
    const covered = coveredKeys();
    expect(UNCOVERED_SATELLITES.filter((key) => covered.has(key) || !clientKeys.has(key))).toEqual([]);
  });

  it("une tâche d'OT modifiée rafraîchit les KPI de coût et les listes du technicien", () => {
    const { keys } = satelliteTargetsOf("work_order_item_changed");
    expect(keys).toEqual(expect.arrayContaining(["/api/kpi/maintenance-costs", "/api/kpi/avg-cost-per-intervention", "/api/management/dashboard"]));
    expect(keys).toEqual(expect.arrayContaining(["/api/technician/my-work-orders", "/api/dashboard/technician-stats"]));
  });

  it("les écarts hauts de l'audit du 3 novembre 2026 sont couverts", () => {
    const has = (event: string, group: SatelliteGroupName) => EVENT_SATELLITES[event]?.includes(group);
    expect(has("purchase_order_status_updated", "stock")).toBe(true);
    expect(has("purchase_order_status_updated", "supplierMoney")).toBe(true);
    expect(has("part_used_added", "stock")).toBe(true);
    expect(has("warehouse_stock_movement_recorded", "stock")).toBe(true);
    expect(has("fuel_card_recharged", "fuel")).toBe(true);
    expect(has("fuel_record_changed", "fuel")).toBe(true);
    expect(has("fuel_record_changed", "missions")).toBe(true);
    expect(has("client_invoice_created", "clientMoney")).toBe(true);
    expect(has("supplier_invoice_created", "supplierMoney")).toBe(true);
    expect(has("parts_delivered", "stock")).toBe(true);
    expect(SATELLITE_GROUPS.stock.keys).toContain("/api/warehouse/inventory-value");
    expect(SATELLITE_GROUPS.stock.keys).toContain("/api/warehouse/most-used-parts");
    expect(SATELLITE_GROUPS.clientMoney.keys).toContain("/api/management/dashboard");
  });

  it("kilométrage et position d'atelier : la fiche du seul véhicule touché, pas toutes les fiches", () => {
    for (const event of ["vehicle_mileage_updated", "vehicle_maintenance_position_updated"]) {
      const { keys, prefixes } = satelliteTargetsOf(event, { vehicleId: 42, vehicle: { registrationNumber: "LT-123-AB" } });
      expect(keys).toEqual(expect.arrayContaining(["/api/vehicles/42", "/api/vehicles/LT-123-AB", "/api/vehicles", "/api/vehicles/all"]));
      expect(prefixes).not.toContain("/api/vehicles/");
      expect(keys).not.toContain("/api/vehicles/43");
    }
  });

  it("budget de mission (L1g) : la check-list de lancement de la seule mission touchée", () => {
    const { keys } = satelliteTargetsOf("mission_budget_updated", { missionId: 7 });
    expect(keys).toEqual(expect.arrayContaining(["/api/missions/7/launch-readiness", "/api/mission-budgets", "/api/mission-budgets/daily-need"]));
    expect(keys.filter((k) => k.includes("launch-readiness"))).toEqual(["/api/missions/7/launch-readiness"]);
    expect(satelliteTargetsOf("mission_budget_updated", {}).keys.some((k) => k.includes("launch-readiness"))).toBe(false);
  });

  it("sans identifiant dans la charge, repli sur toutes les fiches véhicule (trop plutôt que pas assez)", () => {
    for (const payload of [undefined, {}, { vehicleId: "abc" }, { vehicleId: 0 }]) {
      expect(satelliteTargetsOf("vehicle_mileage_updated", payload).prefixes).toContain("/api/vehicles/");
    }
  });

  it("chaque gabarit par identifiant correspond à une clé construite par un écran", () => {
    const groups = Object.entries(SATELLITE_GROUPS) as Array<[SatelliteGroupName, { byId?: readonly string[] }]>;
    // Identifiant au milieu du chemin (`/api/missions/:missionId/launch-readiness`) : la clé écran doit être `.../${…}/launch-readiness`.
    const inner = (template: string) => new RegExp(`^${template.split(/:\w+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\$\\{[^}]+\\}")}$`);
    const orphans = groups.flatMap(([name, group]) =>
      (group.byId ?? [])
        .filter((template) => !clientTemplates.has(template.replace(/:\w+$/, "${")) && ![...clientTemplates].some((key) => key.startsWith(template.replace(/:\w+$/, "${")) || (!/:\w+$/.test(template) && inner(template).test(key))))
        .map((template) => `${name}: ${template}`),
    );
    expect(orphans).toEqual([]);
  });
});
