import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

/**
 * Rendu serveur (react-dom/server) : complète `money-stock-reads-error-states.test.ts`, dont les
 * regex lisent le source sans prouver ce que l'écran affiche. Ici la requête de statistiques de
 * stock est mise en erreur dans le cache, la page est rendue, et la tuile doit lire
 * « Indisponible », jamais un 0 présenté comme une vraie valeur.
 *
 * Mise en erreur : `queryCache.build(client, { queryKey }).setState({ status: "error", ... })`
 * (aucun réseau ni timer, `retry: false`), les autres requêtes sont alimentées par `setQueryData`.
 */

vi.mock("wouter", () => ({
  useLocation: () => ["/", () => {}],
  Link: ({ children }: { children?: React.ReactNode }) => React.createElement("a", null, children),
  useRoute: () => [false, {}],
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, role: "admin" }, isAuthenticated: true, isLoading: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => {} }) }));
vi.mock("@/lib/queryClient", async () => {
  const { QueryClient: QC } = await import("@tanstack/react-query");
  return { queryClient: new QC(), apiRequest: async () => ({}) };
});
vi.mock("@/lib/pdf-export", () => ({ exportInventoryToPDF: () => {} }));
vi.mock("@/hooks/use-form-draft", () => ({
  useFormDraft: () => ({ draftSavedAt: null, clearDraft: () => {}, discardDraft: () => {} }),
}));

// Les pages utilisent le runtime JSX classique (React global) : absent en environnement node.
(globalThis as { React?: typeof React }).React = React;
// Premier import des pages (arbre de composants complet) : lent à froid.
vi.setConfig({ testTimeout: 60_000 });

type Outcome = { data: unknown } | { error: Error } | { data: unknown; error: Error };
type Seed = Array<[readonly unknown[], Outcome]>;

function render(Page: React.ComponentType, seed: Seed): string {
  // `retryOnMount: false` : sans cela, une requête en erreur est relancée au montage et le rendu
  // la voit « en chargement », pas « en échec ».
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryOnMount: false, staleTime: Infinity } },
  });
  for (const [queryKey, outcome] of seed) {
    const query = client.getQueryCache().build(client, { queryKey });
    if ("error" in outcome && "data" in outcome) {
      // Relance échouée, données en cache conservées : l'écran doit les afficher.
      client.setQueryData(queryKey, outcome.data);
      query.setState({ ...query.state, status: "error", error: outcome.error, errorUpdateCount: 1, errorUpdatedAt: Date.now() });
    } else if ("error" in outcome) {
      query.setState({
        status: "error",
        error: outcome.error,
        data: undefined,
        fetchStatus: "idle",
        errorUpdateCount: 1,
        errorUpdatedAt: Date.now(),
      });
    } else {
      client.setQueryData(queryKey, outcome.data);
    }
  }
  return renderToStaticMarkup(
    React.createElement(QueryClientProvider, { client }, React.createElement(Page)),
  );
}

const KEY = {
  stats: "/api/parts/statistics",
  lowOnStock: "/api/parts/low-on-stock",
};
const STATS_OK = {
  totalParts: "34",
  totalQuantity: "120",
  lowStockCount: "5",
  outOfStockCount: "2",
  totalValue: "1500000",
  totalItems: 12,
};
/** 5 pièces sous le seuil et 2 épuisées : le hook en tire « stock bas » = 5 et « épuisé » = 2. */
const LOW_PARTS = [
  ...[1, 2, 3, 4, 5].map((id) => ({ id, name: `Pièce ${id}`, quantity: 1, minQuantity: 5, unitPrice: 10 })),
  ...[6, 7].map((id) => ({ id, name: `Pièce ${id}`, quantity: 0, minQuantity: 5, unitPrice: 10 })),
];
const FAILURE ={ error: new Error("boom") };

/** Réponses saines de toutes les requêtes lues par les trois écrans, sauf celles surchargées. */
function seedWith(overrides: Record<string, Outcome>): Seed {
  const base: Record<string, Outcome> = {
    [KEY.stats]: { data: STATS_OK },
    [KEY.lowOnStock]: { data: LOW_PARTS },
    "/api/part-requirements": { data: [] },
    "/api/parts/stock-movements": { data: [] },
    "/api/warehouse/reorder-alerts": { data: { totalAlerts: 3 } },
    "/api/warehouse/statistics": { data: {} },
    "/api/tires/statistics": { data: {} },
    "/api/tires/low-stock": { data: [] },
    "/api/work-orders/statistics": { data: {} },
    "/api/users/technicians": { data: [] },
    "/api/work-orders": { data: {} },
    "/api/statistics/fleet": { data: {} },
    "/api/statistics/maintenance-compliance": { data: {} },
    "/api/drivers/cpc-statistics": { data: {} },
    "/api/drivers/cpc-status": { data: [] },
  };
  return Object.entries({ ...base, ...overrides }).map(([key, outcome]) => [[key], outcome]);
}

