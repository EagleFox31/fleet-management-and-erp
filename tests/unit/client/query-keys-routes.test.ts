import { join } from "path";
import { describe, expect, it } from "vitest";
import { extractQueryKeyUrls, matchesServed, scanUnservedQueryKeys } from "../../support/query-route-scan";

/**
 * Garde-fou #280 : une `queryKey` lue par le `queryFn` par défaut est une URL ; sans route GET
 * correspondante, elle part en 404, que TanStack réessaie à chaque montage. Cas d'origine :
 * `useWarehouse` interrogeait `/api/parts/by-supplier` (la route est `/api/warehouse/parts-by-supplier`)
 * depuis les tableaux de bord, sans qu'aucun écran ne lise la donnée.
 *
 * Liste gelée des écarts existants au 4 novembre 2026, à traiter un par un (brancher la bonne route
 * ou retirer la query). Elle ne peut que rétrécir : une entrée corrigée doit en sortir, toute
 * nouvelle entrée est une régression.
 */
const UNSERVED_QUERY_KEYS_FROZEN: string[] = [
  "client/src/components/charts/fuel-consumption-chart.tsx /api/fuel-card/consumption-history",
  "client/src/components/maintenance/work-order-form.tsx /api/maintenance-schedules/vehicle",
  "client/src/hooks/useAlerts.ts /api/alerts/type",
  "client/src/hooks/useBilling.ts /api/invoices/unpaid",
  "client/src/hooks/useFuelCard.ts /api/fuel-card/vehicle",
  "client/src/hooks/useMaintenance.ts /api/maintenance/faults",
  "client/src/hooks/useMaintenance.ts /api/maintenance/preventive",
  "client/src/hooks/useMaintenance.ts /api/maintenance/stats",
  "client/src/hooks/useVehicles.ts /api/vehicles/registration",
  "client/src/hooks/useVehicles.ts /api/vehicles/stats",
  "client/src/hooks/useVehicles.ts /api/vehicles/status-summary",
  "client/src/hooks/useWarehouse.ts /api/warehouse/parts",
  "client/src/pages/inventory/parts-database.tsx /api/parts/categories",
  "client/src/pages/procurement/orders/group.tsx /api/purchase-orders/optimize-timing/${selectedGroup}",
  "client/src/pages/workflows/documents.tsx /api/workflows/all-with-documents",
];

const root = process.cwd();

describe("queryKey du client : chaque URL a une route GET (#280)", () => {
  it("aucun nouvel écart hors de la liste gelée, et la liste ne garde que des écarts réels", () => {
    const misses = scanUnservedQueryKeys(join(root, "client", "src"), join(root, "server"), root);
    expect(misses.filter((m) => !UNSERVED_QUERY_KEYS_FROZEN.includes(m)), "query sans route (404 réessayé)").toEqual([]);
    expect(UNSERVED_QUERY_KEYS_FROZEN.filter((m) => !misses.includes(m)), "entrée corrigée : la retirer de la liste gelée").toEqual([]);
  });

  it("le cas d'origine est rouge : un segment littéral n'est pas un paramètre de route", () => {
    const served = [["api", "parts", ":p"], ["api", "warehouse", "parts-by-supplier"]];
    expect(matchesServed({ url: "/api/parts/by-supplier", mode: "fetch" }, served)).toBe(false);
    expect(matchesServed({ url: "/api/warehouse/parts-by-supplier", mode: "fetch" }, served)).toBe(true);
    expect(matchesServed({ url: "/api/parts/12", mode: "fetch" }, served)).toBe(true);
    expect(matchesServed({ url: "/api/parts/${id}", mode: "fetch" }, served)).toBe(true);
  });

  it("ne retient ni une query à queryFn propre, et classe l'invalidation à part", () => {
    const source = `
      useQuery({ queryKey: ['/api/a'] });
      useQuery({ queryKey: ['/api/b'], queryFn: () => fetchB() });
      queryClient.invalidateQueries({ queryKey: ['/api/c'] });
    `;
    expect(extractQueryKeyUrls("f.ts", source)).toEqual([
      { file: "f.ts", url: "/api/a", mode: "fetch" },
      { file: "f.ts", url: "/api/c", mode: "prefix" },
    ]);
  });
});
