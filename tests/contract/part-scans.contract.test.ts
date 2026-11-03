import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_APP_ROLES, PART_LABEL_ROLES, PART_SCAN_ROLES, type AppRole } from "../../shared/constants/roles";
import { partLabelsResponseSchema, partScanResolveResponseSchema } from "../../shared/contracts/part-scans";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart, createTestUser, TEST_USER_PASSWORD } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * `/api/part-scans` (CDC-3) avec base et sessions réelles : lecture d'une pièce TEST* créée puis
 * supprimée, jamais d'une donnée de recette. Aucune écriture n'est faite par les routes testées.
 * Jumeau sans base : tests/unit/server/part-scans-routes.test.ts.
 *
 * À ne lancer que sur une base de test (DATABASE_URL_TEST) et sous verrou db-lock.
 */
const previousFlags = process.env.FEATURE_FLAGS;
let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<AppRole, string>();
let partId = 0;
let reference = "";
let twinReference = "";
let twinIds: number[] = [];

async function get(path: string, role?: AppRole) {
  const response = await fetch(baseUrl + path, { headers: role ? { Cookie: cookies.get(role)! } : {} });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, text };
}

beforeAll(async () => {
  process.env.FEATURE_FLAGS = "part-qr=on";
  server = createServer(await getContractApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  for (const role of ALL_APP_ROLES) {
    const user = await createTestUser({ role: role as never });
    ids.userIds.push(user.id);
    const res = await fetch(baseUrl + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
    });
    expect(res.status, `connexion ${role}`).toBe(200);
    cookies.set(role, res.headers.get("set-cookie")!.split(";")[0]);
  }

  reference = uniqueTestToken("scan").toUpperCase();
  const part = await createTestPart({
    reference,
    name: "TEST pièce scan",
    quantity: 14,
    location: "TEST-A1",
    unitPrice: "98765.43",
    supplier: "TEST fournisseur confidentiel",
  });
  partId = part.id;
  ids.partIds.push(part.id);

  // Deux pièces dont les références ne diffèrent que par la casse : la contrainte unique est sensible à la casse.
  twinReference = uniqueTestToken("jumeau").toUpperCase();
  const upper = await createTestPart({ reference: twinReference, name: "TEST jumeau A" });
  const lower = await createTestPart({ reference: twinReference.toLowerCase(), name: "TEST jumeau B" });
  twinIds = [upper.id, lower.id];
  ids.partIds.push(upper.id, lower.id);
});

afterAll(async () => {
  if (previousFlags === undefined) delete process.env.FEATURE_FLAGS;
  else process.env.FEATURE_FLAGS = previousFlags;
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("GET /api/part-scans/resolve", { timeout: 120000 }, () => {
  it.each([...PART_SCAN_ROLES])("%s résout la charge utile d'une pièce, sans prix", async (role) => {
    const { status, body, text } = await get(`/api/part-scans/resolve?code=${encodeURIComponent(`/inventory/scan?c=FM1:${partId}`)}`, role);
    expect(status).toBe(200);
    const part = partScanResolveResponseSchema.parse(body);
    expect(part).toEqual({ id: partId, reference, name: "TEST pièce scan", quantity: 14, location: "TEST-A1", unit: "pièce" });
    expect(text).not.toContain("98765");
    expect(text).not.toContain("confidentiel");
  });

  it("résout aussi la référence interne, casse et espaces tolérés (index parts_reference_key_idx)", async () => {
    const { status, body } = await get(`/api/part-scans/resolve?code=${encodeURIComponent(`  ${reference.toLowerCase()} `)}`, "warehouse");
    expect(status).toBe(200);
    expect(body.id).toBe(partId);
  });

  it("préfixe d'origine quelconque : même pièce", async () => {
    const code = encodeURIComponent(`https://autre-hote.example/inventory/scan?c=FM1:${partId}`);
    expect((await get(`/api/part-scans/resolve?code=${code}`, "technician")).body.id).toBe(partId);
  });

  it("code inconnu : 404 normalisé", async () => {
    const { status, body } = await get(`/api/part-scans/resolve?code=${encodeURIComponent("FM1:2147483647")}`, "admin");
    expect(status).toBe(404);
    expect(body).toMatchObject({ code: "NOT_FOUND", requestId: expect.any(String) });
    const unknownRef = await get(`/api/part-scans/resolve?code=${encodeURIComponent(uniqueTestToken("absent"))}`, "admin");
    expect(unknownRef.status).toBe(404);
  });

  it("référence portée par deux pièces : 409, sans identifiant dans le message", async () => {
    const { status, body } = await get(`/api/part-scans/resolve?code=${encodeURIComponent(twinReference)}`, "admin");
    expect(status).toBe(409);
    for (const id of twinIds) expect(body.message).not.toContain(String(id));
  });

  it("code mal formé : 400", async () => {
    expect((await get("/api/part-scans/resolve", "admin")).status).toBe(400);
    expect((await get(`/api/part-scans/resolve?code=${"a".repeat(301)}`, "admin")).status).toBe(400);
    expect((await get("/api/part-scans/resolve?code=FM2:1", "admin")).status).toBe(400);
  });

  it("sans session : 401 ; rôles hors scan (driver, client, logistics...) : 403", async () => {
    expect((await get("/api/part-scans/resolve?code=FM1:1")).status).toBe(401);
    for (const role of ALL_APP_ROLES.filter((r) => !(PART_SCAN_ROLES as readonly string[]).includes(r))) {
      expect((await get(`/api/part-scans/resolve?code=FM1:${partId}`, role)).status, role).toBe(403);
    }
  });

  it("drapeau coupé : 404 même pour l'administrateur", async () => {
    process.env.FEATURE_FLAGS = "part-qr=off";
    try {
      expect((await get(`/api/part-scans/resolve?code=FM1:${partId}`, "admin")).status).toBe(404);
    } finally {
      process.env.FEATURE_FLAGS = "part-qr=on";
    }
  });
});

describe("GET /api/part-scans/labels", { timeout: 120000 }, () => {
  it.each([...PART_LABEL_ROLES])("%s obtient la charge utile et les textes, sans prix", async (role) => {
    const { status, body, text } = await get(`/api/part-scans/labels?ids=${partId},2147483647`, role);
    expect(status).toBe(200);
    const labels = partLabelsResponseSchema.parse(body);
    expect(labels.items).toEqual([
      { partId, payload: `/inventory/scan?c=FM1:${partId}`, reference, name: "TEST pièce scan", location: "TEST-A1", unit: "pièce" },
    ]);
    expect(labels.missingIds).toEqual([2147483647]);
    expect(text).not.toContain("98765");
    expect(text).not.toContain("confidentiel");
  });

  it("workshop_manager et technician, admis au scan, sont refusés sur les étiquettes", async () => {
    for (const role of ["workshop_manager", "technician"] as const) {
      expect((await get(`/api/part-scans/labels?ids=${partId}`, role)).status, role).toBe(403);
    }
  });

  it("sans session : 401 ; driver, client, logistics : 403 ; ids invalides : 400", async () => {
    expect((await get(`/api/part-scans/labels?ids=${partId}`)).status).toBe(401);
    for (const role of ["driver", "client", "logistics"] as const) {
      expect((await get(`/api/part-scans/labels?ids=${partId}`, role)).status, role).toBe(403);
    }
    expect((await get("/api/part-scans/labels?ids=1,abc", "admin")).status).toBe(400);
    expect((await get("/api/part-scans/labels", "warehouse")).status).toBe(400);
  });
});
