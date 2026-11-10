import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Consultation seule : le tableau chauffeur ne propose AUCUNE écriture quand `useOfflineReadOnly()` est vrai.
// Parcours générique du HTML rendu : tout <button> actif sans la marque `data-read-only-safe`
// (navigation, déconnexion, aide) est une écriture oubliée. Aucune liste de boutons codée en dur.
(globalThis as unknown as { React: typeof React }).React = React;

const auth = vi.hoisted(() => ({
  value: { user: null, offlineGrant: null } as { user: unknown; offlineGrant: unknown },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth.value }));
vi.mock("@/hooks/useRealTimeSync", () => ({ useRealTimeSync: () => undefined }));
vi.mock("@/hooks/use-fuel-price", () => ({ useFuelPrice: () => ({ data: undefined }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }), toast: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn(), queryClient: {} }));
vi.mock("@/components/offline/logout-guard", () => ({
  useGuardedLogout: () => ({ requestLogout: vi.fn(), guardDialog: null }),
}));
vi.mock("@/components/offline/offline-data-banner", () => ({
  OfflineDataBanner: () => null,
  OfflineUnavailable: () => null,
  useOfflineReadActive: () => false,
}));
vi.mock("@/components/help", () => ({
  ContextualHelpButton: () => React.createElement("button", { type: "button" }, "Aide"),
}));
vi.mock("@/components/driver/driver-gps-panel", () => ({
  DriverGpsPanel: () => React.createElement("button", { type: "button" }, "Panneau GPS"),
  DriverGpsBufferReplay: () => React.createElement("button", { type: "button" }, "Rejeu GPS"),
}));
vi.mock("@/components/missions/mission-pod-panel", () => ({
  PodDepositButton: () => React.createElement("button", { type: "button" }, "Déposer la preuve"),
}));

import DriverDashboard from "@/pages/driver/dashboard";

const ME = {
  driver: { id: 7, firstName: "Awa", lastName: "Ngono" },
  missions: [
    {
      id: 1,
      orderNumber: "M-1",
      status: "assigned",
      pickupAddress: "Douala",
      deliveryAddress: "Yaounde",
      vehicleId: 3,
    },
  ],
};

function render(): string {
  const client = new QueryClient();
  client.setQueryData(["/api/drivers/me"], ME);
  return renderToStaticMarkup(
    React.createElement(QueryClientProvider, { client }, React.createElement(DriverDashboard)),
  );
}

/** Ouvertures de <button ...> actives (sans disabled) et non marquées sûres. */
function unsafeActiveButtons(html: string): string[] {
  // Une zone sûre enveloppée (aide) est retirée avant le parcours.
  const scanned = html.replace(/<span data-read-only-safe="[^"]*">[\s\S]*?<\/span>/g, "");
  const opens = scanned.match(/<button\b[^>]*>/g) ?? [];
  return opens.filter((tag) => !/\sdisabled(=|\s|>)/.test(tag) && !tag.includes("data-read-only-safe"));
}

beforeEach(() => {
  auth.value = { user: null, offlineGrant: null };
});

describe("tableau chauffeur : consultation seule", () => {
  it("mode normal : des contrôles d'écriture existent (le parcours générique est significatif)", () => {
    auth.value = { user: { id: 7, role: "driver", name: "Awa" }, offlineGrant: null };
    const html = render();
    expect(unsafeActiveButtons(html).length).toBeGreaterThan(0);
    expect(html).toContain("Panneau GPS");
    expect(html).toContain("Déposer la preuve");
    expect(html).toContain("Signaler un problème");
    expect(html).toContain("Enregistrer un plein");
  });

  it("lecture seule : aucun bouton actif hors navigation, déconnexion et aide", () => {
    auth.value = { user: null, offlineGrant: { userId: 7, profile: "driver", expiresAt: Date.now() + 1000 } };
    const html = render();
    expect(unsafeActiveButtons(html)).toEqual([]);
    for (const absent of ["Panneau GPS", "Rejeu GPS", "Déposer la preuve", "Signaler un problème", "Enregistrer un plein"]) {
      expect(html).not.toContain(absent);
    }
    expect(html).toContain("M-1");
  });

  it("la déconnexion reste disponible en lecture seule", () => {
    auth.value = { user: null, offlineGrant: { userId: 7, profile: "driver", expiresAt: Date.now() + 1000 } };
    expect(render()).toContain('data-read-only-safe="deconnexion"');
  });
});
