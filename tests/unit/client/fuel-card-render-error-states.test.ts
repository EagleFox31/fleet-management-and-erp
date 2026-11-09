import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { describe, expect, it, vi } from "vitest";

/**
 * Rendu serveur (react-dom/server) : la carte carburant et les relevés de pleins en échec
 * affichent « Indisponible », jamais « 0 FCFA », « 0 L » ou « 0 plein » comme vraie valeur.
 * Même méthode que `money-stock-render-error-states.test.ts` : requête mise en erreur dans le
 * cache (`queryCache.build` + `setState`, aucun réseau), page rendue, tuile isolée par son libellé.
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
  return { queryClient: new QC(), apiRequest: async () => ({}), getQueryFn: () => async () => undefined };
});
vi.mock("@/hooks/use-onboarding", () => ({
  useOnboarding: () => ({
    isOnboardingCompleted: true,
    isOnboardingActive: false,
    shouldShowMascot: false,
    completeOnboarding: () => {},
    skipOnboarding: () => {},
    startTour: () => {},
    endTour: () => {},
    showMascot: () => {},
  }),
}));
vi.mock("@/lib/pdf-export", () => ({ exportInventoryToPDF: () => {} }));
vi.mock("@/hooks/use-form-draft", () => ({
  useFormDraft: () => ({ draftSavedAt: null, clearDraft: () => {}, discardDraft: () => {} }),
}));
// Onglets : tous les panneaux sont rendus (sinon seul l'onglet actif apparaît dans le HTML).
vi.mock("@/components/ui/tabs", () => {
  const pass = ({ children }: { children?: React.ReactNode }) => React.createElement("div", null, children);
  return { Tabs: pass, TabsContent: pass, TabsList: pass, TabsTrigger: pass };
});

vi.mock("@/components/fuel/fuel-record-form", () => ({ FuelRecordForm: () => null }));
// Boîtes de dialogue : contenu rendu en place (fermées, Radix n'en monte rien), pour lire « Solde actuel ».
vi.mock("@/components/ui/dialog", () => {
  const pass = ({ children }: { children?: React.ReactNode }) => React.createElement("div", null, children);
  return {
    Dialog: pass,
    DialogPortal: pass,
    DialogOverlay: pass,
    DialogClose: pass,
    DialogTrigger: pass,
    DialogContent: pass,
    DialogHeader: pass,
    DialogFooter: pass,
    DialogTitle: pass,
    DialogDescription: pass,
  };
});

(globalThis as { React?: typeof React }).React = React;
vi.setConfig({ testTimeout: 60_000 });

type Outcome = { data: unknown } | { error: Error };
type Seed = Array<[readonly unknown[], Outcome]>;

function render(Page: React.ComponentType, seed: Seed): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryOnMount: false, staleTime: Infinity } },
  });
  for (const [queryKey, outcome] of seed) {
    if ("error" in outcome) {
      client.getQueryCache().build(client, { queryKey }).setState({
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
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(TooltipProvider, null, React.createElement(Page)),
    ),
  );
}

const FAILURE = { error: new Error("boom") };
const BALANCE = {
  balance: 12345,
  totalDebits: 22222,
  totalCredits: 33333,
  fuelBalance: 4444,
  averagePricePerLiter: 555,
};
const STATS = { totalFuel: "7777", totalCost: "88888" };
const RECORDS = [
  { id: 1, vehicleId: 1, quantity: 7777, cost: 88888, fullTank: true, date: "2026-11-01" },
];

const K = {
  balance: ["/api/fuel-card/balance"],
  stats: ["/api/fuel-records/statistics", { period: "month" }],
  history: ["/api/fuel-records/consumption-history", { period: "month" }],
  records: ["/api/fuel-records", { vehicleId: undefined }],
};

const esc = (label: string) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Supprime tout espace (insécables compris) : les montants fr-FR séparent les milliers. */
const squash = (text: string) => text.replace(/[\s  ]/g, "");

