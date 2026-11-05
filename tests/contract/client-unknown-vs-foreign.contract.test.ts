import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { vehicleDocuments } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Cloison client (AGENTS.md §11) : un client ne distingue pas un véhicule (ou un document) qui
 * appartient à un autre d'un identifiant qui n'existe pas. Même statut, même message, même code.
 * Complète le 403 des contrats existants sans le modifier ; le personnel garde le 404 pour l'absent.
 */
const ACTORS = { admin: "admin", client: "client" } as const;
type Actor = keyof typeof ACTORS;
const ids = createIdBag();
const token = uniqueTestToken("unk");
const uploadsDir = join(process.cwd(), "uploads", token);
const documentIds: number[] = [];
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
let foreignVehicle = 0;
let foreignDocument = 0;
const ABSENT = 2_000_000_000;

const VEHICLE_ROUTES: Array<[string, (id: number) => string]> = [
  ["véhicule par id", (id) => `/api/vehicles/${id}`],
  ["documents d'un véhicule par type", (id) => `/api/vehicles/${id}/documents/autre`],
  ["entretiens programmés du véhicule", (id) => `/api/maintenance-schedules/vehicle/${id}`],
  ["ordres de travail du véhicule", (id) => `/api/work-orders/vehicle/${id}`],
  ["pleins par ?vehicleId=", (id) => `/api/fuel-records?vehicleId=${id}`],
  ["historique de consommation", (id) => `/api/fuel-records/consumption-history?period=month&vehicleId=${id}`],
  ["kilométrage", (id) => `/api/vehicles/${id}/mileage`],
  ["pneus du véhicule", (id) => `/api/vehicles/${id}/tires`],
];

beforeAll(async () => {
  session = await startContractActors(ACTORS, ids.userIds);
  const v = await createTestVehicle({ registrationNumber: `${token}-foreign` });
  ids.vehicleIds.push(v.id);
  foreignVehicle = v.id;
  mkdirSync(uploadsDir, { recursive: true });
  const filePath = join(uploadsDir, "d.pdf");
  writeFileSync(filePath, "TEST");
  const [doc] = await db
    .insert(vehicleDocuments)
    .values({ vehicleId: v.id, name: "TEST doc", type: "autre", filename: "d.pdf", filesize: 4, fileType: "application/pdf", filePath })
    .returning();
  foreignDocument = doc.id;
  documentIds.push(doc.id);
}, 60000);

afterAll(async () => {
  try {
    if (documentIds.length > 0) {
      const { inArray } = await import("drizzle-orm");
      await db.delete(vehicleDocuments).where(inArray(vehicleDocuments.id, documentIds));
    }
    rmSync(uploadsDir, { recursive: true, force: true });
    await cleanupCreated(ids);
  } finally {
    await session?.close();
  }
}, 60000);

const shape = (res: { status: number; body: any }) => ({ status: res.status, message: res.body?.message, code: res.body?.code });

describe("un client ne distingue pas l'étranger de l'inexistant", { timeout: 60000 }, () => {
  for (const [label, path] of VEHICLE_ROUTES) {
    it(`${label} : véhicule d'un autre et véhicule absent donnent la même réponse 403`, async () => {
      const foreign = await session.call("GET", path(foreignVehicle), { actor: "client" });
      const absent = await session.call("GET", path(ABSENT), { actor: "client" });
      expect(foreign.status, path(foreignVehicle)).toBe(403);
      expect(shape(absent), path(ABSENT)).toEqual(shape(foreign));
    });
  }

  it("téléchargement de document : document d'un autre et document absent donnent la même réponse 403", async () => {
    const foreign = await session.call("GET", `/api/documents/${foreignDocument}/download`, { actor: "client" });
    const absent = await session.call("GET", `/api/documents/${ABSENT}/download`, { actor: "client" });
    expect(foreign.status).toBe(403);
    expect(shape(absent)).toEqual(shape(foreign));
  });

  it("GET /api/vehicles/:id : le message affiche par l'ecran (e2e 24) est fige, absent comme etranger", async () => {
    const foreign = await session.call("GET", `/api/vehicles/${foreignVehicle}`, { actor: "client" });
    const absent = await session.call("GET", `/api/vehicles/${ABSENT}`, { actor: "client" });
    expect(foreign.body?.message).toBe("Accès non autorisé à ce véhicule");
    expect(absent.body?.message).toBe("Accès non autorisé à ce véhicule");
  });

  it("le personnel garde le 404 pour un identifiant absent", async () => {
    expect((await session.call("GET", `/api/vehicles/${ABSENT}`, { actor: "admin" })).status).toBe(404);
    expect((await session.call("GET", `/api/documents/${ABSENT}/download`, { actor: "admin" })).status).toBe(404);
  });
});
