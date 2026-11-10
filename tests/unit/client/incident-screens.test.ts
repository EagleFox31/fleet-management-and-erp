import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { REALTIME_EVENTS } from "@shared/contracts/realtime-events";
import { INCIDENTS_PATH, type Incident } from "@shared/contracts/incidents";

/** Lot V3, point 3 : liste des pannes (immatriculation, aucune promesse d'OT) et entrée chauffeur unique. */

const redirects: string[] = [];
vi.mock("wouter", () => ({
  Redirect: ({ to }: { to: string }) => {
    redirects.push(to);
    return null;
  },
  useLocation: () => ["/", () => {}],
  Link: ({ children }: { children?: React.ReactNode }) => React.createElement("a", null, children),
}));
vi.mock("@/lib/queryClient", async () => {
  const { QueryClient: QC } = await import("@tanstack/react-query");
  return { queryClient: new QC(), apiRequest: async () => ({}), getQueryFn: () => async () => null };
});
(globalThis as { React?: typeof React }).React = React;
vi.setConfig({ testTimeout: 60_000 });

const incident = (over: Partial<Incident>): Incident => ({
  id: 1, vehicleId: 13, vehicleRegistration: "AB-123-CD", reportedBy: 2, reportedByName: "Ali",
  description: "Fuite d'huile", severity: "high", status: "open", workOrderId: null,
  createdAt: "2026-11-01T07:15:00.000Z", updatedAt: "2026-11-01T07:15:00.000Z", ...over,
});

async function renderList(rows: Incident[]): Promise<string> {
  const { IncidentList } = await import("@/components/incidents/incident-list");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData([INCIDENTS_PATH], rows);
  return renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, React.createElement(IncidentList)));
}

describe("lot V3 point 3 : incidents", () => {
  it("la liste montre l'immatriculation, jamais l'id du véhicule", async () => {
    const html = await renderList([incident({}), incident({ id: 2, vehicleId: 99, vehicleRegistration: null })]);
    expect(html).toContain("AB-123-CD");
    expect(html).not.toContain("#13");
    expect(html).toContain("Véhicule 99");
  });

  it("/driver/incident redirige vers l'entrée chauffeur unique", async () => {
    const { IncidentDeclareScreen } = await import("@/pages/lot/screens");
    renderToStaticMarkup(React.createElement(IncidentDeclareScreen));
    expect(redirects).toEqual(["/driver"]);
  });

  it("l'écran des pannes ne promet pas la création d'un ordre de travail", async () => {
    const { LOT_SCREENS } = await import("@/config/lot-screens");
    const screen = LOT_SCREENS.find((s) => s.id === "incidents-list");
    expect(screen?.description).not.toMatch(/ordre de travail/i);
  });

  it("l'alerte temps réel atteint aussi la logistique", () => {
    expect(REALTIME_EVENTS.incident_reported.scope).toMatchObject({ type: "roles" });
    expect((REALTIME_EVENTS.incident_reported.scope as unknown as { roles: string[] }).roles).toEqual(expect.arrayContaining(["logistics", "workshop_manager", "admin"]));
  });
});
