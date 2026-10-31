import { describe, expect, it } from "vitest";
import { getContractApp } from "../support/app";
import { isSessionGuard } from "../../server/middleware/auth";

/**
 * Toute route /api doit être précédée d'une garde de session (authenticate,
 * authorize, isAdmin…), sauf les routes publiques listées ci-dessous.
 *
 * Contrôle statique: on parcourt la pile Express sans exécuter aucun handler.
 * La base de test pointe sur le même Neon que le dev; appeler des routes
 * ouvertes sans session y écrirait réellement.
 */

// Routes publiques assumées: "METHODE /chemin" tel que Express le déclare.
// Ajouter une entrée ici est une décision de sécurité: la justifier en commentaire.
const PUBLIC_ROUTES = new Set<string>([
  "GET /api/health", // sonde de disponibilité, aucune donnée métier
  "POST /api/auth/login", // ouvre la session
  "POST /api/auth/pin-login", // ouvre la session chauffeur
  "GET /api/auth/drivers-list", // écran de connexion PIN: id et nom des chauffeurs seulement
  "GET /api/auth/challenge", // defi captcha, appele avant la connexion (derriere le drapeau captcha)
  "POST /api/auth/logout", // ferme la session, sans effet hors session
]);

type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: Layer[] };
  handle: ((...args: unknown[]) => unknown) & { stack?: Layer[] };
  regexp: RegExp & { fast_slash?: boolean };
  name?: string;
};

function mountPath(layer: Layer): string {
  if (layer.regexp.fast_slash) return "";
  return layer.regexp.source
    .replace(/^\^/, "")
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, "")
    .replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, ":param")
    .replace(/\\\//g, "/");
}

function collectRoutes(
  stack: Layer[],
  prefix: string,
  inheritedGuards: string[],
  out: { key: string; guarded: boolean }[],
) {
  const guards = [...inheritedGuards];
  for (const layer of stack) {
    if (layer.route) {
      const path = prefix + layer.route.path;
      const guarded =
        guards.some((g) => path === g || path.startsWith(g + "/") || g === "") ||
        layer.route.stack.some((l) => isSessionGuard(l.handle));
      for (const method of Object.keys(layer.route.methods)) {
        out.push({ key: `${method.toUpperCase()} ${path}`, guarded });
      }
    } else if (layer.handle.stack) {
      collectRoutes(layer.handle.stack, prefix + mountPath(layer), guards, out);
    } else if (isSessionGuard(layer.handle)) {
      // Garde posée par app.use / router.use: couvre les routes suivantes du préfixe.
      guards.push(prefix + mountPath(layer));
    }
  }
}

describe("Garde de session sur l'API", () => {
  it("aucune route /api n'est accessible sans session, hors liste publique", async () => {
    const app = (await getContractApp()) as unknown as { _router: { stack: Layer[] } };
    const routes: { key: string; guarded: boolean }[] = [];
    collectRoutes(app._router.stack, "", [], routes);

    const apiRoutes = routes.filter((r) => r.key.split(" ")[1].startsWith("/api"));
    expect(apiRoutes.length).toBeGreaterThan(100);

    const open = apiRoutes
      .filter((r) => !r.guarded && !PUBLIC_ROUTES.has(r.key))
      .map((r) => r.key);

    expect(open).toEqual([]);
  });

  it("la liste publique ne référence que des routes existantes", async () => {
    const app = (await getContractApp()) as unknown as { _router: { stack: Layer[] } };
    const routes: { key: string; guarded: boolean }[] = [];
    collectRoutes(app._router.stack, "", [], routes);
    const keys = new Set(routes.map((r) => r.key));

    expect([...PUBLIC_ROUTES].filter((k) => !keys.has(k))).toEqual([]);
  });
});
