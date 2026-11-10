import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { findWholeTableReads } from "../../support/table-select-scan";

/**
 * Prix des pièces (`parts.unitPrice`) : lu par STOCK_VALUATION_READ_ROLES seulement (Q23).
 *
 * Deux façons de faire sortir le prix d'une requête :
 * - lire la table `parts` sans projection explicite (`select()` vide, `{ part: parts }`,
 *   `getTableColumns(parts)`) : la ligne entière, prix compris, est ramenée ;
 * - projeter `parts.unitPrice` sous un autre nom (`partUnitPrice`), que le masque ne connaît que
 *   s'il est déclaré dans `PART_PRICE_KEYS` ou `WORK_ORDER_COST_KEYS`.
 *
 * Les occurrences existantes sont gelées ci-dessous avec leur justification (masque ou garde en aval,
 * ou lecture interne jamais servie). Les listes doivent rester strictement égales :
 * - une occurrence nouvelle fait échouer le test : préférer une projection explicite sans prix, sinon
 *   vérifier que la sortie passe par `partPriceMask`, `workOrderCostMask` ou une garde de valuation,
 *   puis ajouter l'entrée ici ;
 * - une occurrence supprimée fait aussi échouer le test : retirer l'entrée.
 */
const FROZEN_WHOLE_ROWS: Record<string, string> = {
  "server/api/capped-statistics.routes.ts#1": "rapport d'inventaire : GET /api/reports/inventory derrière isInventoryReportReader",
  "server/services/excel-export-service.ts#1": "export inventaire : réservé par exportsGuard (EXPORT_ROLE_MATRIX)",
  "server/services/export-service.ts#1": "exports : réservés par exportsGuard (EXPORT_ROLE_MATRIX)",
  "server/services/export-service.ts#2": "exports : réservés par exportsGuard (EXPORT_ROLE_MATRIX)",
  "server/services/parts-service.ts#1": "getParts : servi par GET /api/parts, sous partPriceMask",
  "server/services/parts-service.ts#2": "getPartById : servi par GET /api/parts/:id, sous partPriceMask",
  "server/services/parts-service.ts#3": "contrôle de doublon de référence à la création : lecture interne",
  "server/services/parts-service.ts#4": "contrôle de doublon de référence à la modification : lecture interne",
  "server/services/parts-service.ts#5": "verrou d'ajustement de stock : la réponse PATCH va à isPartsCatalogManager",
  "server/services/parts-service.ts#6": "getLowStockParts : servi par GET /api/parts/low-on-stock, sous partPriceMask",
  "server/services/procurement-service.ts#1": "commandes fournisseur : /api/purchase-orders derrière gardeApprovisionnement (PROCUREMENT_ROLES)",
  "server/services/procurement-service.ts#2": "commandes fournisseur : /api/purchase-orders derrière gardeApprovisionnement (PROCUREMENT_ROLES)",
  "server/services/procurement-service.ts#3": "commandes fournisseur : /api/purchase-orders derrière gardeApprovisionnement (PROCUREMENT_ROLES)",
  "server/services/reports-service.ts#1": "getInventoryReportData : aucun appelant",
  "server/services/stock-alerts-service.ts#1": "getRealStock : résultat reprojeté sans prix",
  "server/services/stock-alerts-service.ts#2": "verrou de recordStockMovement : lecture interne",
  "server/services/vat-billing-service.ts#1": "GET /api/invoices/:id/parts : garde isStockValuationReader (stock-valuation-guard.routes.ts)",
  "server/services/work-order-part-request.ts#1": "verrou de la demande : ne renvoie que id, name et reference de la pièce",
  "server/storage.ts#1": "getPart : route de sortie de pièce d'OT, contrôle de stock seulement",
  "server/storage.ts#2": "getPartByReference : aucun appelant",
  "server/storage.ts#3": "getParts : /api/reports/inventory derrière isInventoryReportReader",
  "server/storage.ts#4": "getParts : /api/reports/inventory derrière isInventoryReportReader",
  "server/storage.ts#5": "getPartsLowOnStock : aucun appelant",
  "server/storage.ts#6": "recordStockMovement : lecture interne, retour void",
};

