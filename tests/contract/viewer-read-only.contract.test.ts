import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getContractApp } from "../support/app";
import { startContractSession } from "../support/contract-session";
import { collectRoutes, mountPath, type Layer } from "../support/express-routes";
import { TEST_USER_PASSWORD } from "../support/factories";
import { db } from "../../server/db";
import { alerts, users } from "../../shared/schema";
import { VIEWER_READ_ONLY_MESSAGE, viewerReadOnlyGuard } from "../../server/middleware/viewer-read-only-guard";
import { matchesAllowedWrite } from "@shared/constants/roles";

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
 *
 * Les décomptes sont figés en valeur exacte : toute route d'écriture ajoutée ou retirée met à jour
 * `EXPECTED` ci-dessous, en conscience, dans la même PR.
 */
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const EXPECTED = { apiRouter: 143, registerRoutes: 38, horsApi: 0, total: 177 };

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
    // Allowlist jouée sur le chemin concret, comme la garde (`/api/alerts/:id/read` → `/alerts/1/read`).
    const isWrite = (key: string) => {
      const [method, path] = key.split(" ");
      return WRITE_METHODS.has(method) && !matchesAllowedWrite(method, concrete(path).replace(/^\/api/, ""));
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
    expect({ ...origin, total: writes.length }).toEqual(EXPECTED);
  });

  it("toutes les routes d'écriture répondent 403 avec le message de lecture seule", async () => {
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

  describe("libre-service sur sa propre ligne", () => {
    it("avance son parcours d'accueil : étape, mascotte, fin", async () => {
      const step = await session.call("PATCH", "/api/onboarding/step", { actor: "viewer", body: { currentStep: 1, stepsCompleted: ["welcome"] } });
      expect(step.status, JSON.stringify(step.body)).toBe(200);
      const mascot = await session.call("PATCH", "/api/onboarding/mascot", { actor: "viewer", body: { mascotHidden: true } });
      expect(mascot.status, JSON.stringify(mascot.body)).toBe(200);
      const res = await session.call("PATCH", "/api/onboarding/complete", { actor: "viewer", body: {} });
      expect(res.status).toBe(200);
    });

    it("la connexion par PIN lui est ouverte par la garde, c'est la route qui la refuse (chauffeurs seulement)", async () => {
      const res = await session.call("POST", "/api/auth/pin-login", { actor: "viewer", body: { userId: String(session.userId("viewer")), pin: "0000" } });
      expect(res.status).toBe(401);
      expect(res.body?.message).not.toBe(VIEWER_READ_ONLY_MESSAGE);
    });

    it("règle ses préférences de notification", async () => {
      const res = await session.call("PATCH", "/api/notifications/settings", { actor: "viewer", body: [{ topic: "maintenance", inApp: true }] });
      expect(res.status).toBe(200);
    });

    it("marque lue une alerte qui lui est adressée", async () => {
      const [alert] = await db
        .insert(alerts)
        .values({ userId: session.userId("viewer"), title: "Lecteur", message: "Alerte de test", type: "maintenance", priority: "medium" })
        .returning({ id: alerts.id });
      const res = await session.call("PATCH", `/api/alerts/${alert.id}/read`, { actor: "viewer", body: {} });
      expect(res.status).toBe(200);
    });

    it("change son mot de passe", async () => {
      const res = await session.call("POST", "/api/users/change-password", {
        actor: "viewer",
        body: { currentPassword: TEST_USER_PASSWORD, newPassword: `${TEST_USER_PASSWORD}-lecteur-1` },
      });
      expect(res.status).toBe(200);
    });
  });

  // Les deux derniers, dans cet ordre : la fermeture puis la reconnexion rendent le cookie du harnais
  // obsolète (session détruite, puis régénérée). La reconnexion utilise le mot de passe changé plus haut.
  it("la fermeture de session reste ouverte", async () => {
    const res = await session.call("POST", "/api/auth/logout", { actor: "viewer" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await session.call("GET", "/api/vehicles", { actor: "viewer" })).status).toBe(401);
  });

  it("rouvre une session avec son nouveau mot de passe", async () => {
    const [me] = await db.select({ username: users.username }).from(users).where(eq(users.id, session.userId("viewer")));
    const res = await session.call("POST", "/api/auth/login", { actor: "viewer", body: { username: me.username, password: `${TEST_USER_PASSWORD}-lecteur-1` } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });
});
