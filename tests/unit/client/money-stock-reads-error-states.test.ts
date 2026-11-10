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
    queryKeys: ['queryKey: ["/api/part-requirements"]', '"/api/work-orders/awaiting-parts"'],
    shows: [/data-testid="requests-error"/, /UNAVAILABLE/, /awaitingPartsView\.kind === "error" && \(\s*<InlineQueryError data-testid="awaiting-parts-error"/],
  },
  {
    path: "client/src/pages/inventory/index.tsx",
    queryKeys: ['queryKey: ["/api/part-requirements"]', '"/api/parts/stock-movements"', '"/api/parts/low-on-stock"'],
    shows: [/UNAVAILABLE/, /data-testid="kpi-low-stock-value">\{lowStockFailed \? UNAVAILABLE : lowStockCount\}/],
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
    queryKeys: ['queryKey: ["/api/part-requirements"]', '"/api/purchase-orders/group-suggestions"', '"/api/parts/low-on-stock"'],
    shows: [/data-testid="order-requirements-error"/, /data-testid="order-suggestions-error"/],
  },
  {
    path: "client/src/components/inventory/part-table.tsx",
    queryKeys: ["`/api/part-requirements/by-part/", '"/api/part-requirements/active-by-part"', '"/api/parts",'],
    shows: [/data-testid="parts-error"/, /data-testid="part-requirements-error"/, /data-testid="active-requirements-error"/, /if \(activeRequirementsFailed\) \{\s*return <span[^>]*>\{UNAVAILABLE\}/],
  },
  {
    path: "client/src/pages/inventory/[id].tsx",
    queryKeys: ["`/api/parts/${partId}/stock-history`", "`/api/parts/${partId}/usage-history`", "`/api/parts/${partId}/work-orders`"],
    shows: [
      /value: usageFailed \? UNAVAILABLE : `\$\{consumptionRate/,
      /value: usageFailed \? UNAVAILABLE : daysRemaining > 365/,
      /usageView\.kind === "error" \? \(\s*<InlineQueryError\s*data-testid="part-usage-error"/,
      /workOrdersView\.kind === "error" \? workOrdersError\("part-overview-work-orders-error"\) : workOrders\.length === 0/,
      /workOrdersView\.kind === "error" \? workOrdersError\("part-work-orders-error"\) : workOrders\.length === 0/,
      /stockHistoryView\.kind === "error" \? \(\s*stockHistoryError\("stock-history-recent-error"\)\s*\) : stockHistory\.length === 0/,
      /stockHistoryView\.kind === "error" \? \(\s*stockHistoryError\("stock-history-error"\)\s*\) : stockHistory\.length === 0/,
    ],
  },
  {
    path: "client/src/pages/reports/index.tsx",
    queryKeys: ['"/api/parts/statistics"'],
    shows: [/value: lowStockFailed \? UNAVAILABLE : lowStockCount/],
  },
  {
    path: "client/src/pages/procurement/orders/index.tsx",
    queryKeys: ['"/api/purchase-orders", { status', '"/api/purchase-orders/statistics"'],
    shows: [/data-testid="orders-error"/, /data-testid="orders-stats-error"/, /\{!ordersFailed && \(\s*<span[^>]*data-testid="orders-count"/],
  },
  {
    path: "client/src/pages/procurement/orders/group.tsx",
    queryKeys: ['"/api/purchase-orders/group-suggestions"'],
    shows: [/data-testid="group-suggestions-error"/],
  },
  {
    path: "client/src/pages/maintenance/work-orders/[id].tsx",
    queryKeys: [
      "`/api/work-orders/${workOrderId}/parts`",
      "`/api/part-requirements/by-part/",
      "`/api/work-orders/${workOrderId}/pending-part-requirements`",
    ],
    shows: [/data-testid="parts-used-error"/, /data-testid="existing-requests-error"/, /data-testid="pending-requirements-error"/],
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

  it("onglet Pièces : pas de compte tant que pièces utilisées et demandes en attente ne sont pas lues", () => {
    expect(src).toMatch(/const partsCountKnown = partsUsedView\.kind === "ready" && pendingPartRequirementsView\.kind === "ready"/);
    expect(src).toMatch(/label: partsCountKnown && displayedPartsCount > 0 \?/);
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

  it("ordres de travail : tous lus page par page, pas les 50 premiers d'un appel sans limite", () => {
    expect(report).toMatch(/const workOrders = await fetchAllWorkOrders\(\)/);
    expect(report).not.toMatch(/fetch\(['"`]\/api\/work-orders['"`]\)/);
  });

  it("véhicules ou utilisateurs illisibles : refus, pas des lignes « N/A »", () => {
    // Véhicules : `fetchAllVehicles` refuse lui-même (ReportRefusedError) une lecture incomplète.
    expect(report).toMatch(/const vehicles = await fetchAllVehicles\(\)/);
    // Utilisateurs : `/api/users` ne pagine pas ; `fetchAllUsers` refuse un échec et borne le volume.
    expect(report).toMatch(/const usersList = await fetchAllUsers\(\)/);
    expect(report).not.toMatch(/fetch\(['"`]\/api\/users['"`]\)/);
  });

  it("plus de lecture de /api/parts/used, qui ne nourrissait aucun calcul", () => {
    expect(report).not.toMatch(/\/api\/parts\/used/);
  });

  it("un refus de rapport garde son message lisible", () => {
    expect(report).toMatch(/if \(error instanceof ReportRefusedError\) throw error;/);
  });
});

describe("rapports PDF : véhicules lus en entier, logs migrés", () => {
  const src = read("client/src/lib/pdf-export.ts");
  const section = (start: string, end: string) => {
    // Repère absent : indexOf rend -1 et la section courrait jusqu'à la fin du fichier.
    expect(src.indexOf(start)).toBeGreaterThanOrEqual(0);
    expect(src.indexOf(end)).toBeGreaterThan(src.indexOf(start));
    return src.slice(src.indexOf(start), src.indexOf(end));
  };

  it("aucun console.* : tout passe par clientLogger", () => {
    expect(src).not.toMatch(/\bconsole\./);
    expect(src).toMatch(/import \{ clientLogger \} from ['"]@\/lib\/logger['"]/);
  });

  it("plus de lecture des véhicules plafonnée à 1000 : page par page", () => {
    expect(src).not.toMatch(/\/api\/vehicles\?limit=1000/);
    expect(src.match(/= await fetchAllVehicles\(\)/g)).toHaveLength(3);
  });

  it("pleins de carburant illisibles : refus, jamais un rapport carburant à 0", () => {
    expect(src).not.toMatch(/Array\.isArray\(fuelData\) \? fuelData : \[\]/);
    expect(src).not.toMatch(/fetch\(['"`]\/api\/fuel-records['"`]\)/);
    expect(src.match(/= await fetchFuelRecords\(\)/g)).toHaveLength(2);
  });

  it.each([
    ["utilisation", "export async function exportVehicleUsageReport", "export async function exportMaintenanceCostReport"],
    ["carburant", "export async function exportFuelConsumptionReport", "export async function exportPartsInventoryReport"],
    ["coûts", "export async function exportMaintenanceCostReport", "export async function exportFuelConsumptionReport"],
  ])("rapport %s : un refus garde son message lisible, son détail est journalisé", (_, start, end) => {
    expect(section(start, end)).toMatch(/if \(error instanceof ReportRefusedError\) throw error;/);
    expect(section(start, end)).toMatch(/clientLogger\.error\([^)]*, reportErrorContext\(error\)\);/);
  });
});

describe("valeur du stock et alertes de réappro : jamais 0 sur une lecture en échec", () => {
  it("useWarehouse : pas d'alertes calculées sur une seule des deux sources, vue exposée", () => {
    const src = read("client/src/hooks/useWarehouse.ts");
    expect(src).toMatch(/const derivedReorderAlerts = reorderSourcesFailed\s*\?\s*undefined/);
    expect(src).toMatch(/!!partRequirementsQuery\.error && !Array\.isArray\(partRequirementsQuery\.data\)/);
    expect(src).toMatch(/view: inventoryValueView,\s*failed: inventoryValueView\.kind === "error"/);
    expect(src).toMatch(/isFetching: reorderAlertsFetching,/);
    expect(src).toMatch(/view: reorderAlertsView,\s*failed: reorderAlertsView\.kind === "error"/);
  });

  it("useWarehouse : l'échec de l'agrégat serveur (403) n'affiche pas « Indisponible » pendant que les sources chargent", () => {
    const src = read("client/src/hooks/useWarehouse.ts");
    expect(src).toMatch(/const reorderAlertsError = lowStockPartsQuery\.error \|\| partRequirementsQuery\.error;/);
  });

  const DASHBOARDS = [
    "client/src/pages/admin/dashboard.tsx",
    "client/src/pages/dashboard.tsx",
    "client/src/pages/workshop-manager/dashboard.tsx",
    "client/src/pages/warehouse/dashboard.tsx",
  ];

  it.each(DASHBOARDS)("%s : « Indisponible » au lieu de 0", (path) => {
    const src = read(path);
    expect(src).not.toMatch(/inventoryValue\.data\?\.total(Value|Parts) \|\| 0/);
    expect(src).not.toMatch(/reorderAlerts\.data(\s*as any\))?\?\.(totalAlerts|estimatedCost) \|\| 0/);
    expect(src).toMatch(/warehouse\.reorderAlerts\.failed/);
    expect(src).toMatch(/UNAVAILABLE/);
  });

  it("workshop-manager/dashboard : compteur sous seuil « Indisponible » quand les statistiques échouent", () => {
    const src = read("client/src/pages/workshop-manager/dashboard.tsx");
    expect(src).toMatch(/const stockStatsFailed = warehouse\.statistics\.data === undefined && !!warehouse\.statistics\.error/);
    expect(src).toMatch(/subValue=\{stockStatsFailed \? UNAVAILABLE : `\$\{stockRiskCount\} références sous seuil`\}/);
    expect(src).toMatch(/value=\{stockStatsFailed \? UNAVAILABLE : ofStockParts\(stockRiskCount\)\}/);
  });

  it("admin/dashboard : tuile pièces « Indisponible » quand les statistiques échouent", () => {
    const src = read("client/src/pages/admin/dashboard.tsx");
    expect(src).toMatch(/const statsFailed = warehouse\.statistics\.data === undefined && !!warehouse\.statistics\.error/);
    expect(src).toMatch(/value=\{statsFailed \? UNAVAILABLE : formatNumber\(warehouse\.statistics\.data\?\.totalParts/);
  });

  it("warehouse/dashboard : tuiles pièces, stock bas et répartition « Indisponible », sans couleur d'alerte", () => {
    const src = read("client/src/pages/warehouse/dashboard.tsx");
    expect(src).toMatch(/const statsFailed = warehouse\.statistics\.data === undefined && !!warehouse\.statistics\.error/);
    expect(src).toMatch(/value=\{statsFailed \? UNAVAILABLE : totalUnitsCount\}/);
    expect(src).toMatch(/value=\{statsFailed \? UNAVAILABLE : lowStockCount\}/);
    expect(src).toMatch(/valueClassName=\{!statsFailed && \(lowStockCount/);
    expect(src).toMatch(/statsFailed \? \(<div[^>]*>\{UNAVAILABLE\}<\/div>\)\s*:\s*alertSummaryData/);
  });

  it.each(DASHBOARDS.filter((p) => !p.includes("warehouse/")))("%s : valeur du stock « Indisponible »", (path) => {
    expect(read(path)).toMatch(/warehouse\.inventoryValue\.failed/);
  });

  it("tableau de bord magasin : encart au lieu de « Aucune alerte de réapprovisionnement »", () => {
    const src = read("client/src/pages/warehouse/dashboard.tsx");
    expect(src).toMatch(/data-testid="warehouse-reorder-error"/);
    expect(src).toMatch(/!warehouse\.reorderAlerts\.isLoading && !reorderFailed && alertParts\.length === 0/);
    expect(src).toMatch(/\) : reorderFailed \? \(\s*reorderAlertsError\s*\) : alertParts\.length > 0/);
  });

  it("panneau d'alertes : encart, pas « Tout est à jour », si les alertes de stock sont illisibles", () => {
    const src = read("client/src/components/alerts/alerts-panel.tsx");
    expect(src).toMatch(/const reorderAlertsView = queryView\(reorderAlertsQuery\)/);
    expect(src).toMatch(/data-testid="alerts-reorder-error"/);
    expect(src).toMatch(/emptyState=\{\s*reorderAlertsFailed( \|\| alertsFailed)? \?/);
  });
});

describe("carte carburant et pleins : jamais 0 sur une lecture en échec", () => {
  it("le hook expose `failed` sur le solde", () => {
    expect(read("client/src/hooks/useFuelCard.ts")).toMatch(/failed: balanceQuery\.data === undefined && !!balanceQuery\.error/);
  });

  it.each(["client/src/pages/dashboard.tsx", "client/src/pages/logistics/dashboard.tsx", "client/src/pages/client/dashboard.tsx"])(
    "%s : le solde en échec lit UNAVAILABLE",
    (path) => {
      const src = read(path);
      expect(src).toMatch(/fuelCard\.balance\.failed/);
      expect(src).toMatch(/(fuelCardFailed|fuelCard\.balance\.failed) \? UNAVAILABLE : formatPrice\(/);
    },
  );

  it("fuel/index : solde, pleins et « Solde actuel » gardés par l'échec", () => {
    const src = read("client/src/pages/fuel/index.tsx");
    expect(src).toMatch(/const fuelRecordsFailed = fuelRecordsData === undefined && !!fuelRecordsError/);
    expect(src).toMatch(/const fuelCardFailed = fuelCardBalance === undefined && !!fuelCardBalanceError/);
    expect(src).toMatch(/fuelRecordsFailed \? UNAVAILABLE : formatCurrency\(totalCost\)/);
    expect(src).toMatch(/fuelCardFailed \? UNAVAILABLE : formatCurrency\(Number\(fuelCardBalance\?\.balance/);
  });

  it("fuel-statistics : litres, coût, prix moyen et nb de pleins gardés par l'échec", () => {
    const src = read("client/src/components/fuel/fuel-statistics.tsx");
    expect(src).toMatch(/const statsFailed = fuelStatistics === undefined && !!fuelStatisticsError/);
    expect(src).toMatch(/const historyFailed = consumptionHistory === undefined && !!consumptionHistoryError/);
    expect((src.match(/statsFailed\s*\? UNAVAILABLE/g) ?? []).length).toBe(3);
    expect(src).toMatch(/historyFailed\s*\? UNAVAILABLE/);
  });
});

describe("factures : jamais 0 ni vide sur une lecture en échec", () => {
  it("operations/invoices : tuiles, compteur et liste gardés par l'échec", () => {
    const src = read("client/src/pages/operations/invoices/index.tsx");
    expect(src).toMatch(/const failed = data === undefined && !!error/);
    expect(src).toMatch(/failed \? UNAVAILABLE : formatCurrency\(summary\.totalAmountTTC\)/);
    expect(src).toMatch(/failed \? UNAVAILABLE : formatCurrency\(summary\.totalPaid\)/);
    expect(src).toMatch(/failed \? UNAVAILABLE : formatCurrency\(summary\.totalBalance\)/);
    expect(src).toMatch(/\) : failed \? \(/);
    expect(src).toMatch(/userMessageOf\(error,/);
  });

  it("invoicing-dashboard : l'échec a son état, distinct du vrai vide", () => {
    const src = read("client/src/components/operations/invoicing-dashboard.tsx");
    expect(src).toMatch(/if \(!stats && error\)/);
    expect(src).toMatch(/data-testid="invoicing-dashboard-error"/);
    expect(src).toMatch(/userMessageOf\(error,/);
    expect(src).toMatch(/Aucune donnée disponible/);
  });

  it("procurement/invoices : plus de repli sur la liste après un échec de /statistics", () => {
    const src = read("client/src/pages/procurement/invoices/index.tsx");
    expect(src).toMatch(/const listFailed = rawInvoicesData === undefined && !!listError/);
    expect(src).toMatch(/const statsFailed = stats === undefined && !!statsError/);
    expect(src).toMatch(/const moneyFromList = !stats && !statsFailed && !listFailed/);
    expect(src).toMatch(/amount === null \? UNAVAILABLE/);
    expect(src).toMatch(/listFailed \? UNAVAILABLE : String\(n\)/);
    expect(src).toMatch(/data-testid="invoices-load-error"/);
  });

  it("discrepancies : tuiles et liste gardées par l'échec", () => {
    const src = read("client/src/pages/procurement/invoices/discrepancies.tsx");
    expect(src).toMatch(/const failed = data === undefined && !!error/);
    expect(src).toMatch(/failed \? UNAVAILABLE : discrepancies\.length/);
    expect(src).toMatch(/failed \? UNAVAILABLE : formatCurrency\(totalDiscrepancyAmount\)/);
    expect(src).toMatch(/data-testid="discrepancies-load-error"/);
  });

  it("procurement/invoices/[id] : règlements illisibles, pas de bouton de paiement ni de montant", () => {
    const src = read("client/src/pages/procurement/invoices/[id].tsx");
    expect(src).toMatch(/const settlementsFailed = settlementsData === undefined && !!settlementsError/);
    expect(src).toMatch(/canPay && settlementsData !== undefined && !settlementsFailed && remainingToRecord > 0\.01/);
    expect(src).toMatch(/canPay && settlementsData !== undefined && !settlementsFailed && hasRecordedSettlement/);
    expect(src).toMatch(/settlementsFailed \? UNAVAILABLE : formatCurrency\(reconciledAmount\)/);
    expect(src).toMatch(/settlementsFailed \? UNAVAILABLE : formatCurrency\(pendingReconciliationAmount\)/);
    expect(src).toMatch(/data-testid="settlements-load-error"/);
  });

  it.each(["client/src/pages/logistics/dashboard.tsx", "client/src/pages/client/dashboard.tsx"])(
    "%s : le volume de carburant en échec lit UNAVAILABLE avec userMessageOf",
    (path) => {
      const src = read(path);
      expect(src).toMatch(/const fuelStatsFailed = fuelStats === undefined && !!fuelStatsError/);
      expect(src).toMatch(/fuelStatsFailed \? UNAVAILABLE : `\$\{totalFuelLiters\.toFixed\(0\)\} L`/);
      expect(src).toMatch(/userMessageOf\(fuelStatsError,/);
    },
  );
});
