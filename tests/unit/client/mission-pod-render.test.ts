import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { canDepositPod, invoiceGate } from "@/lib/mission-pod";

/**
 * Preuve de livraison (POD) sur la fiche mission, rendu serveur (react-dom/server) :
 * - sans POD, le bouton de facture est désactivé et la raison est écrite à l'écran ;
 * - avec un POD et une mission livrée, il est actif ;
 * - une lecture des POD en échec affiche l'erreur et ne dit jamais « aucun POD » ;
 * - le dépôt n'est pas proposé à un rôle non autorisé ni sur une mission non démarrée.
 * Même méthode que `invoices-render-error-states.test.ts` (requête mise en erreur dans le cache).
 */

const auth = vi.hoisted(() => ({ role: "admin" }));

vi.mock("wouter", () => ({
  useLocation: () => ["/", () => {}],
  useParams: () => ({ id: "7" }),
  Link: ({ children }: { children?: React.ReactNode }) => React.createElement("a", null, children),
  useRoute: () => [true, { id: "7" }],
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, role: auth.role }, isAuthenticated: true, isLoading: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => {} }) }));
vi.mock("@/lib/queryClient", async () => {
  const { QueryClient: QC } = await import("@tanstack/react-query");
  return { queryClient: new QC(), apiRequest: async () => ({}), getQueryFn: () => async () => undefined };
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
    React.createElement(QueryClientProvider, { client }, React.createElement(TooltipProvider, null, React.createElement(Page))),
  );
}

const POD_KEY = ["/api/missions/7/pod-files"] as const;
const POD_FILE = {
  id: 1,
  originalName: "bon-de-livraison.pdf",
  mime: "application/pdf",
  sizeBytes: 20480,
  uploadedAt: "2026-11-10T08:00:00.000Z",
  uploadedByName: "Chauffeur Test",
};

function mission(status: string) {
  return { id: 7, orderNumber: "M-7", status, clientId: 1, assignment: null };
}

/** Ouvre la balise portant ce data-testid (attributs compris) ; chaîne vide si absente. */
function tagOf(html: string, testId: string): string {
  const at = html.indexOf(`data-testid="${testId}"`);
  if (at < 0) return "";
  return html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
}
/** Attribut `disabled` posé (et non la classe `disabled:opacity-50`). */
const isDisabled = (tag: string) => /\sdisabled(=|\s|>)/.test(tag);
const strip = (html: string) => html.replace(/<[^>]*>/g, "|");

describe("règles pures du POD", () => {
  it("dépôt : rôle de MISSION_STATUS_ROLES et mission démarrée, livrée ou clôturée", () => {
    expect(canDepositPod("driver", "in_progress")).toBe(true);
    expect(canDepositPod("logistics", "delivered")).toBe(true);
    expect(canDepositPod("secretary", "completed")).toBe(true);
    expect(canDepositPod("driver", "pending")).toBe(false);
    expect(canDepositPod("driver", "cancelled")).toBe(false);
    expect(canDepositPod("warehouse", "delivered")).toBe(false);
    expect(canDepositPod("client", "delivered")).toBe(false);
    expect(canDepositPod(undefined, "delivered")).toBe(false);
  });

  it("facturation : jamais ouverte sur une lecture en échec ou en cours", () => {
    expect(invoiceGate("delivered", { count: 1, failed: false })).toEqual({ allowed: true, reason: null });
    expect(invoiceGate("completed", { count: 2, failed: false }).allowed).toBe(true);
    expect(invoiceGate("delivered", { count: 0, failed: false })).toEqual({ allowed: false, reason: "Déposez le POD avant de facturer." });
    expect(invoiceGate("delivered", { count: undefined, failed: true }).allowed).toBe(false);
    expect(invoiceGate("delivered", { count: undefined, failed: true }).reason).not.toContain("Déposez");
    expect(invoiceGate("delivered", { count: undefined, failed: false }).allowed).toBe(false);
    expect(invoiceGate("in_progress", { count: 3, failed: false }).allowed).toBe(false);
  });
});

describe("fiche mission : POD et facturation", () => {
  beforeEach(() => {
    auth.role = "admin";
  });

  async function page(): Promise<React.ComponentType> {
    return (await import("@/pages/missions/[id]")).default;
  }

  it("mission livrée sans POD : bouton de facture désactivé et raison écrite", async () => {
    const html = render(await page(), [[["/api/missions/7"], { data: mission("delivered") }], [POD_KEY, { data: { files: [] } }]]);
    expect(isDisabled(tagOf(html, "button-open-generate-invoice-dialog"))).toBe(true);
    expect(strip(html)).toContain("Déposez le POD avant de facturer.");
    expect(html).toContain('data-testid="pod-empty"');
  });

  it("mission livrée avec POD : bouton de facture actif, POD listé", async () => {
    const html = render(await page(), [[["/api/missions/7"], { data: mission("delivered") }], [POD_KEY, { data: { files: [POD_FILE] } }]]);
    const button = tagOf(html, "button-open-generate-invoice-dialog");
    expect(button).not.toBe("");
    expect(isDisabled(button)).toBe(false);
    expect(html).not.toContain('data-testid="invoice-gate-reason"');
    expect(strip(html)).toContain("bon-de-livraison.pdf");
  });

  it("lecture des POD en échec : erreur affichée, facture fermée, jamais « aucun POD »", async () => {
    const html = render(await page(), [[["/api/missions/7"], { data: mission("delivered") }], [POD_KEY, { error: new Error("boom") }]]);
    expect(html).toContain('data-testid="pod-read-error"');
    expect(html).not.toContain('data-testid="pod-empty"');
    expect(strip(html)).not.toContain("Aucun POD déposé");
    expect(strip(html)).not.toContain("Déposez le POD avant de facturer");
    expect(strip(html)).toContain("la facturation est suspendue");
    expect(isDisabled(tagOf(html, "button-open-generate-invoice-dialog"))).toBe(true);
  });

  it("dépôt proposé à un rôle autorisé, caché à un rôle refusé", async () => {
    const seed: Seed = [[["/api/missions/7"], { data: mission("delivered") }], [POD_KEY, { data: { files: [] } }]];
    auth.role = "logistics";
    expect(render(await page(), seed)).toContain('data-testid="button-pod-deposit-panel"');
    auth.role = "warehouse";
    const html = render(await page(), seed);
    expect(html).not.toContain("button-pod-deposit");
    expect(html).toContain('data-testid="pod-empty"');
  });

  it("mission non démarrée : pas de dépôt même pour un rôle autorisé", async () => {
    const html = render(await page(), [[["/api/missions/7"], { data: mission("pending") }], [POD_KEY, { data: { files: [] } }]]);
    expect(html).not.toContain("button-pod-deposit");
  });
});