/** Nombre de références à `parts.unitPrice` par fichier. */
const FROZEN_PRICE_PROJECTIONS: Record<string, { count: number; reason: string }> = {
  "server/api/capped-statistics.routes.ts": { count: 1, reason: "valeur du stock du rapport d'inventaire : derrière isInventoryReportReader" },
  "server/api/work-order-parts.routes.ts": { count: 1, reason: "pièces posées d'un OT : sous workOrderCostMask" },
  "server/services/part-requirements-service.ts": {
    count: 5,
    reason: "partUnitPrice servi sous partPriceMask (/part-requirements) et workOrderCostMask (/work-orders) ; deux calculs de coût internes",
  },
  "server/services/parts-service.ts": { count: 2, reason: "liste sous partPriceMask ; statistiques derrière la garde de valuation" },
  "server/services/stock-alerts-service.ts": { count: 10, reason: "routes /api/warehouse de valuation, derrière isStockValuationReader" },
  "server/storage.ts": { count: 1, reason: "getPartsStatistics : aucun appelant" },
};

const root = fileURLToPath(new URL("../../..", import.meta.url));
const serverDir = join(root, "server");

function serverSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "_archive" || name === "node_modules") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return serverSources(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

const countPriceReferences = (source: string): number => (source.match(/\bparts\.unitPrice\b/g) ?? []).length;

describe("lectures du prix des pièces (table parts)", () => {
  const sources = serverSources(serverDir).map((path) => ({
    key: relative(root, path).replace(/\\/g, "/"),
    source: readFileSync(path, "utf8"),
  }));

  it("lectures entières : aucune hors de la liste gelée, aucune entrée périmée", () => {
    const found = sources.flatMap(({ key, source }) => findWholeTableReads(source, key, "parts"));
    expect([...found].sort()).toEqual(Object.keys(FROZEN_WHOLE_ROWS).sort());
  });

  it("projections de parts.unitPrice : nombre gelé par fichier", () => {
    const found = Object.fromEntries(
      sources.map(({ key, source }) => [key, countPriceReferences(source)] as const).filter(([, count]) => count > 0),
    );
    const frozen = Object.fromEntries(Object.entries(FROZEN_PRICE_PROJECTIONS).map(([key, { count }]) => [key, count]));
    expect(found).toEqual(frozen);
  });

  it("chaque entrée gelée porte une justification", () => {
    for (const [entry, reason] of Object.entries(FROZEN_WHOLE_ROWS)) expect(reason.length, entry).toBeGreaterThan(15);
    for (const [entry, { reason }] of Object.entries(FROZEN_PRICE_PROJECTIONS)) expect(reason.length, entry).toBeGreaterThan(15);
  });

  it("le détecteur repère une lecture entière, ignore une projection et les tables voisines", () => {
    expect(findWholeTableReads("db.select().from(parts).where(x);", "f", "parts")).toEqual(["f#1"]);
    expect(findWholeTableReads("db.select({ part: parts, id: a.id }).from(a).leftJoin(parts, eq(1, 1));", "f", "parts")).toEqual(["f#1"]);
    expect(findWholeTableReads("db.select(getTableColumns(parts)).from(parts);", "f", "parts")).toEqual(["f#1"]);
    expect(findWholeTableReads("db.select({ id: parts.id, name: parts.name }).from(parts);", "f", "parts")).toEqual([]);
    expect(findWholeTableReads("db.select().from(partsStockMovements);", "f", "parts")).toEqual([]);
    expect(countPriceReferences("{ p: parts.unitPrice, q: tires.unitPrice, r: parts.unitPriceX }")).toBe(1);
  });
});
