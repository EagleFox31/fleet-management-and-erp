import { createServer, type Server } from "http";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { vehicleDocumentTypes } from "../../shared/schema";
import {
  VEHICLE_DOCUMENT_TYPE_SEED,
  VEHICLE_DOCUMENT_TYPES_PATH,
  vehicleDocumentTypeListResponseSchema,
  vehicleDocumentTypePath,
} from "../../shared/contracts/vehicle-document-types";
import { db } from "../../server/db";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";

/** Niveau C, T-16 : referentiel des types de document vehicule. */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<string, string>();
const CODE = `zz_test_${Date.now().toString(36)}`;

async function login(role: TestUserRole) {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  cookies.set(role, res.headers.get("set-cookie")!.split(";")[0]);
}

async function call(method: string, path: string, role?: string, body?: unknown) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { ...(role ? { Cookie: cookies.get(role)! } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  await login("admin");
  await login("technician");
}, 120000);

afterAll(async () => {
  await db.delete(vehicleDocumentTypes).where(eq(vehicleDocumentTypes.code, CODE));
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

describe("/api/vehicle-document-types", { timeout: 120000 }, () => {
  it("refuse sans session", async () => {
    expect((await call("GET", VEHICLE_DOCUMENT_TYPES_PATH)).status).toBe(401);
  });

  it("sert les 9 types inscrits au demarrage, ordonnes, a tout utilisateur connecte", async () => {
    const res = await call("GET", VEHICLE_DOCUMENT_TYPES_PATH, "technician");
    expect(res.status).toBe(200);
    expect(vehicleDocumentTypeListResponseSchema.safeParse(res.body).success).toBe(true);
    const codes = (res.body as { code: string }[]).map((t) => t.code);
    for (const seed of VEHICLE_DOCUMENT_TYPE_SEED) expect(codes).toContain(seed.code);
    const orders = (res.body as { sortOrder: number }[]).map((t) => t.sortOrder);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it("reserve la creation et la modification a l'administrateur", async () => {
    const body = { code: CODE, label: "Type de test", validityMonths: 12 };
    expect((await call("POST", VEHICLE_DOCUMENT_TYPES_PATH, "technician", body)).status).toBe(403);
    expect((await call("PATCH", vehicleDocumentTypePath("carte_grise"), "technician", { label: "x y" })).status).toBe(403);
    expect((await call("GET", `${VEHICLE_DOCUMENT_TYPES_PATH}?includeInactive=true`, "technician")).status).toBe(403);
  });

  it("cree avec les valeurs par defaut, refuse le doublon et un code invalide", async () => {
    const created = await call("POST", VEHICLE_DOCUMENT_TYPES_PATH, "admin", { code: CODE, label: "Type de test", validityMonths: null });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ code: CODE, alertDays: 30, active: true, sortOrder: 100, validityMonths: null });
    expect((await call("POST", VEHICLE_DOCUMENT_TYPES_PATH, "admin", { code: CODE, label: "Autre", validityMonths: 6 })).status).toBe(409);
    const bad = await call("POST", VEHICLE_DOCUMENT_TYPES_PATH, "admin", { code: "Code Invalide", label: "Autre", validityMonths: 6 });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).not.toMatch(/ZodError|stack/);
  });

  it("modifie, desactive (jamais de suppression) et masque le type inactif aux non-admin", async () => {
    const patched = await call("PATCH", vehicleDocumentTypePath(CODE), "admin", { label: "Libelle modifie", alertDays: 15, active: false });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ code: CODE, label: "Libelle modifie", alertDays: 15, active: false });

    const visible = (await call("GET", VEHICLE_DOCUMENT_TYPES_PATH, "technician")).body as { code: string }[];
    expect(visible.map((t) => t.code)).not.toContain(CODE);
    const all = (await call("GET", `${VEHICLE_DOCUMENT_TYPES_PATH}?includeInactive=true`, "admin")).body as { code: string }[];
    expect(all.map((t) => t.code)).toContain(CODE);

    expect((await call("DELETE", vehicleDocumentTypePath(CODE), "admin")).status).toBeGreaterThanOrEqual(404);
    expect((await call("PATCH", vehicleDocumentTypePath(CODE), "admin", {})).status).toBe(400);
    expect((await call("PATCH", vehicleDocumentTypePath("zz_inconnu"), "admin", { label: "ab" })).status).toBe(404);
  });
});
