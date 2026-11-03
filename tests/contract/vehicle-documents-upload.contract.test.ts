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
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";

/** Niveau C, T-16b : upload d'un document vehicule (route deplacee dans server/api) et type valide. */
let server: Server;
let baseUrl = "";
let vehicleId = 0;
const ids = createIdBag();
const cookies = new Map<string, string>();
const INACTIVE = `zz_inactif_${Date.now().toString(36)}`;
const vehicleDir = () => path.join("./uploads/documents", `vehicle-${vehicleId}`);
const filesOnDisk = () => (fs.existsSync(vehicleDir()) ? fs.readdirSync(vehicleDir()) : []);

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
  const vehicle = await createTestVehicle();
  vehicleId = vehicle.id;
  ids.vehicleIds.push(vehicle.id);
  await db.insert(vehicleDocumentTypes).values({ code: INACTIVE, label: "Inactif de test", validityMonths: null, alertDays: 30, active: false, sortOrder: 900 });
}, 120000);

afterAll(async () => {
  await db.delete(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, vehicleId));
  await db.delete(vehicleDocumentTypes).where(eq(vehicleDocumentTypes.code, INACTIVE));
  fs.rmSync(vehicleDir(), { recursive: true, force: true });
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
});
