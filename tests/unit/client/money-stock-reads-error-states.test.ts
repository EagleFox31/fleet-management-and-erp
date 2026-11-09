import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

/**
 * Lectures argent et stock en échec : depuis que le serveur répond 500 au lieu de `[]` ou `0`
 * (stock, mouvements, pièces utilisées, demandes de pièce), un écran qui retombe sur `= []`
 * affiche « Aucun mouvement », « 0 demande » ou un coût d'OT sous-évalué comme de vraies valeurs.
 * Chaque écran consommateur passe par `queryView` / `listQueryView` et montre l'erreur.
 */
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

/** Déclaration `const … = useQuery(…)` qui porte cette clé de requête. */
function queryDeclaration(src: string, queryKey: string): string {
  const keyAt = src.indexOf(queryKey);
  expect(keyAt, `clé ${queryKey} introuvable`).toBeGreaterThan(-1);
  return src.slice(src.lastIndexOf("const ", keyAt), keyAt);
}

const SCREENS: Array<{ path: string; queryKeys: string[]; shows: RegExp[] }> = [
  {
    path: "client/src/pages/inventory/movements.tsx",
    queryKeys: ['"/api/parts/stock-movements"'],
    shows: [/data-testid="movements-error"/],
  },
  {
    path: "client/src/pages/inventory/requests.tsx",
    queryKeys: ['queryKey: ["/api/part-requirements"]'],
    shows: [/data-testid="requests-error"/, /UNAVAILABLE/],
  },
  {
    path: "client/src/pages/inventory/index.tsx",
    queryKeys: ['queryKey: ["/api/part-requirements"]', '"/api/parts/stock-movements"'],
    shows: [/UNAVAILABLE/],
  },
  {
    path: "client/src/pages/warehouse/dashboard.tsx",
    queryKeys: ['"/api/parts/stock-movements"'],
    shows: [/data-testid="warehouse-movements-error"/],
  },
  {
    path: "client/src/components/dashboard/recent-activity-feed.tsx",
    queryKeys: ['"/api/parts/stock-movements"'],
    shows: [/data-testid="recent-movements-error"/],
  },
  {
    path: "client/src/pages/technicians/index.tsx",
    queryKeys: ['"/api/parts-used"'],
    shows: [/UNAVAILABLE/],
  },
  {
    path: "client/src/pages/procurement/orders/new.tsx",
    queryKeys: ['queryKey: ["/api/part-requirements"]'],
    shows: [/data-testid="order-requirements-error"/],
  },
  {
    path: "client/src/components/inventory/part-table.tsx",
    queryKeys: ["`/api/part-requirements/by-part/"],
    shows: [/data-testid="part-requirements-error"/],
  },
  {
    path: "client/src/pages/maintenance/work-orders/[id].tsx",
    queryKeys: ["`/api/work-orders/${workOrderId}/parts`", "`/api/part-requirements/by-part/"],
    shows: [/data-testid="parts-used-error"/, /data-testid="existing-requests-error"/],
  },
];

describe("écrans argent/stock : une lecture en échec n'est jamais un vide", () => {
  it.each(SCREENS)("$path", ({ path, queryKeys, shows }) => {
    const src = read(path);
    for (const key of queryKeys) {
      expect(queryDeclaration(src, key), `${key} : pas de \`= []\` par défaut`).not.toMatch(/=\s*\[\]/);
    }
    expect(src).toMatch(/\b(listQueryView|queryView)(<[^>]*>)?\(/);
    for (const pattern of shows) expect(src).toMatch(pattern);
  });
});

describe("demandes de pièce en échec", () => {
  const src = read("client/src/pages/inventory/requests.tsx");

  it("pas de compteur « 0 demande » à côté de l'encart d'erreur", () => {
    expect(src).toMatch(/\{!requestsFailed && \(\s*<span[^>]*data-testid="requests-count"/);
  });

  it("« Passer la commande » désactivé avec un motif", () => {
    const button = src.slice(src.lastIndexOf("<button", src.indexOf("btn-manage-request-")), src.indexOf("btn-manage-request-"));
    expect(button).toMatch(/disabled=\{requestsFailed\}/);
    expect(button).toMatch(/title=\{requestsFailed \? "[^"]+" : undefined\}/);
  });
});

describe("valeur du stock : jamais 0 sur une lecture en échec", () => {
  it("accueil stock : statistiques par queryView, tuiles valeur et quantité « Indisponible »", () => {
    const src = read("client/src/pages/inventory/index.tsx");
    expect(queryDeclaration(src, '"/api/parts/statistics"')).toMatch(/const statsQuery = useQuery/);
    expect(src).toMatch(/const statsView = queryView\(statsQuery\)/);
    expect(src).toMatch(/data-testid="kpi-stock-value-value">\{statsFailed \? UNAVAILABLE : formatPrice\(totalStockValue\)\}/);
    expect(src).toMatch(/data-testid="kpi-stock-items-value">\{statsFailed \? UNAVAILABLE : totalItems\}/);
  });

  it("tableau de bord magasin : tuile « Valeur stock total » « Indisponible »", () => {
    const src = read("client/src/pages/warehouse/dashboard.tsx");
    expect(src).not.toMatch(/inventoryValue\.data\?\.totalValue \|\| 0/);
    expect(src).toMatch(/const inventoryValueView = queryView\(/);
    expect(src).toMatch(/value=\{inventoryValueFailed \? UNAVAILABLE : formatPrice\(totalStockValue\)\}/);
  });
});

describe("fiche OT : pièces non lues", () => {
  const src = read("client/src/pages/maintenance/work-orders/[id].tsx");

  it("le coût passe « inconnu » au calcul, pas une liste vide", () => {
    expect(src).toMatch(/parts:\s*partsUsedView\.kind === "ready" \? partsUsed : undefined/);
  });

  it("l'impression est refusée tant que les pièces ne sont pas lues", () => {
    const print = src.slice(src.indexOf("const handlePrintWorkOrder"), src.indexOf("const doc = new jsPDF"));
    expect(print).toMatch(/partsUsedView\.kind !== "ready"[\s\S]*return;/);
  });

  it("« Aucune pièce utilisée » n'apparaît qu'une fois les pièces lues", () => {
    expect(src).toMatch(/partsUsedView\.kind === "ready" \? \(\s*<div[^>]*>[\s\S]{0,400}Aucune pièce utilisée dans cet ordre de travail/);
  });
});

describe("rapport PDF des coûts de maintenance", () => {
  const src = read("client/src/lib/pdf-export.ts");
  const report = src.slice(src.indexOf("export async function exportMaintenanceCostReport"), src.indexOf("export async function exportFuelConsumptionReport"));

  it("pièces d'OT illisibles : le rapport échoue au lieu de compter 0 ou l'estimation", () => {
    expect(report).toMatch(/if \(!Array\.isArray\(orderParts\)\) \{\s*throw new Error/);
    expect(report).not.toMatch(/realTotalCost \+= order\.estimatedCost/);
  });

  it("ordres de travail illisibles : pas de rapport à « 0 intervention »", () => {
    expect(report).toMatch(/if \(!workOrdersResponse\.ok\) \{\s*throw new Error/);
  });
});
