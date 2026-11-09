import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

/**
 * Rendu serveur de la maintenance préventive quand `GET /api/maintenance-schedules` échoue.
 * `storage.getMaintenanceSchedules` renvoyait `[]` sur erreur ; il lève désormais et la route
 * répond 500. L'écran doit le dire, pas afficher « Aucune planification préventive. ».
 * Même technique que `money-stock-render-error-states.test.ts` (requête mise en erreur dans le cache).
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
vi.mock("@/hooks/use-form-draft", () => ({
  useFormDraft: () => ({ draftSavedAt: null, clearDraft: () => {}, discardDraft: () => {} }),
}));

(globalThis as { React?: typeof React }).React = React;
vi.setConfig({ testTimeout: 60_000 });

const SCHEDULES = "/api/maintenance-schedules";

function render(Page: React.ComponentType, schedules: { data: unknown } | { error: Error }): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryOnMount: false, staleTime: Infinity } },
  });
  client.setQueryData(["/api/vehicles"], { vehicles: [], total: 0 });
  if ("error" in schedules) {
    const query = client.getQueryCache().build(client, { queryKey: [SCHEDULES] });
    query.setState({
      status: "error",
      error: schedules.error,
      data: undefined,
      fetchStatus: "idle",
      errorUpdateCount: 1,
      errorUpdatedAt: Date.now(),
    } as typeof query.state);
  } else {
    client.setQueryData([SCHEDULES], schedules.data);
  }
  return renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, React.createElement(Page)));
}

describe("rendu: planning de maintenance en échec", () => {
  it("échec : message d'indisponibilité, pas « Aucune planification »", async () => {
    const { default: Page } = await import("@/pages/maintenance/preventive");
    const html = render(Page, { error: new Error(`500: {"message":"connect ETIMEDOUT 10.0.0.1:5432"}`) });
    expect(html).toContain("Le planning de maintenance est momentanément indisponible.");
    expect(html).not.toContain("Aucune planification préventive.");
    expect(html).not.toMatch(/ETIMEDOUT|5432/);
    expect(html).toContain(`role="alert"`);
  });

  it("succès vide : l'état vide normal reste affiché", async () => {
    const { default: Page } = await import("@/pages/maintenance/preventive");
    const html = render(Page, { data: [] });
    expect(html).toContain("Aucune planification préventive.");
    expect(html).not.toContain("momentanément indisponible");
  });
});
