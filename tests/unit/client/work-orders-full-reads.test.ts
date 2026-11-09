import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { ReportRefusedError } from "@/lib/fetch-all-pages";
import type { ExportToast } from "@/lib/work-orders-export";
import { ALL_VEHICLES_UNREADABLE } from "@/hooks/use-all-vehicles";

/**
 * Deux écrans lisaient `/api/work-orders` en un seul appel `limit: 300` :
 * - la liste des OT, pour son export PDF : au-delà de 300 OT, le rapport était tronqué sans
 *   le dire, et une liste pas encore lue (ou en échec) donnait un PDF vide annoncé « Export réussi » ;
 * - les alertes d'échéance, pour savoir si un OT existe déjà : un OT plus ancien que les 300
 *   derniers était ignoré, l'alerte redevenait « à faire » et la génération pouvait le recréer.
 * Les deux lisent désormais toutes les pages (`fetchAllWorkOrders`), et refusent plutôt que de
 * conclure sur une liste incomplète.
 */

const root = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

// ---- Export PDF de la liste des OT : exécuté, pas lu dans le source ----------------------------

const exportMocks = vi.hoisted(() => ({
  fetchAll: vi.fn<() => Promise<unknown[]>>(),
  pdf: vi.fn<(list: unknown[]) => void>(),
}));
vi.mock("@/lib/fetch-all-work-orders", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fetch-all-work-orders")>()),
  fetchAllWorkOrders: exportMocks.fetchAll,
}));
vi.mock("@/lib/pdf-export", () => ({ exportWorkOrdersToPDF: exportMocks.pdf }));

describe("liste des OT : export PDF sur la liste complète", () => {
  const src = read("client/src/pages/maintenance/work-orders.tsx");

  it("la page n'a plus de lecture plafonnée et délègue l'export au clic", () => {
    expect(src).not.toMatch(/limit\s*:\s*300/);
    expect(src).toMatch(/await runWorkOrdersExport\(toast\)/);
  });

  async function run(outcome: { data: unknown[] } | { error: Error }) {
    exportMocks.fetchAll.mockReset();
    exportMocks.pdf.mockReset();
    if ("error" in outcome) exportMocks.fetchAll.mockRejectedValue(outcome.error);
    else exportMocks.fetchAll.mockResolvedValue(outcome.data);
    const { clientLogger } = await import("@/lib/logger");
    const log = vi.spyOn(clientLogger, "error").mockImplementation(() => {});
    const toasts: ExportToast[] = [];
    const { runWorkOrdersExport } = await import("@/lib/work-orders-export");
    await runWorkOrdersExport((t) => toasts.push(t));
    const logged = log.mock.calls.slice();
    log.mockRestore();
    return { toasts, logged };
  }

  it("liste complète lue : PDF produit sur toutes les lignes, puis « Export réussi »", async () => {
    const list = Array.from({ length: 1234 }, (_, i) => ({ id: i + 1 }));
    const { toasts, logged } = await run({ data: list });
    expect(exportMocks.fetchAll).toHaveBeenCalledTimes(1);
    expect(exportMocks.pdf).toHaveBeenCalledWith(list);
    expect(toasts.map((t) => t.title)).toEqual(["Export réussi"]);
    expect(logged).toEqual([]);
  });

  it("liste vide : aucun PDF, jamais « Export réussi »", async () => {
    const { toasts } = await run({ data: [] });
    expect(exportMocks.pdf).not.toHaveBeenCalled();
    expect(toasts.map((t) => t.title)).toEqual(["Aucun ordre de travail à exporter"]);
  });

  it("lecture refusée : aucun PDF, message lisible, refus journalisé avec son détail", async () => {
    const refusal = new ReportRefusedError("Les ordres de travail n'ont pas pu être lus en entier.", {
      path: "/api/work-orders",
      reason: "incomplete",
      total: 60,
      received: 50,
    });
    const { toasts, logged } = await run({ error: refusal });
    expect(exportMocks.pdf).not.toHaveBeenCalled();
    expect(toasts).toEqual([
      { title: "Erreur d'export", description: "Les ordres de travail n'ont pas pu être lus en entier.", variant: "destructive" },
    ]);
    expect(logged).toEqual([["Export PDF des ordres de travail non généré", { err: refusal, refusal: refusal.detail }]]);
  });
});

