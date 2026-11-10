import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAllowedOrigin, isTrustedRequestOrigin } from "../../../server/lib/allowed-origins";
import { requireSameOrigin } from "../../../server/middleware/require-same-origin";

/** Matrice du contrôle d'origine anti-CSRF (écritures /api et upgrade /ws). */
const saved = { APP_URL: process.env.APP_URL, CORS_ORIGIN: process.env.CORS_ORIGIN, NODE_ENV: process.env.NODE_ENV };
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete (process.env as Record<string, string | undefined>)[k];
    else (process.env as Record<string, string | undefined>)[k] = v;
  }
});

function run(method: string, path: string, headers: Record<string, string>) {
  let result: unknown = "pas appelé";
  requireSameOrigin({ method, path, headers } as never, {} as never, (err?: unknown) => {
    result = err ?? "ok";
  });
  return result as string | { status: number; message: string };
}

describe("isAllowedOrigin (source commune CORS / anti-CSRF)", () => {
  it("admet les coques natives et les origines configurées", () => {
    process.env.NODE_ENV = "production";
    process.env.APP_URL = "https://app.example";
    process.env.CORS_ORIGIN = "https://autre.example";
    for (const o of ["https://localhost", "capacitor://localhost", "https://app.example", "https://autre.example"]) {
      expect(isAllowedOrigin(o), o).toBe(true);
    }
    expect(isAllowedOrigin("https://evil.example")).toBe(false);
    expect(isAllowedOrigin("http://192.168.1.5:5000")).toBe(false);
  });

  it("tolère localhost et réseaux privés hors production seulement", () => {
    process.env.NODE_ENV = "development";
    expect(isAllowedOrigin("http://192.168.1.5:5000")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:5173")).toBe(true);
    expect(isAllowedOrigin("https://evil.example")).toBe(false);
    process.env.NODE_ENV = "production";
    expect(isAllowedOrigin("http://127.0.0.1:5173")).toBe(false);
  });
});

describe("isTrustedRequestOrigin", () => {
  const HOST = "app.example";
  beforeEach(prod);
  it.each([
    ["ni Origin ni Sec-Fetch-Site (script, contrat)", {}, true],
    ["same-origin", { secFetchSite: "same-origin", origin: "https://evil.example" }, true],
    ["none (saisie directe)", { secFetchSite: "none" }, true],
    ["cross-site, Origin étrangère", { secFetchSite: "cross-site", origin: "https://evil.example" }, false],
    ["same-site, Origin étrangère", { secFetchSite: "same-site", origin: "https://evil.example" }, false],
    ["Origin étrangère sans Sec-Fetch-Site", { origin: "https://evil.example" }, false],
    ["Origin opaque null", { secFetchSite: "cross-site", origin: "null" }, false],
    ["cross-site sans Origin", { secFetchSite: "cross-site" }, false],
    ["cross-site, APK capacitor", { secFetchSite: "cross-site", origin: "capacitor://localhost" }, true],
    ["cross-site, APK https://localhost", { secFetchSite: "cross-site", origin: "https://localhost" }, true],
    ["cross-site, origine configurée", { secFetchSite: "cross-site", origin: "https://app.example" }, true],
    ["Origin égale à l'hôte de la requête", { origin: `https://${HOST}`, host: HOST }, true],
    ["Origin proche de l'hôte (sous-domaine)", { origin: `https://x.${HOST}`, host: HOST }, false],
    ["Origin illisible", { secFetchSite: "cross-site", origin: "::pas une url" }, false],
  ] as const)("%s", (_nom, meta, attendu) => {
    expect(isTrustedRequestOrigin({ host: HOST, ...meta })).toBe(attendu);
  });
});

function prod() {
  process.env.NODE_ENV = "production";
  process.env.APP_URL = "https://app.example";
}

describe("requireSameOrigin", () => {
  beforeEach(prod);
  const CROSS = { origin: "https://evil.example", "sec-fetch-site": "cross-site", host: "app.example" };

  it.each(["POST", "PUT", "PATCH", "DELETE"])("%s /api cross-site : 403", (method) => {
    const err = run(method, "/api/work-orders/1/part-requirements/2/issue", CROSS) as { status: number; message: string };
    expect(err.status).toBe(403);
    expect(err.message).not.toMatch(/evil|origin|sec-fetch/i);
  });

  it.each([
    ["GET", "/api/vehicles", CROSS],
    ["OPTIONS", "/api/vehicles", CROSS],
    ["POST", "/hors-api", CROSS],
    ["POST", "/api/x", {}],
    ["POST", "/api/x", { "sec-fetch-site": "same-origin" }],
    ["POST", "/api/x", { ...CROSS, origin: "capacitor://localhost" }],
  ])("laisse passer %s %s %j", (method, path, headers) => {
    expect(run(method, path, headers)).toBe("ok");
  });
});
