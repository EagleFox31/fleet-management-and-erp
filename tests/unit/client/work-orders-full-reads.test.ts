import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

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

describe("liste des OT : export PDF sur la liste complète", () => {
  const src = read("client/src/pages/maintenance/work-orders.tsx");
  const exportFn = src.slice(src.indexOf("const handleExport"), src.indexOf("const totalCount"));

  it("plus de lecture plafonnée à 300", () => {
    expect(src).not.toMatch(/limit\s*:\s*300/);
    expect(src).not.toMatch(/allWorkOrders/);
  });

  it("l'export lit toutes les pages au clic", () => {
    expect(exportFn.length).toBeGreaterThan(0);
    expect(exportFn).toMatch(/await fetchAllWorkOrders\(\)/);
  });

  it("succès annoncé seulement après une lecture complète, jamais sur une liste vide", () => {
    const readAt = exportFn.indexOf("await fetchAllWorkOrders()");
    const success = exportFn.indexOf("Export réussi");
    expect(readAt).toBeGreaterThanOrEqual(0);
    expect(success).toBeGreaterThan(readAt);
    expect(exportFn).toMatch(/\.length === 0/);
    expect(exportFn).toMatch(/Aucun ordre de travail à exporter/);
  });

  it("échec : message lisible, erreur journalisée avec son détail", () => {
    expect(exportFn).toMatch(/userMessageOf\(error,/);
    expect(exportFn).toMatch(/clientLogger\.error\([^)]*, reportErrorContext\(error\)\);/);
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

async function renderAlerts(workOrders: Outcome): Promise<string> {
  const { default: Page } = await import("@/pages/maintenance/date-based-alerts");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryOnMount: false, staleTime: Infinity } },
  });
  client.setQueryData(["/api/vehicles"], { vehicles: [VEHICLE] });
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
});
