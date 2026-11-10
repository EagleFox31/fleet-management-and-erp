import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { AuditLogRow } from "@shared/contracts/audit-logs";
import { toWorkOrderHistoryEntry } from "@/lib/work-order-history";

(globalThis as { React?: typeof React }).React = React;

vi.mock("wouter", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => React.createElement("a", null, children),
}));
vi.mock("@/lib/queryClient", async () => {
  const { QueryClient: QC } = await import("@tanstack/react-query");
  return { queryClient: new QC(), apiRequest: async () => ({}), getQueryFn: () => async () => undefined };
});

const row = (over: Partial<AuditLogRow> = {}): AuditLogRow => ({
  id: 1, at: "2026-11-10T08:00:00.000Z", userId: 3, userName: "Awa", action: "update",
  entityType: "work_order", entityId: "7", method: "PATCH", path: "/api/work-orders/7", details: null, ...over,
});

describe("toWorkOrderHistoryEntry", () => {
  it("affiche un changement de statut connu en français", () => {
    expect(toWorkOrderHistoryEntry(row({ details: { status: "in_progress" } })).statusChange).toBe("Statut : En cours");
  });
  it("ne montre ni statut inconnu ni autre clé du corps de la requête", () => {
    expect(toWorkOrderHistoryEntry(row({ details: { status: "toString", cost: 5000 } })).statusChange).toBeNull();
    expect(toWorkOrderHistoryEntry(row({ details: { cost: 5000, notes: "x" } })).statusChange).toBeNull();
    expect(toWorkOrderHistoryEntry(row()).statusChange).toBeNull();
  });
  it("auteur absent : libellé lisible, action traduite", () => {
    const e = toWorkOrderHistoryEntry(row({ userName: null, action: "create" }));
    expect(e).toMatchObject({ who: "Utilisateur inconnu", action: "Création" });
  });
});

describe("libellé d'action d'après le chemin", () => {
  const label = (method: string, path: string, action: AuditLogRow["action"] = "create") =>
    toWorkOrderHistoryEntry(row({ method, path, action })).action;
  it("ne dit pas « Création » pour un POST qui n'en est pas une", () => {
    expect(label("POST", "/api/work-orders/7/items")).toBe("Ajout de ligne");
    expect(label("POST", "/api/work-orders/7/parts")).toBe("Ajout de pièce");
    expect(label("POST", "/api/work-orders/7/awaiting-parts")).toBe("Statut : Attente pièces");
    expect(label("POST", "/api/work-orders/7/part-requirements/4/issue")).toBe("Sortie de pièce du stock");
    expect(label("POST", "/api/work-orders/7/quality-check")).toBe("Contrôle qualité");
  });
  it("statut du technicien, création réelle et repli sur le verbe", () => {
    expect(label("PATCH", "/api/technician/work-orders/7/status", "update")).toBe("Changement de statut (technicien)");
    expect(label("POST", "/api/work-orders")).toBe("Création");
    expect(label("PATCH", "/api/work-orders/7", "update")).toBe("Modification");
    expect(label("DELETE", "/api/work-orders/7/parts", "delete")).toBe("Suppression");
  });
});

describe("WorkOrderHistory (rendu)", () => {
  const KEY = ["/api/work-orders/7/audit-trail"] as const;
  async function render(outcome: { data: unknown } | { error: Error }): Promise<string> {
    const { WorkOrderHistory } = await import("@/components/work-orders/work-order-history");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false, staleTime: Infinity } } });
    if ("error" in outcome) {
      client.getQueryCache().build(client, { queryKey: KEY }).setState({
        status: "error", error: outcome.error, data: undefined, fetchStatus: "idle", errorUpdateCount: 1, errorUpdatedAt: Date.now(),
      });
    } else {
      client.setQueryData(KEY, outcome.data);
    }
    return renderToStaticMarkup(
      React.createElement(QueryClientProvider, { client }, React.createElement(WorkOrderHistory, { workOrderId: 7 })),
    );
  }

  it("chronologie : une ligne par écriture, avec auteur et statut", async () => {
    const html = await render({ data: [row({ id: 11, details: { status: "completed" } }), row({ id: 12, action: "create", userName: "Moussa" })] });
    expect(html).toContain('data-testid="work-order-history-entry-11"');
    expect(html).toContain("Statut : Terminé");
    expect(html).toContain("par Moussa");
  });
  it("liste vide lue : message d'absence de changement", async () => {
    expect(await render({ data: [] })).toContain('data-testid="work-order-history-empty"');
  });
  it("lecture en échec : encart d'erreur, jamais « Aucun changement »", async () => {
    const html = await render({ error: new Error("timeout exceeded when trying to connect") });
    expect(html).toContain('data-testid="work-order-history-error"');
    expect(html).not.toContain("Aucun changement enregistré");
  });
});