/**
 * Statistiques ET liste « stock bas » en échec : sinon le hook recompose des compteurs depuis les
 * pièces en alerte et la tuile n'est plus « sans donnée » (comportement voulu, hors sujet ici).
 */
const STATS_DOWN = seedWith({ [KEY.stats]: FAILURE, [KEY.lowOnStock]: FAILURE });

/** Texte de la valeur d'une tuile : le `<p>` qui suit le `<p>` portant son libellé. */
function tileValue(html: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<p[^>]*>${escaped}</p><p[^>]*>((?:(?!</p>).)*)</p>`));
  expect(match, `tuile « ${label} » absente du rendu`).not.toBeNull();
  return match![1].replace(/<[^>]*>/g, "").trim();
}

/** Sous-valeur d'une tuile : le deuxième `<p>` après celui de son libellé. */
function tileSubValue(html: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<p[^>]*>${escaped}</p><p[^>]*>(?:(?!</p>).)*</p><p[^>]*>((?:(?!</p>).)*)</p>`));
  expect(match, `sous-valeur de « ${label} » absente du rendu`).not.toBeNull();
  return match![1].replace(/<[^>]*>/g, "").trim();
}

describe("rendu: stock en échec affiche Indisponible, jamais 0", () => {
  describe("inventaire (inventory/index)", () => {
    it("échec : « Pièces en stock » et valeur du stock lisent Indisponible", async () => {
      const { default: Page } = await import("@/pages/inventory/index");
      const html = render(Page, STATS_DOWN);
      expect(html).toContain("Indisponible");
      expect(tileValue(html, "Pièces en stock")).toBe("Indisponible");
      expect(tileValue(html, "Valeur du stock")).toBe("Indisponible");
    });

    it("témoin : données saines, la tuile montre 12", async () => {
      const { default: Page } = await import("@/pages/inventory/index");
      const html = render(Page, seedWith({}));
      expect(tileValue(html, "Pièces en stock")).toBe("12");
    });
  });

  describe("tableau de bord magasin (warehouse/dashboard)", () => {
    it("échec : « Pièces en stock » et « Stock bas » lisent Indisponible", async () => {
      const { default: Page } = await import("@/pages/warehouse/dashboard");
      const html = render(Page, STATS_DOWN);
      expect(html).toContain("Indisponible");
      expect(tileValue(html, "Pièces en stock")).toBe("Indisponible");
      expect(tileValue(html, "Stock bas")).toBe("Indisponible");
    });

    it("relance échouée mais statistiques en cache : la valeur moyenne par pièce reste affichée (statsFailed, pas statistics.error)", async () => {
      const { default: Page } = await import("@/pages/warehouse/dashboard");
      const html = render(Page, seedWith({ [KEY.stats]: { data: STATS_OK, error: new Error("boom") } }));
      expect(tileSubValue(html, "Valeur stock total")).toContain("en moyenne par pièce");
      expect(tileValue(html, "Pièces en stock")).toBe("120");
    });

    it("témoin : données saines, les tuiles montrent 120 unités et 5 stocks bas", async () => {
      const { default: Page } = await import("@/pages/warehouse/dashboard");
      const html = render(Page, seedWith({}));
      expect(tileValue(html, "Pièces en stock")).toBe("120");
      expect(tileValue(html, "Stock bas")).toBe("5");
    });
  });

  describe("tableau de bord atelier (workshop-manager/dashboard)", () => {
    it("échec : la sous-valeur de « Alertes stock magasin » (stockRiskCount) lit Indisponible", async () => {
      const { default: Page } = await import("@/pages/workshop-manager/dashboard");
      const html = render(Page, STATS_DOWN);
      expect(html).toContain("Indisponible");
      expect(tileSubValue(html, "Alertes stock magasin")).toBe("Indisponible");
    });

    it("témoin : données saines, la sous-valeur montre 7 références (5 + 2)", async () => {
      const { default: Page } = await import("@/pages/workshop-manager/dashboard");
      const html = render(Page, seedWith({}));
      expect(tileSubValue(html, "Alertes stock magasin")).toBe("7 références sous seuil");
    });
  });
});
