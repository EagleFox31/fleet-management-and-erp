import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getContractApp } from "../support/app";
import { startContractSession } from "../support/contract-session";
import { collectRoutes, mountPath, type Layer } from "../support/express-routes";
import { VIEWER_READ_ONLY_MESSAGE, viewerReadOnlyGuard } from "../../server/middleware/viewer-read-only-guard";
import { VIEWER_WRITE_ALLOWED } from "@shared/constants/roles";

/**
 * Lecteur (`viewer`) : toute route d'écriture de l'API, telle qu'Express la déclare, répond 403
 * avec le message de lecture seule. Le parcours de la pile garantit qu'une route ajoutée plus
 * tard est couverte sans qu'on y pense.
 *
 * Le parcours part de l'application complète (`app._router.stack`), pas du seul `apiRouter` :
 * il voit donc les routes de `server/api/*` (montées sous `/api`), celles que `registerRoutes`
 * déclare directement sur `app` (`server/routes.ts`) et les limiteurs de `server/app.ts`. La garde
 * vit en tête d'`apiRouter`, monté sur `/api` AVANT `registerRoutes` : Express la joue pour toute
 * requête `/api/*`, y compris celles qui aboutissent dans `routes.ts`. Deux assertions le figent :
 * l'ordre de montage, et l'absence de route d'écriture hors `/api` (qu'aucune garde ne couvrirait).
 * L'upgrade WebSocket et les fichiers statiques ne sont pas des routes Express : hors périmètre.
 */
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// Ouvrent la session : sans session, la garde laisse la route répondre.
const SESSION_OPENERS = new Set(["POST /api/auth/login", "POST /api/auth/pin-login"]);
const ALLOWED = new Set(VIEWER_WRITE_ALLOWED.map((a) => `${a.method} /api${a.path}`));

/** `/api/x/:id(\d+)/y` → `/api/x/1/y` : la garde refuse avant toute lecture de l'objet. */
const concrete = (path: string) => path.replace(/:[A-Za-z_]+(\([^)]*\))?\??/g, "1");

describe("lecteur (viewer) : lecture seule sur toute l'API", { timeout: 180000 }, () => {
  let session: Awaited<ReturnType<typeof startContractSession<"viewer">>>;
  let writes: string[] = [];
  /** Décompte par origine : routeurs de server/api, routes posées sur app (routes.ts), hors /api. */
  const origin = { apiRouter: 0, registerRoutes: 0, horsApi: 0 };
  let guardIndex = -1;
  let firstAppWriteIndex = -1;

  beforeAll(async () => {
    session = await startContractSession({ viewer: "viewer" });
    const app = (await getContractApp()) as unknown as { _router: { stack: Layer[] } };
    const routes: { key: string; guarded: boolean }[] = [];
    collectRoutes(app._router.stack, "", [], routes);
    const isWrite = (key: string) => {
      const [method] = key.split(" ");
      return WRITE_METHODS.has(method) && !SESSION_OPENERS.has(key) && !ALLOWED.has(key);
    };
    writes = [...new Set(routes.map((r) => r.key))].filter((key) => isWrite(key) && key.split(" ")[1].startsWith("/api"));

    app._router.stack.forEach((layer, index) => {
      if (layer.handle.stack) {
        if (guardIndex < 0 && layer.handle.stack.some((l) => l.handle === viewerReadOnlyGuard)) guardIndex = index;
        const nested: { key: string; guarded: boolean }[] = [];
        collectRoutes(layer.handle.stack, mountPath(layer), [], nested);
        for (const r of new Set(nested.map((n) => n.key))) {
          if (!isWrite(r)) continue;
          if (r.split(" ")[1].startsWith("/api")) origin.apiRouter += 1;
          else origin.horsApi += 1;
        }
      } else if (layer.route) {
        for (const method of Object.keys(layer.route.methods)) {
          const key = `${method.toUpperCase()} ${layer.route.path}`;
          if (!isWrite(key)) continue;
          if (layer.route.path.startsWith("/api")) {
            origin.registerRoutes += 1;
            if (firstAppWriteIndex < 0) firstAppWriteIndex = index;
          } else origin.horsApi += 1;
        }
      }
    });
  });

  afterAll(async () => {
    await session?.stop();
  });

  it("la garde est montée sur /api avant les routes que registerRoutes pose sur app", () => {
    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(firstAppWriteIndex).toBeGreaterThan(guardIndex);
  });

  it("le parcours couvre les routeurs de server/api et routes.ts ; aucune écriture hors /api", () => {
    // Décompte par origine figé en plancher, pas en valeur exacte : une route ajoutée ne casse rien.
    expect({ ...origin, total: writes.length }).toMatchObject({ horsApi: 0 });
    expect(origin.apiRouter).toBeGreaterThan(20);
    expect(origin.registerRoutes).toBeGreaterThan(20);
    // Quelques chemins sont déclarés des deux côtés (le routeur server/api masque routes.ts) : le total
    // unique est entre le plus grand des deux et leur somme.
    expect(writes.length).toBeGreaterThanOrEqual(Math.max(origin.apiRouter, origin.registerRoutes));
    expect(writes.length).toBeLessThanOrEqual(origin.apiRouter + origin.registerRoutes);
  });

  it("toutes les routes d'écriture répondent 403 avec le message de lecture seule", async () => {
    expect(writes.length).toBeGreaterThan(100);
    const failures: string[] = [];
    for (const key of writes) {
      const [method, path] = key.split(" ");
      const res = await session.call(method, concrete(path), { actor: "viewer", body: {} });
      if (res.status !== 403 || res.body?.message !== VIEWER_READ_ONLY_MESSAGE) {
        failures.push(`${key} → ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("lit la flotte", async () => {
    const res = await session.call("GET", "/api/vehicles", { actor: "viewer" });
    expect(res.status).toBe(200);
  });

  it("la fermeture de session reste ouverte", async () => {
    const res = await session.call("POST", "/api/auth/logout", { actor: "viewer" });
    expect(res.status).toBeLessThan(400);
  });
});
