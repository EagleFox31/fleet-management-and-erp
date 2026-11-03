import { createServer, type Server } from "http";
import fs from "fs";
import path from "path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { activityLogs, vehicleDocuments, vehicleDocumentTypes, vehicles } from "../../shared/schema";
import { db } from "../../server/db";
import * as mirrorLib from "../../server/lib/vehicle-document-mirror";
import { syncVehicleDocumentMirror } from "../../server/lib/vehicle-document-mirror";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { VEHICLE_DOCUMENT_EVENT_ROLES } from "../../shared/constants/roles";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";

/** Niveau C, T-16b : upload d'un document vehicule (route deplacee dans server/api) et type valide. */
let server: Server;
let baseUrl = "";
let vehicleId = 0;
const ids = createIdBag();
const cookies = new Map<string, string>();
const INACTIVE = `zz_inactif_${Date.now().toString(36)}`;
const vehicleDir = () => path.join("./uploads/documents", `vehicle-${vehicleId}`);
// Le dépôt versionne des `.gitkeep` dans certains `uploads/documents/vehicle-<id>/` : selon la
// séquence de la base, l'id du véhicule de test peut tomber dessus. Ils ne comptent pas et
// ne doivent pas être supprimés.
const filesOnDisk = () => (fs.existsSync(vehicleDir()) ? fs.readdirSync(vehicleDir()).filter((f) => f !== ".gitkeep") : []);

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

