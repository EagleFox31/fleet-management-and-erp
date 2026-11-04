import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getContractApp } from "../support/app";
import { createTestUser, TEST_USER_PASSWORD } from "../support/factories";
import { cleanupCreated, createIdBag } from "../support/cleanup";

// #285 : la route lisait la racine du dépôt alors que les documents sont sous docs/ ; l'aperçu admin
// répondait 500 dès que la queryFn atteignait enfin `/api/documentation/<fichier>`.
let server: Server;
let baseUrl = "";
const ids = createIdBag();

async function login(role: "admin" | "technician"): Promise<string> {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  const r = await fetch(baseUrl + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(r.status).toBe(200);
  return r.headers.get("set-cookie")!.split(";")[0];
}

async function get(path: string, cookie: string) {
  const r = await fetch(baseUrl + path, { headers: { Cookie: cookie } });
  return { status: r.status, body: (await r.json().catch(() => null)) as Record<string, unknown> | null };
}

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterAll(async () => {
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

describe("GET /api/documentation/:filename (#285)", { timeout: 120000 }, () => {
  it.each(["GUIDE_UTILISATEUR.md", "CAHIER_TESTS_UTILISATEUR.md"])("sert %s à un admin", async (filename) => {
    const cookie = await login("admin");
    const r = await get(`/api/documentation/${filename}`, cookie);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ filename });
    expect(String(r.body?.content).length).toBeGreaterThan(100);
  });

  it("refuse un nom hors liste blanche, y compris une remontée encodée", async () => {
    const cookie = await login("admin");
    for (const name of ["..%2Fetc.md", "..%2F..%2Fpackage.json", "toString", "README.md"]) {
      expect((await get(`/api/documentation/${name}`, cookie)).status, name).toBe(400);
    }
  });

  it("refuse un non-admin", async () => {
    const cookie = await login("technician");
    expect((await get("/api/documentation/GUIDE_UTILISATEUR.md", cookie)).status).toBe(403);
  });
});
