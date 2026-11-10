import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getContractApp } from "../support/app";
import { startContractSession } from "../support/contract-session";
import { collectRoutes, type Layer } from "../support/express-routes";
import { VIEWER_READ_ONLY_MESSAGE } from "../../server/middleware/viewer-read-only-guard";
import { VIEWER_WRITE_ALLOWED } from "@shared/constants/roles";

/**
 * Lecteur (`viewer`) : toute route d'écriture de l'API, telle qu'Express la déclare, répond 403
 * avec le message de lecture seule. Le parcours de la pile garantit qu'une route ajoutée plus
 * tard est couverte sans qu'on y pense.
 */
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// Ouvrent la session : sans session, la garde laisse la route répondre.
const SESSION_OPENERS = new Set(["POST /api/auth/login", "POST /api/auth/pin-login"]);
const ALLOWED = new Set(VIEWER_WRITE_ALLOWED.map((a) => `${a.method} /api${a.path}`));

/** `/api/x/:id(\d+)/y` → `/api/x/1/y` : la garde refuse avant toute lecture de l'objet. */
const concrete = (path: string) => path.replace(/:[A-Za-z_]+(\([^)]*\))?\??/g, "1");

describe("lecteur (viewer) : lecture seule sur toute l'API", { timeout: 180000 }, () => {
  let session: Awaited<ReturnType<typeof startContractSession>>;
  let writes: string[] = [];

  beforeAll(async () => {
    session = await startContractSession({ viewer: "viewer" });
    const app = (await getContractApp()) as unknown as { _router: { stack: Layer[] } };
    const routes: { key: string; guarded: boolean }[] = [];
    collectRoutes(app._router.stack, "", [], routes);
    writes = [...new Set(routes.map((r) => r.key))].filter((key) => {
      const [method, path] = key.split(" ");
      return WRITE_METHODS.has(method) && path.startsWith("/api") && !SESSION_OPENERS.has(key) && !ALLOWED.has(key);
    });
  });

  afterAll(async () => {
    await session?.stop();
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
