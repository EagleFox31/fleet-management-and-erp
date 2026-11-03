import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";

/**
 * Une route /api inconnue répond 404 au contrat ApiErrorBody (AGENTS.md §10), jamais le HTML du
 * SPA ni la page « Cannot GET » d'Express. Le repli SPA est simulé comme dans server/index.ts :
 * monté après createApp, il doit continuer de servir les chemins hors /api.
 */
let server: Server;
let baseUrl = "";
const SPA_HTML = "<!doctype html><title>spa</title>";

beforeAll(async () => {
  const { app } = await createApp({ initializeDb: false });
  app.use("*", (_req, res) => {
    res.status(200).type("html").send(SPA_HTML);
  });
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("adresse du serveur de test introuvable");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("route /api inconnue", () => {
  it.each([
    ["GET", "/api/route-inexistante-c7"],
    ["POST", "/api/route-inexistante-c7"],
    ["DELETE", "/api/route-inexistante-c7/42"],
  ])("%s %s → 404 JSON au contrat", async (method, path) => {
    const response = await fetch(baseUrl + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify({}),
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
    const body = await response.json();
    expect(body).toEqual({
      message: expect.any(String),
      code: "NOT_FOUND",
      requestId: expect.any(String),
    });
    expect(response.headers.get("x-request-id")).toBe(body.requestId);
  });

  it("un chemin hors /api garde le repli SPA", async () => {
    const response = await fetch(`${baseUrl}/ecran-inexistant-c7`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(SPA_HTML);
  });
});
