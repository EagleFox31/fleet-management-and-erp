import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { activityLogs, vehicleDocuments, vehicles } from "../../shared/schema";
import { db } from "../../server/db";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";

/**
 * Niveau C, P3-2 : PATCH /api/documents/:id (server/routes.ts, route gelée) et miroir
 * `vehicles.*Expiry`. Fige le comportement actuel : la route écrit la colonne miroir
 * en direct (équivalent du mode "set" de la lib), sans comparer aux autres documents.
 *
 * Défaut connu (signalé, non corrigé ici) : corriger la date d'un document qui n'est
 * PAS le plus récent de son type fait reculer le miroir sur cette date plus ancienne ;
 * un véhicule peut ainsi redevenir « expiré » alors qu'un document valide existe. Le
 * scénario est en `it.fails` : vert tant que le défaut existe, rouge à la correction
 * (retirer alors `.fails`).
 */

let server: Server;
let baseUrl = "";
// Mise en place du scénario « document plus ancien » : hors du corps de l'it.fails (it-fails-hygiene).
const stale = { vehicleId: 0, oldDoc: 0 };
const ids = createIdBag();
const cookies = new Map<string, string>();

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

async function patch(documentId: number, body: unknown, role?: string) {
  const res = await fetch(`${baseUrl}/api/documents/${documentId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(role ? { Cookie: cookies.get(role)! } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function newVehicle(mirror: Partial<typeof vehicles.$inferInsert> = {}) {
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  // La fabrique ignore les colonnes miroir : on les pose ici.
  if (Object.keys(mirror).length) await db.update(vehicles).set(mirror).where(eq(vehicles.id, vehicle.id));
  return vehicle.id;
}

async function addDoc(vehicleId: number, type: string, expiryDate: string | null) {
  const [doc] = await db
    .insert(vehicleDocuments)
    .values({ vehicleId, name: `TEST ${type} ${expiryDate}`, type, expiryDate, filename: "x.pdf", filesize: 1, fileType: "application/pdf", filePath: "uploads/x.pdf" })
    .returning();
  return doc.id;
}

const mirrorOf = async (vehicleId: number) => {
  const [row] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
  return { insurance: row.insuranceExpiry && String(row.insuranceExpiry).slice(0, 10), inspection: row.technicalInspectionDate && String(row.technicalInspectionDate).slice(0, 10) };
};

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  await login("workshop_manager");
  await login("technician");
  stale.vehicleId = await newVehicle({ insuranceExpiry: "2036-01-01" });
  stale.oldDoc = await addDoc(stale.vehicleId, "assurance", "2030-01-01");
  await addDoc(stale.vehicleId, "assurance", "2036-01-01");
}, 120000);

afterAll(async () => {
  if (ids.vehicleIds.length) await db.delete(vehicleDocuments).where(inArray(vehicleDocuments.vehicleId, ids.vehicleIds));
  // L'intercepteur d'audit journalise l'écriture : ces lignes bloquent la suppression des utilisateurs.
  if (ids.userIds.length) await db.delete(activityLogs).where(inArray(activityLogs.userId, ids.userIds));
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

describe("PATCH /api/documents/:id et miroir des échéances", { timeout: 120000 }, () => {
  it("nouvelle date d'assurance : la colonne miroir insuranceExpiry suit", async () => {
    const vehicleId = await newVehicle({ insuranceExpiry: "2030-01-01" });
    const docId = await addDoc(vehicleId, "assurance", "2030-01-01");
    const res = await patch(docId, { expiryDate: "2035-05-05" }, "workshop_manager");
    expect(res.status).toBe(200);
    expect((await mirrorOf(vehicleId)).insurance).toBe("2035-05-05");
  });

  it("la visite technique suit sa propre colonne, sans toucher l'assurance", async () => {
    const vehicleId = await newVehicle({ insuranceExpiry: "2034-04-04" });
    const docId = await addDoc(vehicleId, "visite_technique", "2030-01-01");
    expect((await patch(docId, { expiryDate: "2036-06-06" }, "workshop_manager")).status).toBe(200);
    expect(await mirrorOf(vehicleId)).toEqual({ insurance: "2034-04-04", inspection: "2036-06-06" });
  });

  it("sans session 401, rôle non autorisé 403 : miroir intact", async () => {
    const vehicleId = await newVehicle({ insuranceExpiry: "2030-01-01" });
    const docId = await addDoc(vehicleId, "assurance", "2030-01-01");
    expect((await patch(docId, { expiryDate: "2040-01-01" })).status).toBe(401);
    expect((await patch(docId, { expiryDate: "2040-01-01" }, "technician")).status).toBe(403);
    expect((await mirrorOf(vehicleId)).insurance).toBe("2030-01-01");
  });

  it("date illisible : 400 lisible, ni document ni miroir modifiés", async () => {
    const vehicleId = await newVehicle({ insuranceExpiry: "2030-01-01" });
    const docId = await addDoc(vehicleId, "assurance", "2030-01-01");
    const res = await patch(docId, { expiryDate: "pas une date" }, "workshop_manager");
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/select|insert|update|stack/i);
    expect((await mirrorOf(vehicleId)).insurance).toBe("2030-01-01");
  });

  it("changement de nom seul : le miroir n'est pas réécrit", async () => {
    const vehicleId = await newVehicle({ insuranceExpiry: "2041-01-01" });
    const docId = await addDoc(vehicleId, "assurance", "2030-01-01");
    expect((await patch(docId, { name: "Assurance renommée" }, "workshop_manager")).status).toBe(200);
    expect((await mirrorOf(vehicleId)).insurance).toBe("2041-01-01");
  });

  it("type sans miroir : la date du document change, les colonnes du véhicule non", async () => {
    const vehicleId = await newVehicle({ insuranceExpiry: "2041-01-01" });
    const docId = await addDoc(vehicleId, "autre", "2030-01-01");
    expect((await patch(docId, { expiryDate: "2039-09-09" }, "workshop_manager")).status).toBe(200);
    expect((await mirrorOf(vehicleId)).insurance).toBe("2041-01-01");
  });

  it("document inconnu : 404", async () => {
    expect((await patch(2147483000, { expiryDate: "2040-01-01" }, "workshop_manager")).status).toBe(404);
  });

  it("double soumission : même résultat, idempotent", async () => {
    const vehicleId = await newVehicle({ insuranceExpiry: "2030-01-01" });
    const docId = await addDoc(vehicleId, "assurance", "2030-01-01");
    await patch(docId, { expiryDate: "2037-07-07" }, "workshop_manager");
    const second = await patch(docId, { expiryDate: "2037-07-07" }, "workshop_manager");
    expect(second.status).toBe(200);
    expect((await mirrorOf(vehicleId)).insurance).toBe("2037-07-07");
  });

  // Défaut connu : l'écriture est directe (mode "set"), sans garde « ne recule pas ».
  it.fails("corriger un document qui n'est pas le plus récent ne fait pas reculer le miroir", async () => {
    expect((await patch(stale.oldDoc, { expiryDate: "2031-01-01" }, "workshop_manager")).status).toBe(200);
    expect((await mirrorOf(stale.vehicleId)).insurance).toBe("2036-01-01");
  });
});
