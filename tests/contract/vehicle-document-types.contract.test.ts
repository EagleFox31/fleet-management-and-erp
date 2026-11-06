import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { vehicleDocuments, vehicleDocumentTypes } from "../../shared/schema";
import {
  VEHICLE_DOCUMENT_TYPE_SEED,
  VEHICLE_DOCUMENT_TYPES_PATH,
  vehicleDocumentTypeListResponseSchema,
  vehicleDocumentTypePath,
} from "../../shared/contracts/vehicle-document-types";
import { db, pool } from "../../server/db";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";
import { leakText } from "../support/api-error";

/** Niveau C, T-16 : referentiel des types de document vehicule. */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<string, string>();
const CODE = `zz_test_${Date.now().toString(36)}`;
/** Type utilisé par un document : désactivable, jamais supprimable (FK vehicle_documents.type). */
const USED = `zz_used_${Date.now().toString(36)}`;
const FK = "vehicle_documents_type_vehicle_document_types_code_fk";
let usedVehicleId = 0;

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
  await login("client");
}, 120000);

afterAll(async () => {
  // Ordre des clés étrangères : documents, puis types qu'ils référencent, puis véhicule et comptes.
  if (usedVehicleId) await db.delete(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, usedVehicleId));
  await db.delete(vehicleDocumentTypes).where(inArray(vehicleDocumentTypes.code, [CODE, USED, `${CODE}_renomme`]));
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

describe("/api/vehicle-document-types", { timeout: 120000 }, () => {
  it("refuse sans session", async () => {
    expect((await call("GET", VEHICLE_DOCUMENT_TYPES_PATH)).status).toBe(401);
  });

  it("refuse le client", async () => {
    expect((await call("GET", VEHICLE_DOCUMENT_TYPES_PATH, "client")).status).toBe(403);
  });

  it("sert les 11 types inscrits au demarrage, ordonnes, a tout utilisateur connecte", async () => {
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
    expect(leakText(bad.body)).not.toMatch(/ZodError|stack/);
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

describe("code immuable et type utilisé (FK vehicle_documents.type)", { timeout: 120000 }, () => {
  it("PATCH ignore un code dans le corps : le code reste celui du chemin, aucun type renommé", async () => {
    const patched = await call("PATCH", vehicleDocumentTypePath(CODE), "admin", { code: `${CODE}_renomme`, label: "Libelle fige" });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ code: CODE, label: "Libelle fige" });
    const renamed = await db.select().from(vehicleDocumentTypes).where(eq(vehicleDocumentTypes.code, `${CODE}_renomme`));
    expect(renamed).toHaveLength(0);
    const kept = await db.select().from(vehicleDocumentTypes).where(eq(vehicleDocumentTypes.code, CODE));
    expect(kept).toHaveLength(1);
    // Un corps qui ne porte que le code ne modifie rien : 400 lisible.
    const onlyCode = await call("PATCH", vehicleDocumentTypePath(CODE), "admin", { code: `${CODE}_renomme` });
    expect(onlyCode.status).toBe(400);
    expect(leakText(onlyCode.body)).not.toMatch(/ZodError|stack/);
  });

  it("désactiver un type utilisé reste permis : le document existant reste lisible", async () => {
    expect((await call("POST", VEHICLE_DOCUMENT_TYPES_PATH, "admin", { code: USED, label: "Type utilise", validityMonths: 12 })).status).toBe(201);
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    usedVehicleId = vehicle.id;
    const [doc] = await db
      .insert(vehicleDocuments)
      .values({ vehicleId: vehicle.id, name: "TEST doc type utilise", type: USED, filename: "x.pdf", filesize: 1, fileType: "application/pdf", filePath: "uploads/x.pdf" })
      .returning();

    const off = await call("PATCH", vehicleDocumentTypePath(USED), "admin", { active: false });
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ code: USED, active: false });

    const list = await call("GET", `/api/vehicles/${vehicle.id}/documents`, "admin");
    expect(list.status).toBe(200);
    expect((list.body as { id: number; type: string }[]).find((d) => d.id === doc.id)).toMatchObject({ type: USED });
  });

  it("aucune route DELETE ; un DELETE SQL direct d'un type utilisé est refusé par la FK, le type reste", async () => {
    expect((await call("DELETE", vehicleDocumentTypePath(USED), "admin")).status).toBe(404);
    await expect(pool.query("DELETE FROM vehicle_document_types WHERE code = $1", [USED])).rejects.toMatchObject({ code: "23503", constraint: FK });
    expect(await db.select().from(vehicleDocumentTypes).where(eq(vehicleDocumentTypes.code, USED))).toHaveLength(1);
  });

  it("changer le code d'un type utilisé en SQL direct est refusé (pas d'ON UPDATE CASCADE)", async () => {
    await expect(pool.query("UPDATE vehicle_document_types SET code = $2 WHERE code = $1", [USED, `${USED}_x`])).rejects.toMatchObject({ code: "23503", constraint: FK });
  });
});
