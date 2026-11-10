import express, { type ErrorRequestHandler } from "express";
import { readFileSync } from "fs";
import type http from "http";
import type { AddressInfo } from "net";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "../../../server/lib/app-error";
import { isNonCanonicalTarget, rejectNonCanonicalTarget } from "../../../server/middleware/reject-non-canonical-target";
import { BACKSLASH, sendRaw } from "../../support/raw-request";

/**
 * Topologie reelle : une garde declaree dans apiRouter (comme `last-admin-guard.routes.ts`) precede une
 * route declaree sur l'app (comme `server/routes.ts`). Pour `/api\users/62#x`, l'app lit `/api/users/62`
 * et apiRouter lit `//users/62` : sans `rejectNonCanonicalTarget`, la garde est sautee et la route s'execute.
 */
const B = BACKSLASH;
const TARGETS = [`/api${B}users/62#x`, `http://h/api${B}users/62`, `/api/users${B}62#`, `/api/users/62${B}#`];

function buildApp(withReject: boolean) {
  const app = express();
  if (withReject) app.use(rejectNonCanonicalTarget);
  const apiRouter = express.Router();
  apiRouter.patch("/users/:id", () => {
    throw new AppError(403, "Garde");
  });
  app.use("/api", apiRouter);
  app.patch("/api/users/:id", (_req, res) => {
    res.json({ executed: true });
  });
  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    res.status(err instanceof AppError ? err.status : 500).end();
  };
  app.use(onError);
  return app;
}

async function listen(app: express.Express): Promise<{ server: http.Server; port: number }> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  return { server, port: (server.address() as AddressInfo).port };
}

let guarded: { server: http.Server; port: number };
let bare: { server: http.Server; port: number };

beforeAll(async () => {
  guarded = await listen(buildApp(true));
  bare = await listen(buildApp(false));
});

afterAll(async () => {
  await Promise.all([guarded, bare].map(({ server }) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("rejectNonCanonicalTarget", () => {
  it("sans le middleware, une barre inverse juste apres le montage saute la garde du routeur (constat)", async () => {
    expect(await sendRaw(bare.port, "PATCH", TARGETS[0])).toBe(200);
  });

  it.each(TARGETS)("PATCH %s : 400 avant tout routage", async (target) => {
    expect(await sendRaw(guarded.port, "PATCH", target)).toBe(400);
  });

  it.each([`/api/users/62?q=a${B}b`, "/api/users/62?q=%5C", "/api/users/%5C62"])(
    "PATCH %s : `\\` en query ou %5C, cible legitime, la garde du routeur s'applique",
    async (target) => {
      expect(await sendRaw(guarded.port, "PATCH", target)).toBe(403);
    },
  );

  it("isNonCanonicalTarget : chemin avec `\\` ou forme absolue, rien d'autre", () => {
    expect(isNonCanonicalTarget(`/api${B}users`)).toBe(true);
    expect(isNonCanonicalTarget(`/api/users${B}62#x`)).toBe(true);
    expect(isNonCanonicalTarget("http://h/api/users/62")).toBe(true);
    expect(isNonCanonicalTarget("HTTPS://h/api/users/62")).toBe(true);
    expect(isNonCanonicalTarget(`/api/users?q=${B}`)).toBe(false);
    expect(isNonCanonicalTarget("/api/users/%5C62")).toBe(false);
    expect(isNonCanonicalTarget("/api/users/62")).toBe(false);
  });

  it("cible normale : la garde du routeur s'applique", async () => {
    expect(await sendRaw(guarded.port, "PATCH", "/api/users/62")).toBe(403);
    expect(await sendRaw(guarded.port, "PATCH", "/api//users/62")).toBe(403);
  });

  it("server/app.ts le monte avant apiRouter, registerRoutes et les fichiers statiques", () => {
    const source = readFileSync(path.resolve(__dirname, "../../../server/app.ts"), "utf8");
    const reject = source.indexOf("app.use(rejectNonCanonicalTarget)");
    expect(reject).toBeGreaterThan(-1);
    expect(reject).toBeLessThan(source.indexOf('app.use("/api", apiRouter)'));
    expect(reject).toBeLessThan(source.indexOf("registerRoutes(app)"));
    expect(reject).toBeLessThan(source.indexOf("express.static("));
  });
});