/** Valeur d'une tuile `KpiTile` : le `<p>` qui suit le `<p>` portant son libellé. */
function kpiValue(html: string, label: string): string {
  const match = html.match(new RegExp(`<p[^>]*>${esc(label)}</p><p[^>]*>((?:(?!</p>).)*)</p>`));
  expect(match, `tuile « ${label} » absente du rendu`).not.toBeNull();
  return match![1].replace(/<[^>]*>/g, "").trim();
}

/** Sous-valeur d'une tuile `KpiTile` : le deuxième `<p>` après celui de son libellé. */
function kpiSubValue(html: string, label: string): string {
  const match = html.match(
    new RegExp(`<p[^>]*>${esc(label)}</p><p[^>]*>(?:(?!</p>).)*</p><p[^>]*>((?:(?!</p>).)*)</p>`),
  );
  expect(match, `sous-valeur de « ${label} » absente du rendu`).not.toBeNull();
  return match![1].replace(/<[^>]*>/g, "").trim();
}

/** Valeur d'une carte de `fuel-statistics` : le `<div>` qui suit le `<div>` du libellé. */
function statCardValue(html: string, label: string): string {
  const match = html.match(new RegExp(`>${esc(label)}</div><div[^>]*>((?:(?!</div>).)*)</div>`));
  expect(match, `carte « ${label} » absente du rendu`).not.toBeNull();
  return match![1].replace(/<[^>]*>/g, "").trim();
}

/** Fragment du HTML qui suit un libellé, sur 400 caractères (bandeau de métriques, lignes). */
function after(html: string, label: string): string {
  const at = html.indexOf(label);
  expect(at, `libellé « ${label} » absent du rendu`).toBeGreaterThan(-1);
  return html.slice(at, at + 400).replace(/<[^>]*>/g, "|");
}

