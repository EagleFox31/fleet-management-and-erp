import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { describe, expect, it, vi } from "vitest";

/**
 * Trois écrans lisaient `GET /api/vehicles` comme un tableau complet, alors que la route rend
 * `{ vehicles, total }` paginé (10 lignes sans `limit`) et ignore les paramètres qu'elle ne connaît
 * pas :
 * - maintenance préventive : `vehicles.map` sur l'objet, le dialogue de création plantait ;
 * - tableau de bord client : `Array.isArray(objet)` faux, la tuile « Mes véhicules » restait à 0 ;
 * - fiche par immatriculation : `registrationNumber` ignoré, la page cherchait dans les 10 véhicules
 *   les plus récents et restait en chargement sans fin pour tous les autres.
 *
 * Rendu serveur (react-dom/server) sans réseau : chaque requête lue par la page est servie par un
 * faux serveur qui reproduit la sémantique de la route (défaut 10, tri récent d'abord, `search`
 * filtrant, paramètres inconnus ignorés). Le rendu est rejoué jusqu'à ce que plus aucune requête
 * lisible ne reste sans données, ce qui couvre les lectures en cascade (recherche, puis fiche).
 */

vi.mock("wouter", () => ({
  useLocation: () => ["/", () => {}],
  Link: ({ children }: { children?: React.ReactNode }) => React.createElement("a", null, children),
  useRoute: () => [false, {}],
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, role: "admin", name: "Test" }, isAuthenticated: true, isLoading: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => {} }) }));
vi.mock("@/lib/queryClient", async () => {
  const { QueryClient: QC } = await import("@tanstack/react-query");
  return { queryClient: new QC(), apiRequest: async () => ({}), getQueryFn: () => async () => undefined };
});
vi.mock("@/hooks/use-form-draft", () => ({
  useFormDraft: () => ({ draftSavedAt: null, clearDraft: () => {}, discardDraft: () => {} }),
}));
// Dialogue et liste déroulante rendus ouverts : c'est leur contenu (le sélecteur de véhicule) qui
// plantait. Les primitives Radix ne rendent rien de fermé en rendu serveur.
vi.mock("@/components/ui/dialog", async () => {
  const R = await import("react");
  const pass = ({ children }: { children?: React.ReactNode }) => R.createElement("div", null, children);
  return {
    Dialog: pass,
    DialogTrigger: pass,
    DialogContent: pass,
    DialogHeader: pass,
    DialogFooter: pass,
    DialogTitle: pass,
    DialogDescription: pass,
    DialogClose: pass,
  };
});
vi.mock("@/components/ui/select", async () => {
  const R = await import("react");
  const pass = ({ children }: { children?: React.ReactNode }) => R.createElement("div", null, children);
  return {
    Select: pass,
    SelectTrigger: pass,
    SelectValue: () => null,
    SelectContent: pass,
    SelectItem: pass,
    SelectGroup: pass,
    SelectLabel: pass,
  };
});

// Les pages utilisent le runtime JSX classique (React global) : absent en environnement node.
(globalThis as { React?: typeof React }).React = React;
vi.setConfig({ testTimeout: 60_000 });

/** `VEHICLE_LIST_DEFAULT_LIMIT` (server/services/vehicle-list-service.ts). */
const SERVER_DEFAULT_LIMIT = 10;
const FLEET = Array.from({ length: 37 }, (_, i) => ({
  id: i + 1,
  registrationNumber: `LT-${String(i + 1).padStart(3, "0")}-AA`,
  brand: "Volvo",
  model: `FH${i + 1}`,
  status: "active",
}));

/** Réponse de la route pour une clé de requête ; `undefined` : requête laissée sans données. */
function fakeServer(queryKey: readonly unknown[]): unknown {
  const [path, second] = queryKey;
  // `fetchAllVehicles` (lecture page par page) : la liste entière.
  if (path === "/api/vehicles" && second === "all") return FLEET;
  if (path === "/api/vehicles" && (second === undefined || (typeof second === "object" && second !== null))) {
    const params = (second ?? {}) as { search?: string; limit?: number; offset?: number };
    const needle = params.search?.toLowerCase();
    const matching = [...FLEET]
      .reverse() // récents d'abord
      .filter((v) => !needle || [v.registrationNumber, v.brand, v.model].some((f) => f.toLowerCase().includes(needle)));
    const offset = params.offset ?? 0;
    const limit = params.limit ?? SERVER_DEFAULT_LIMIT;
    return { vehicles: matching.slice(offset, offset + limit), total: matching.length };
  }
  const detail = typeof path === "string" ? path.match(/^\/api\/vehicles\/(\d+)$/) : null;
  if (detail) return FLEET.find((v) => v.id === Number(detail[1])) ?? null;
  if (typeof path === "string" && /^\/api\/(maintenance-schedules|vehicles\/\d+\/documents)/.test(path)) return [];
  return undefined;
}

function render(element: React.ReactElement): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryOnMount: false, staleTime: Infinity } },
  });
  // Cache partagé de l'application : un autre écran a déjà lu `["/api/vehicles"]` (objet paginé).
  client.setQueryData(["/api/vehicles"], fakeServer(["/api/vehicles"]));
  const draw = () =>
    renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(TooltipProvider, null, element),
      ),
    );
  let html = draw();
  for (let pass = 0; pass < 5; pass++) {
    let served = 0;
    for (const query of client.getQueryCache().getAll()) {
      if (query.state.data !== undefined) continue;
      const data = fakeServer(query.queryKey);
      if (data === undefined) continue;
      client.setQueryData(query.queryKey, data);
      served++;
    }
    if (served === 0) break;
    html = draw();
  }
  return html;
}

const esc = (label: string) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function kpiValue(html: string, label: string): string {
  const match = html.match(new RegExp(`<p[^>]*>${esc(label)}</p><p[^>]*>((?:(?!</p>).)*)</p>`));
  expect(match, `tuile « ${label} » absente du rendu`).not.toBeNull();
  return match![1].replace(/<[^>]*>/g, "").trim();
}

describe("lecteurs de GET /api/vehicles : forme { vehicles, total }", () => {
  it("maintenance préventive : le dialogue propose tout le parc, sans planter", async () => {
    const { default: Page } = await import("@/pages/maintenance/preventive");
    const html = render(React.createElement(Page));
    // Le plus ancien véhicule (hors des 10 récents) figure dans le sélecteur.
    expect(html).toContain("LT-001-AA");
    expect(html).toContain("LT-037-AA");
  });

  it("tableau de bord client : « Mes véhicules » lit le total servi, pas 0", async () => {
    const { default: Page } = await import("@/pages/client/dashboard");
    const html = render(React.createElement(Page));
    expect(kpiValue(html, "Mes véhicules")).toBe("37");
  });

  it("fiche par immatriculation : un véhicule hors des 10 récents s'affiche", async () => {
    const { default: Page } = await import("@/pages/vehicles/immatriculation/[registration]");
    const html = render(React.createElement(Page, { params: { registration: "LT-003-AA" } }));
    expect(html).not.toContain("Chargement...");
    expect(html).not.toContain("Véhicule non trouvé");
    expect(html).toContain("Volvo FH3 - LT-003-AA");
  });

  it("fiche par immatriculation : immatriculation inconnue, « Véhicule non trouvé » et non un chargement sans fin", async () => {
    const { default: Page } = await import("@/pages/vehicles/immatriculation/[registration]");
    const html = render(React.createElement(Page, { params: { registration: "ZZ-999-ZZ" } }));
    expect(html).not.toContain("Chargement...");
    expect(html).toContain("Véhicule non trouvé");
  });
});