async function upload(fields: Record<string, string>, role?: string, mime = "application/pdf") {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append("document", new Blob(["%PDF-1.4 test"], { type: mime }), "doc-test.pdf");
  const res = await fetch(`${baseUrl}/api/vehicles/${vehicleId}/documents`, {
    method: "POST",
    headers: role ? { Cookie: cookies.get(role)! } : {},
    body: form,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  await login("workshop_manager");
  await login("technician");
  await login("client");
  await login("driver");
  const vehicle = await createTestVehicle();
  vehicleId = vehicle.id;
  ids.vehicleIds.push(vehicle.id);
  await db.insert(vehicleDocumentTypes).values({ code: INACTIVE, label: "Inactif de test", validityMonths: null, alertDays: 30, active: false, sortOrder: 900 });
}, 120000);

afterAll(async () => {
  await db.delete(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, vehicleId));
  await db.delete(vehicleDocumentTypes).where(eq(vehicleDocumentTypes.code, INACTIVE));
  for (const f of filesOnDisk()) fs.rmSync(path.join(vehicleDir(), f), { recursive: true, force: true });
  if (fs.existsSync(vehicleDir()) && fs.readdirSync(vehicleDir()).length === 0) fs.rmdirSync(vehicleDir());
  // L'intercepteur d'audit journalise l'ecriture sur le vehicule : ces lignes bloquent la suppression des utilisateurs.
  if (ids.userIds.length) await db.delete(activityLogs).where(inArray(activityLogs.userId, ids.userIds));
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/vehicles/:vehicleId/documents", { timeout: 120000 }, () => {
  it("refuse sans session (401) et un role non autorise (403), sans rien stocker", async () => {
    expect((await upload({ name: "n", type: "carte_grise" })).status).toBe(401);
    expect((await upload({ name: "n", type: "carte_grise" }, "technician")).status).toBe(403);
    expect((await upload({ name: "n", type: "carte_grise" }, "client")).status).toBe(403);
    expect((await upload({ name: "n", type: "carte_grise" }, "driver")).status).toBe(403);
    expect(filesOnDisk()).toEqual([]);
  });

  it("enregistre un document de type actif (201) et conserve le fichier", async () => {
    const res = await upload({ name: "Carte grise", type: "carte_grise", description: "d" }, "workshop_manager");
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ vehicleId, name: "Carte grise", type: "carte_grise", filename: "doc-test.pdf" });
    expect(filesOnDisk()).toHaveLength(1);
  });

  it("P3-2 : le depot d'un document neuf met a jour la colonne miroir de vehicles", async () => {
    const cases = [
      ["assurance", "insuranceExpiry", "2031-05-01"],
      ["visite_technique", "technicalInspectionDate", "2031-06-02"],
      ["carte_grise", "licensePlateExpiry", "2031-07-03"],
    ] as const;
    for (const [type, column, date] of cases) {
      const res = await upload({ name: `Miroir ${type}`, type, expiryDate: date }, "workshop_manager");
      expect(res.status).toBe(201);
      const [row] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
      expect(String(row[column])).toContain(date);
    }
  });

  it("P3-2 : le depot d'un document plus ancien ne fait pas reculer le miroir", async () => {
    const [before] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
    const res = await upload({ name: "Ancienne assurance", type: "assurance", expiryDate: "2020-01-01" }, "workshop_manager");
    expect(res.status).toBe(201);
    const [after] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
    expect(String(after.insuranceExpiry)).toBe(String(before.insuranceExpiry));
    const later = await upload({ name: "Assurance renouvelee", type: "assurance", expiryDate: "2032-01-01" }, "workshop_manager");
    expect(later.status).toBe(201);
    const [advanced] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
    expect(String(advanced.insuranceExpiry)).toContain("2032-01-01");
  });

  it("P3-2 : la lib du miroir (mode set) fait comme le PATCH /api/documents/:id de routes.ts, alias compris", async () => {
    const cases = [
      ["insurance", "insuranceExpiry"],
      ["inspection", "technicalInspectionDate"],
      ["license", "licensePlateExpiry"],
      ["technical_inspection", "technicalInspectionDate"],
      ["registration_card", "licensePlateExpiry"],
      ["assurance", "insuranceExpiry"],
    ] as const;
    for (const [type, column] of cases) {
      const [doc] = await db
        .insert(vehicleDocuments)
        .values({ vehicleId, name: `TEST alias ${type}`, type, filename: "x.pdf", filesize: 1, fileType: "application/pdf", filePath: "uploads/x.pdf" })
        .returning();
      await db.update(vehicles).set({ [column]: "2040-01-01" }).where(eq(vehicles.id, vehicleId));
      const patch = await fetch(`${baseUrl}/api/documents/${doc.id}`, {
        method: "PATCH",
        headers: { Cookie: cookies.get("workshop_manager")!, "Content-Type": "application/json" },
        body: JSON.stringify({ expiryDate: "2033-03-03" }),
      });
      expect(patch.status).toBe(200);
      const [viaPatch] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId));

      await db.update(vehicles).set({ [column]: "2040-01-01" }).where(eq(vehicles.id, vehicleId));
      await syncVehicleDocumentMirror(vehicleId, type, "2033-03-03", "set");
      const [viaLib] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId));

      expect(String(viaLib[column])).toBe(String(viaPatch[column]));
      expect(String(viaLib[column])).toContain("2033-03-03");
    }
  });

  it("refuse un type inconnu ou inactif (400 lisible) et supprime le fichier", async () => {
    const before = filesOnDisk().length;
    for (const type of ["zz_inconnu", INACTIVE]) {
      const res = await upload({ name: "n", type }, "workshop_manager");
      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Type de document inconnu ou inactif.");
    }
    expect(filesOnDisk()).toHaveLength(before);
  });

  it("garde les anciens refus : champs manquants et mime non supporte", async () => {
    const before = filesOnDisk().length;
    expect((await upload({ type: "carte_grise" }, "workshop_manager")).status).toBe(400);
    expect((await upload({ name: "n", type: "carte_grise" }, "workshop_manager", "text/plain")).status).toBe(400);
    expect(filesOnDisk()).toHaveLength(before);
  });
  it("P3-2 : si la synchro du miroir echoue, 500 lisible, aucune ligne document et fichier supprime", async () => {
    const rowsBefore = await db.select().from(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, vehicleId));
    const filesBefore = filesOnDisk().length;
    vi.spyOn(mirrorLib, "syncVehicleDocumentMirror").mockRejectedValueOnce(new Error("SQL secret: relation vehicles"));
    const res = await upload({ name: "Echec miroir", type: "assurance", expiryDate: "2035-01-01" }, "workshop_manager");
    expect(res.status).toBe(500);
    expect(res.body.message).toContain("Une erreur technique est survenue");
    expect(res.body.message).toContain(`Référence : ${res.body.requestId}`);
    expect(res.body.code).toBeTruthy();
    expect(res.body.requestId).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(/SQL|secret|relation|stack/i);
    const rowsAfter = await db.select().from(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, vehicleId));
    expect(rowsAfter).toHaveLength(rowsBefore.length);
    expect(rowsAfter.some((r) => r.name === "Echec miroir")).toBe(false);
    expect(filesOnDisk()).toHaveLength(filesBefore);
  });

  it("P3-2 : le depot emet vehicle_document_updated, et vehicle_updated seulement si le miroir avance", async () => {
    const spy = vi.fn();
    const previous = (global as any).broadcastUpdate;
    (global as any).broadcastUpdate = spy;
    try {
      const types = () => spy.mock.calls.map((c) => c[0]);
      await db.update(vehicles).set({ insuranceExpiry: "2040-01-01" }).where(eq(vehicles.id, vehicleId));
      const older = await upload({ name: "Assurance ancienne", type: "assurance", expiryDate: "2030-01-01" }, "workshop_manager");
      expect(older.status).toBe(201);
      expect(types()).toEqual(["vehicle_document_updated"]);
      spy.mockClear();
      const newer = await upload({ name: "Assurance recente", type: "assurance", expiryDate: "2041-01-01" }, "workshop_manager");
      expect(newer.status).toBe(201);
      expect(types()).toEqual(["vehicle_document_updated", "vehicle_updated"]);
    } finally {
      (global as any).broadcastUpdate = previous;
    }
  });

  it("P3-2 : un second depot a la meme echeance n'ecrit rien sur vehicles.* et n'emet pas vehicle_updated", async () => {
    const first = await upload({ name: "Carte grise a", type: "carte_grise", expiryDate: "2047-08-09" }, "workshop_manager");
    expect(first.status).toBe(201);
    const [before] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
    const spy = vi.fn();
    const previous = (global as any).broadcastUpdate;
    (global as any).broadcastUpdate = spy;
    try {
      const second = await upload({ name: "Carte grise b", type: "carte_grise", expiryDate: "2047-08-09" }, "workshop_manager");
      expect(second.status).toBe(201);
      expect(spy.mock.calls.map((c) => c[0])).toEqual(["vehicle_document_updated"]);
    } finally {
      (global as any).broadcastUpdate = previous;
    }
    const [after] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
    expect(after).toEqual(before);
  });

  it("P3-2 R1 : les evenements du depot sont limites au personnel (jamais broadcast, ni client ni chauffeur)", async () => {
    const spy = vi.fn();
    const previous = (global as any).broadcastUpdate;
    (global as any).broadcastUpdate = spy;
    try {
      await db.update(vehicles).set({ insuranceExpiry: "2042-01-01" }).where(eq(vehicles.id, vehicleId));
      const res = await upload({ name: "Assurance cloison", type: "assurance", expiryDate: "2043-01-01" }, "workshop_manager");
      expect(res.status).toBe(201);
      expect(spy.mock.calls.map((c) => c[0])).toEqual(["vehicle_document_updated", "vehicle_updated"]);
      for (const [, data] of spy.mock.calls) {
        expect(data.scope.type).toBe("roles");
        expect([...data.scope.roles].sort()).toEqual([...VEHICLE_DOCUMENT_EVENT_ROLES].sort());
        expect(data.scope.roles).not.toContain("client");
        expect(data.scope.roles).not.toContain("driver");
      }
    } finally {
      (global as any).broadcastUpdate = previous;
    }
  });

  it("P3-2 : une date d'echeance illisible est refusee en 400 lisible, sans fichier conserve", async () => {
    const before = filesOnDisk().length;
    for (const expiryDate of ["pas-une-date", "2031-02-31", "31/12/2031"]) {
      const res = await upload({ name: "Date illisible", type: "assurance", expiryDate }, "workshop_manager");
      expect(res.status).toBe(400);
      expect(res.body.message).toBe("La date d'échéance est invalide (format attendu : AAAA-MM-JJ).");
    }
    expect(filesOnDisk()).toHaveLength(before);
  });

  it("P3-2 R2 : supprimer le document saisi par erreur (2062) ramene le miroir a l'echeance restante et previent le personnel", async () => {
    const del = (id: number, role = "workshop_manager") =>
      fetch(`${baseUrl}/api/documents/${id}`, { method: "DELETE", headers: { Cookie: cookies.get(role)! } });
    const mirror = async () => String((await db.select().from(vehicles).where(eq(vehicles.id, vehicleId)))[0].technicalInspectionDate);
    const kept = await upload({ name: "Visite valide", type: "visite_technique", expiryDate: "2050-03-04" }, "workshop_manager");
    expect(kept.status).toBe(201);
    const wrong = await upload({ name: "Visite saisie par erreur", type: "visite_technique", expiryDate: "2062-01-01" }, "workshop_manager");
    expect(wrong.status).toBe(201);
    expect(await mirror()).toContain("2062-01-01");

    expect((await del(wrong.body.id, "technician")).status).toBe(403);
    expect((await del(wrong.body.id, "client")).status).toBe(403);
    expect(await mirror()).toContain("2062-01-01");

    const spy = vi.fn();
    const previous = (global as any).broadcastUpdate;
    (global as any).broadcastUpdate = spy;
    try {
      expect((await del(wrong.body.id)).status).toBe(204);
    } finally {
      (global as any).broadcastUpdate = previous;
    }
    expect(await mirror()).toContain("2050-03-04");
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const [type, data] of spy.mock.calls) {
      expect(type).toBe("vehicle_updated");
      expect(data.scope.type).toBe("roles");
      expect(data.scope.roles).not.toContain("client");
    }
    expect((await del(wrong.body.id)).status).toBe(404);
  });

  it("P3-2 R2 : sans autre document date du type, le miroir (saisie directe) n'est pas ecrase", async () => {
    await db.update(vehicles).set({ licensePlateExpiry: "2061-01-01" }).where(eq(vehicles.id, vehicleId));
    await db.delete(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, vehicleId));
    const [doc] = await db
      .insert(vehicleDocuments)
      .values({ vehicleId, name: "TEST carte seule", type: "carte_grise", filename: "x.pdf", filesize: 1, fileType: "application/pdf", filePath: "uploads/x.pdf", expiryDate: "2061-01-01" })
      .returning();
    const res = await fetch(`${baseUrl}/api/documents/${doc.id}`, { method: "DELETE", headers: { Cookie: cookies.get("workshop_manager")! } });
    expect(res.status).toBe(204);
    const [row] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
    expect(String(row.licensePlateExpiry)).toContain("2061-01-01");
  });

  it("P3-2 R2 : supprimer un document qui ne fixait pas le miroir n'y touche pas (saisie directe plus lointaine)", async () => {
    await db.delete(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, vehicleId));
    await db.update(vehicles).set({ insuranceExpiry: "2060-06-30" }).where(eq(vehicles.id, vehicleId));
    const base = { vehicleId, type: "assurance", filename: "x.pdf", filesize: 1, fileType: "application/pdf", filePath: "uploads/x.pdf" };
    const [older] = await db.insert(vehicleDocuments).values({ ...base, name: "TEST assurance 2045", expiryDate: "2045-01-01" }).returning();
    await db.insert(vehicleDocuments).values({ ...base, name: "TEST assurance 2046", expiryDate: "2046-01-01" });
    const res = await fetch(`${baseUrl}/api/documents/${older.id}`, { method: "DELETE", headers: { Cookie: cookies.get("workshop_manager")! } });
    expect(res.status).toBe(204);
    const [row] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
    expect(String(row.insuranceExpiry)).toContain("2060-06-30");
  });

  it("P3-2 R2 : si le recalcul du miroir echoue apres la suppression, la reponse reste 204 (la suppression a eu lieu)", async () => {
    const [doc] = await db
      .insert(vehicleDocuments)
      .values({ vehicleId, name: "TEST recalcul en echec", type: "assurance", filename: "x.pdf", filesize: 1, fileType: "application/pdf", filePath: "uploads/x.pdf", expiryDate: "2044-01-01" })
      .returning();
    vi.spyOn(mirrorLib, "recomputeVehicleDocumentMirror").mockRejectedValueOnce(new Error("SQL secret"));
    const res = await fetch(`${baseUrl}/api/documents/${doc.id}`, { method: "DELETE", headers: { Cookie: cookies.get("workshop_manager")! } });
    expect(res.status).toBe(204);
    expect(await db.select().from(vehicleDocuments).where(eq(vehicleDocuments.id, doc.id))).toHaveLength(0);
  });
});
