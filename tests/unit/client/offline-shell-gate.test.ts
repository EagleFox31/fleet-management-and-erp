import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Garde de la consultation seule : un profil de lecture sans accueil restreint montre le voile prévu
// (« Le serveur met du temps à répondre »), jamais un écran blanc.
(globalThis as unknown as { React: typeof React }).React = React;

const auth = vi.hoisted(() => ({ value: { user: null, offlineGrant: null } as { user: unknown; offlineGrant: unknown } }));
const loc = vi.hoisted(() => ({ path: "/" }));

vi.mock("@/hooks/useAuth", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useAuth")>("@/hooks/useAuth");
  return { ...actual, useAuth: () => auth.value };
});
vi.mock("wouter", () => ({
  useLocation: () => [loc.path, vi.fn()],
  Redirect: ({ to }: { to: string }) => React.createElement("span", { "data-testid": "redirect", "data-to": to }),
}));
vi.mock("@/pages/driver/dashboard", () => ({ default: () => React.createElement("div", { "data-testid": "driver-home" }) }));

import { OfflineShellGate } from "@/components/offline/offline-shell";

const grant = (profile: string) => ({ userId: 7, profile, expiresAt: Date.now() + 3600_000 });
const render = () => renderToStaticMarkup(React.createElement(OfflineShellGate, null, React.createElement("span", { "data-testid": "app" })));

beforeEach(() => {
  auth.value = { user: null, offlineGrant: null };
  loc.path = "/";
});

describe("OfflineShellGate", () => {
  it("sans reprise hors ligne : les routes de l'application", () => {
    expect(render()).toContain('data-testid="app"');
  });

  it("profil chauffeur : l'accueil du profil", () => {
    auth.value = { user: null, offlineGrant: grant("driver") };
    expect(render()).toContain('data-testid="driver-home"');
  });

  it("profil chauffeur sur une autre adresse : renvoi vers l'accueil", () => {
    auth.value = { user: null, offlineGrant: grant("driver") };
    loc.path = "/maintenance/work-orders";
    expect(render()).toContain('data-to="/"');
  });

  it("profil sans accueil restreint : le voile d'attente, pas un écran blanc", () => {
    auth.value = { user: null, offlineGrant: grant("profil-sans-accueil") };
    const html = render();
    expect(html).not.toBe("");
    expect(html).toContain('data-testid="session-unreachable"');
    expect(html).toContain("Le serveur met du temps à répondre");
    expect(html).not.toContain('data-testid="app"');
  });
});