describe("rendu: carte carburant et pleins en échec affichent Indisponible, jamais 0", () => {
  describe("tableau de bord (dashboard)", () => {
    it("échec : « Solde carte carburant » lit Indisponible", async () => {
      const { default: Page } = await import("@/pages/dashboard");
      const html = render(Page, [[K.balance, FAILURE]]);
      expect(kpiValue(html, "Solde carte carburant")).toBe("Indisponible");
      expect(kpiSubValue(html, "Solde carte carburant")).not.toContain("Consommé");
    });

    it("témoin : données saines, la tuile montre 12 345", async () => {
      const { default: Page } = await import("@/pages/dashboard");
      const html = render(Page, [[K.balance, { data: BALANCE }]]);
      expect(squash(kpiValue(html, "Solde carte carburant"))).toContain("12345");
      expect(kpiSubValue(html, "Solde carte carburant")).toContain("Consommé");
    });
  });

  describe("logistique (logistics/dashboard)", () => {
    it("échec : solde, consommé, rechargé et statistiques lisent Indisponible (en-tête et onglet Carburant)", async () => {
      const { default: Page } = await import("@/pages/logistics/dashboard");
      const html = render(Page, [[K.balance, FAILURE]]);
      expect(kpiValue(html, "Solde carte carburant")).toBe("Indisponible");
      expect(kpiValue(html, "Total consommé")).toBe("Indisponible");
      expect(kpiValue(html, "Total rechargé")).toBe("Indisponible");
      expect(kpiValue(html, "Solde carte")).toBe("Indisponible");
      expect(after(html, "Prix moyen / litre")).toContain("Indisponible");
      expect(after(html, "Solde en litres")).toContain("Indisponible");
      expect(after(html, "Solde en litres")).not.toContain("0 L");
      expect(html).not.toContain("L disponibles");
    });

    it("témoin : données saines, 12 345 / 22 222 / 33 333 affichés", async () => {
      const { default: Page } = await import("@/pages/logistics/dashboard");
      const html = render(Page, [[K.balance, { data: BALANCE }]]);
      expect(squash(kpiValue(html, "Solde carte carburant"))).toContain("12345");
      expect(squash(kpiValue(html, "Total consommé"))).toContain("22222");
      expect(squash(kpiValue(html, "Total rechargé"))).toContain("33333");
      expect(html).toContain("L disponibles");
      expect(html).not.toContain("Indisponible");
    });
  });

  describe("tableau de bord client (client/dashboard)", () => {
    it("échec : « Dépense carburant » lit Indisponible", async () => {
      const { default: Page } = await import("@/pages/client/dashboard");
      const html = render(Page, [[K.balance, FAILURE]]);
      expect(kpiValue(html, "Dépense carburant")).toBe("Indisponible");
      expect(kpiSubValue(html, "Dépense carburant")).not.toContain("Total consommé ce mois");
    });

    it("témoin : données saines, la tuile montre 22 222", async () => {
      const { default: Page } = await import("@/pages/client/dashboard");
      const html = render(Page, [[K.balance, { data: BALANCE }]]);
      expect(squash(kpiValue(html, "Dépense carburant"))).toContain("22222");
    });
  });

  describe("carburant (fuel/index)", () => {
    it("échec carte : « Solde carte carburant » et « Solde actuel » lisent Indisponible", async () => {
      const { default: Page } = await import("@/pages/fuel/index");
      const html = render(Page, [[K.balance, FAILURE], [K.records, { data: RECORDS }]]);
      expect(kpiValue(html, "Solde carte carburant")).toBe("Indisponible");
      expect(kpiSubValue(html, "Solde carte carburant")).not.toContain("Prix moyen");
      expect(after(html, "Solde actuel")).toContain("Indisponible");
    });

    it("échec pleins : « Pleins enregistrés », « Litres consommés », « Coût total » lisent Indisponible", async () => {
      const { default: Page } = await import("@/pages/fuel/index");
      const html = render(Page, [[K.balance, { data: BALANCE }], [K.records, FAILURE]]);
      for (const label of ["Pleins enregistrés", "Litres consommés", "Coût total"]) {
        expect(kpiValue(html, label)).toBe("Indisponible");
      }
      expect(squash(kpiValue(html, "Solde carte carburant"))).toContain("12345");
    });

    it("témoin : données saines, 12 345 (solde), 1 plein, 7777 L, 88 888 de coût", async () => {
      const { default: Page } = await import("@/pages/fuel/index");
      const html = render(Page, [[K.balance, { data: BALANCE }], [K.records, { data: RECORDS }]]);
      expect(squash(kpiValue(html, "Solde carte carburant"))).toContain("12345");
      expect(kpiValue(html, "Pleins enregistrés")).toBe("1");
      expect(squash(kpiValue(html, "Litres consommés"))).toContain("7777.00L");
      expect(squash(kpiValue(html, "Coût total"))).toContain("88888");
      expect(after(html, "Solde actuel")).not.toContain("Indisponible");
    });
  });

  describe("statistiques carburant (fuel-statistics)", () => {
    it("échec : « Total carburant », « Coût total », « Prix moyen/L » lisent Indisponible", async () => {
      const { FuelStatistics } = await import("@/components/fuel/fuel-statistics");
      const html = render(FuelStatistics, [[K.stats, FAILURE], [K.history, { data: [] }]]);
      for (const label of ["Total carburant", "Coût total", "Prix moyen/L"]) {
        expect(statCardValue(html, label)).toBe("Indisponible");
      }
    });

    it("échec historique : « Nb de pleins » lit Indisponible", async () => {
      const { FuelStatistics } = await import("@/components/fuel/fuel-statistics");
      const html = render(FuelStatistics, [[K.stats, { data: STATS }], [K.history, FAILURE]]);
      expect(statCardValue(html, "Nb de pleins")).toBe("Indisponible");
      expect(squash(statCardValue(html, "Total carburant"))).toContain("7777");
    });

    it("témoin : données saines, 7777 L, 88 888, 3 pleins", async () => {
      const { FuelStatistics } = await import("@/components/fuel/fuel-statistics");
      const html = render(FuelStatistics, [
        [K.stats, { data: STATS }],
        [K.history, { data: [{ date: "2026-11-01", quantity: 7777, cost: 88888, count: 3 }] }],
      ]);
      expect(squash(statCardValue(html, "Total carburant"))).toContain("7777.00L");
      expect(squash(statCardValue(html, "Coût total"))).toContain("88888");
      expect(statCardValue(html, "Nb de pleins")).toBe("3");
      expect(html).not.toContain("Indisponible");
    });
  });
});