// ---- Rendu des alertes d'échéance ------------------------------------------------------------

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, role: "admin" }, isAuthenticated: true, isLoading: false }),
}));

// Les pages utilisent le runtime JSX classique (React global) : absent en environnement node.
(globalThis as { React?: typeof React }).React = React;
vi.setConfig({ testTimeout: 60_000 });

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const VEHICLE = { id: 7, registrationNumber: "LT-123-AB", brand: "Renault", model: "T", nextMaintenanceDate: inDays(10) };
/** Clés lues par l'ancien code (`limit: 300`) et par le nouveau (toutes les pages). */
const OLD_KEY = ["/api/work-orders", { limit: 300, offset: 0 }] as const;
const ALL_KEY = ["/api/work-orders", "all"] as const;

type Outcome = { data: unknown } | { error: Error };

async function renderAlerts(workOrders: Outcome, vehicles: "ok" | "error" = "ok"): Promise<string> {
  const { default: Page } = await import("@/pages/maintenance/date-based-alerts");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryOnMount: false, staleTime: Infinity } },
  });
  // Cache partagé : `["/api/vehicles"]` (objet paginé, lu ailleurs) ; l'écran lit la flotte complète.
  client.setQueryData(["/api/vehicles"], { vehicles: [VEHICLE], total: 1 });
  if (vehicles === "error") {
    const query = client.getQueryCache().build(client, { queryKey: ["/api/vehicles", "all"] });
    query.setState({
      status: "error",
      error: new ReportRefusedError(ALL_VEHICLES_UNREADABLE, { path: "/api/vehicles", reason: "incomplete" }),
      data: undefined,
      fetchStatus: "idle",
      errorUpdateCount: 1,
      errorUpdatedAt: Date.now(),
    } as never);
  } else {
    client.setQueryData(["/api/vehicles", "all"], [VEHICLE]);
  }
  for (const [key, toData] of [
    [OLD_KEY, (list: unknown[]) => ({ workOrders: list, total: list.length })],
    [ALL_KEY, (list: unknown[]) => list],
  ] as const) {
    if ("error" in workOrders) {
      const query = client.getQueryCache().build(client, { queryKey: key });
      query.setState({
        status: "error",
        error: workOrders.error,
        data: undefined,
        fetchStatus: "idle",
        errorUpdateCount: 1,
        errorUpdatedAt: Date.now(),
      } as never);
    } else {
      client.setQueryData(key, toData(workOrders.data as unknown[]));
    }
  }
  return renderToStaticMarkup(
    React.createElement(QueryClientProvider, { client }, React.createElement(Page)),
  );
}

const button = (html: string, label: string) =>
  html.match(new RegExp(`<button[^>]*>(?:(?!</button>).)*${label}(?:(?!</button>).)*</button>`, "s"))?.[0];

describe("alertes d'échéance : création d'OT gardée par la lecture complète", () => {
  it("lecture des OT en échec : boutons de création désactivés, encart d'erreur", async () => {
    const html = await renderAlerts({ error: new Error("boom") });
    const create = button(html, "Créer OT atelier");
    const generate = button(html, "Générer les OT atelier");
    expect(create).toBeDefined();
    expect(generate).toBeDefined();
    expect(create).toMatch(/disabled=""/);
    expect(generate).toMatch(/disabled=""/);
    expect(html).toMatch(/role="alert"/);
    expect(html).toMatch(/Réessayer/);
  });

  it("témoin : lecture saine sans OT, création possible", async () => {
    const html = await renderAlerts({ data: [] });
    const create = button(html, "Créer OT atelier");
    expect(create).toBeDefined();
    expect(create).not.toMatch(/disabled=""/);
    expect(html).not.toMatch(/role="alert"/);
  });

  it("OT déjà créé pour l'alerte : reconnu sur la liste complète", async () => {
    const html = await renderAlerts({
      data: [{ id: 1, vehicleId: 7, title: "Maintenance préventive programmée - LT-123-AB", status: "pending" }],
    });
    expect(html).toMatch(/OT atelier créée/);
    expect(button(html, "Créer OT atelier")).toBeUndefined();
  });

  it("flotte illisible : encart d'erreur, jamais une liste d'alertes vide présentée comme saine", async () => {
    const html = await renderAlerts({ data: [] }, "error");
    expect(html).toMatch(/role="alert"/);
    expect(html).toContain(ALL_VEHICLES_UNREADABLE.replace("'", "&#x27;"));
  });
});
