import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

/**
 * Lot C stock et achats, rendu serveur (react-dom/server) : la lecture visée est mise en erreur
 * dans le cache, la page est rendue, et l'écran doit montrer l'erreur, jamais « 0 » ni « Aucune … »
 * présentés comme de vraies valeurs. Complète `money-stock-reads-error-states.test.ts`.
 *
 * Mise en erreur : `queryCache.build(client, { queryKey }).setState({ status: "error", ... })`
 * (aucun réseau ni timer, `retry: false`), les autres requêtes sont alimentées par `setQueryData`.
 */

vi.mock("wouter", () => ({
  useLocation: () => ["/", () => {}],
  Link: ({ children }: { children?: React.ReactNode }) => React.createElement("a", null, children),
  useRoute: () => [false, {}],
}));
const auth = vi.hoisted(() => ({ role: "admin" }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, role: auth.role }, isAuthenticated: true, isLoading: false }),
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

/**
 * Onglets Radix : le contenu d'un onglet inactif n'est pas rendu, et `Tabs` n'a que `defaultValue`
 * (aucun état, URL ou stockage ne permet d'ouvrir un autre onglet). Pour rendre « Alertes » du
 * magasin et « Inventaire & Pièces » de l'atelier sans toucher au produit, ces primitives sont
 * remplacées par des équivalents sans contexte Radix : `activeTab` (si défini) l'emporte sur
 * `defaultValue`. Le contenu des onglets reste celui des pages.
 */
const tabs = vi.hoisted(() => ({ activeTab: undefined as string | undefined }));
vi.mock("@/components/ui/tabs", async () => {
  const R = await import("react");
  const Ctx = R.createContext<string | undefined>(undefined);
  return {
    Tabs: ({ defaultValue, children }: { defaultValue?: string; children?: React.ReactNode }) =>
      R.createElement(Ctx.Provider, { value: tabs.activeTab ?? defaultValue }, R.createElement("div", null, children)),
    TabsList: ({ children }: { children?: React.ReactNode }) => R.createElement("div", null, children),
    TabsTrigger: ({ children }: { children?: React.ReactNode }) => R.createElement("button", null, children),
    TabsContent: ({ value, children }: { value: string; children?: React.ReactNode }) => {
      const active = R.useContext(Ctx);
      return value === active ? R.createElement("div", null, children) : null;
    },
  };
});

// Les pages utilisent le runtime JSX classique (React global) : absent en environnement node.
(globalThis as { React?: typeof React }).React = React;
// Premier import des pages (arbre de composants complet) : lent à froid.
vi.setConfig({ testTimeout: 60_000 });

type Outcome = { data: unknown } | { error: Error } | { data: unknown; error: Error };
type Seed = Array<[readonly unknown[], Outcome]>;

function render(Page: React.ComponentType, seed: Seed, activeTab?: string): string {
  tabs.activeTab = activeTab;
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

const boom = () => new Error("timeout exceeded when trying to connect");
const ORDERS_KEY = ["/api/purchase-orders", { status: "" }] as const;
const GROUP_KEY = ["/api/purchase-orders/group-suggestions", { minRequirements: 2, maxDaysOld: 30, urgencyThreshold: "medium" }] as const;
const LOW_KEY = ["/api/parts/low-on-stock"] as const;
/** Lectures saines de l'accueil stock, hors celles visées par le cas. */
const INVENTORY_OK: Array<[readonly unknown[], { data: unknown }]> = [
  [["/api/parts/statistics"], { data: { totalParts: "34", totalQuantity: "120", lowStockCount: "0", outOfStockCount: "0", totalValue: "1500000", totalItems: 12 } }],
  [["/api/part-requirements"], { data: [] }],
  [["/api/parts/stock-movements"], { data: [] }],
];
const PARTS_KEY = ["/api/parts", { search: "", sort_by: "reference", sort_order: "asc", limit: 10, offset: 0 }] as const;

describe("lot C : lectures stock et achats en échec", () => {
  it("commandes : encart d'erreur, ni « Aucune commande trouvée » ni compteur", async () => {
    const { default: Page } = await import("@/pages/procurement/orders/index");
    const html = render(Page, [[ORDERS_KEY, { error: boom() }], [["/api/purchase-orders/statistics"], { error: boom() }]]);
    expect(html).toContain('data-testid="orders-error"');
    expect(html).toContain('data-testid="orders-stats-error"');
    expect(html).not.toContain("Aucune commande trouvée");
    expect(html).not.toContain('data-testid="orders-count"');
  });

  it("commandes, témoin : liste vide lue, « Aucune commande trouvée »", async () => {
    const { default: Page } = await import("@/pages/procurement/orders/index");
    const html = render(Page, [[ORDERS_KEY, { data: [] }]]);
    expect(html).toContain("Aucune commande trouvée");
    expect(html).not.toContain('data-testid="orders-error"');
  });

  it("regroupement : encart d'erreur, pas « Aucune suggestion »", async () => {
    const { default: Page } = await import("@/pages/procurement/orders/group");
    const html = render(Page, [[GROUP_KEY, { error: boom() }]]);
    expect(html).toContain('data-testid="group-suggestions-error"');
    expect(html).not.toContain("Aucune suggestion de regroupement disponible");
  });

  it("regroupement, logistique (hors périmètre pièces, 403 serveur) : explication, ni encart ni compteur", async () => {
    auth.role = "logistics";
    try {
      const { default: Page } = await import("@/pages/procurement/orders/group");
      const html = render(Page, []);
      expect(html).toContain('data-testid="group-out-of-scope"');
      expect(html).not.toContain('data-testid="group-suggestions-error"');
      expect(html).not.toContain("Chargement des suggestions");
      expect(html).not.toMatch(/Suggestions de Commandes Groupées \(/);
    } finally {
      auth.role = "admin";
    }
  });

  it("regroupement, témoin : liste vide lue, « Aucune suggestion »", async () => {
    const { default: Page } = await import("@/pages/procurement/orders/group");
    const html = render(Page, [[GROUP_KEY, { data: [] }]]);
    expect(html).toContain("Aucune suggestion de regroupement disponible");
  });

  it("inventaire : « En rupture de stock » lit Indisponible et le catalogue montre l'erreur", async () => {
    const { default: Page } = await import("@/pages/inventory/index");
    const html = render(Page, [...INVENTORY_OK, [LOW_KEY, { error: boom() }], [PARTS_KEY, { error: boom() }]]);
    expect(html).toMatch(/data-testid="kpi-low-stock-value">Indisponible</);
    expect(html).toContain('data-testid="parts-error"');
  });

  it("inventaire, témoin : aucune pièce en rupture, la tuile montre 0", async () => {
    const { default: Page } = await import("@/pages/inventory/index");
    const html = render(Page, [...INVENTORY_OK, [LOW_KEY, { data: [] }], [PARTS_KEY, { data: { parts: [], total: 0 } }]]);
    expect(html).toMatch(/data-testid="kpi-low-stock-value">0</);
    expect(html).not.toContain('data-testid="parts-error"');
  });
});
