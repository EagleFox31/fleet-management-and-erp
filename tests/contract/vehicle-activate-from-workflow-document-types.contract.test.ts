import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { UNKNOWN_VEHICLE_DOCUMENT_TYPE_MESSAGE } from "../../server/lib/vehicle-document-type";
import { statusHistory, vehicleDocuments, vehicleDocumentTypes, vehicles, workOrders } from "../../shared/schema";
import { leakText } from "../support/api-error";
import { startContractSession } from "../support/contract-session";
import { uniqueTestToken } from "../support/ids";

/**
 * POST /api/vehicles/activate-from-workflow et le référentiel `vehicle_document_types`.
 *
 * Les types de document sont vérifiés AVANT la création du véhicule : un type inconnu ou
 * inactif répond 400 lisible, sans véhicule orphelin. Avant ce correctif, le véhicule était
 * créé, puis le refus du type tombait dans un catch qui répondait 500 « Erreur serveur ».
 */

type Actor = "chef";
let session: Awaited<ReturnType<typeof startContractSession<Actor>>>;
const createdVehicleIds: number[] = [];
const files: string[] = [];

function vehicleData(plate: string) {
  return { registrationNumber: plate, brand: "TESTMarque", model: "TESTModele", year: 2024, mileage: 0, vehicleType: "porteur", status: "operational" };
}

/** Fichier réel sous uploads/ : un document dont le fichier manque est ignoré, le test ne prouverait rien. */
function uploadedFile(label: string): { relative: string; filename: string } {
  const filename = `${uniqueTestToken(label)}.pdf`;
  mkdirSync(join(process.cwd(), "uploads"), { recursive: true });
  const absolute = join(process.cwd(), "uploads", filename);
  writeFileSync(absolute, "TEST");
  files.push(absolute);
  return { relative: `uploads/${filename}`, filename };
}

async function vehicleByPlate(plate: string) {
  const rows = await db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.registrationNumber, plate));
  createdVehicleIds.push(...rows.map((row) => row.id));
  return rows;
}

beforeAll(async () => {
  session = await startContractSession<Actor>({ chef: "workshop_manager" });
});

afterAll(async () => {
  for (const file of files) rmSync(file, { force: true });
  // vehicle_documents et status_history suivent le véhicule (ON DELETE CASCADE) ; l'OT de maintenance programmée est retiré avant.
  if (createdVehicleIds.length > 0) {
    await db.delete(workOrders).where(inArray(workOrders.vehicleId, createdVehicleIds));
    await db.delete(vehicles).where(inArray(vehicles.id, createdVehicleIds));
  }
  await session?.stop();
});

describe("POST /api/vehicles/activate-from-workflow : types de document", { timeout: 60000 }, () => {
  it("type inconnu : 400 lisible, aucun véhicule créé", async () => {
    const plate = uniqueTestToken("TSTA");
    const file = uploadedFile("activate-inconnu");
    const res = await session.call("POST", "/api/vehicles/activate-from-workflow", {
      body: {
        vehicleData: vehicleData(plate),
        workflowData: {
          documents: [{ name: "TEST inconnu", type: "zz_inconnu", filename: file.filename, filesize: 4, file_type: "application/pdf", file_path: file.relative }],
        },
      },
    });
    // Lu avant toute assertion : un véhicule orphelin est retrouvé et nettoyé même si le statut échoue.
    const orphans = await vehicleByPlate(plate);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(UNKNOWN_VEHICLE_DOCUMENT_TYPE_MESSAGE);
    expect(leakText(res.body)).not.toMatch(/violates|foreign key|constraint|select |insert |at .+\.ts|Error:/i);
    expect(orphans).toHaveLength(0);
  });

  it("type du référentiel désactivé (document d'activation) : 400 lisible, aucun véhicule créé", async () => {
    const plate = uniqueTestToken("TSTA");
    const file = uploadedFile("activate-inactif");
    const [before] = await db.select({ active: vehicleDocumentTypes.active }).from(vehicleDocumentTypes).where(eq(vehicleDocumentTypes.code, "visite_technique"));
    expect(before).toBeDefined();
    await db.update(vehicleDocumentTypes).set({ active: false }).where(eq(vehicleDocumentTypes.code, "visite_technique"));
    try {
      const res = await session.call("POST", "/api/vehicles/activate-from-workflow", {
        body: {
          vehicleData: vehicleData(plate),
          workflowData: { documents: { visiteTechnique: { name: "TEST visite", filename: file.filename, file_path: file.relative } } },
        },
      });
      const orphans = await vehicleByPlate(plate);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(UNKNOWN_VEHICLE_DOCUMENT_TYPE_MESSAGE);
      expect(orphans).toHaveLength(0);
    } finally {
      await db.update(vehicleDocumentTypes).set({ active: before.active }).where(eq(vehicleDocumentTypes.code, "visite_technique"));
    }
  });

  it("chemin nominal : alias historique normalisé, véhicule et documents créés", async () => {
    const plate = uniqueTestToken("TSTA");
    const insurance = uploadedFile("activate-assurance");
    const registration = uploadedFile("activate-carte");
    const res = await session.call("POST", "/api/vehicles/activate-from-workflow", {
      body: {
        vehicleData: vehicleData(plate),
        workflowData: {
          // Lu par DocumentManagementService (alias « insurance ») ; la carte grise, par VehicleActivationService.
          documents: [{ name: "TEST assurance", type: "insurance", filename: insurance.filename, filesize: 4, file_type: "application/pdf", file_path: insurance.relative }],
        },
      },
    });
    expect(res.status).toBe(201);
    const [created] = await vehicleByPlate(plate);
    expect(created).toBeDefined();
    const docs = await db.select({ type: vehicleDocuments.type, filename: vehicleDocuments.filename }).from(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, created.id));
    expect(docs).toEqual([{ type: "assurance", filename: insurance.filename }]);

    const plate2 = uniqueTestToken("TSTA");
    const res2 = await session.call("POST", "/api/vehicles/activate-from-workflow", {
      body: {
        vehicleData: vehicleData(plate2),
        workflowData: { documents: { carteGrise: { name: "TEST carte", filename: registration.filename, file_path: registration.relative } } },
      },
    });
    expect(res2.status).toBe(201);
    const [created2] = await vehicleByPlate(plate2);
    const docs2 = await db.select({ type: vehicleDocuments.type }).from(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, created2.id));
    expect(docs2).toEqual([{ type: "carte_grise" }]);
  });
});

describe("POST /api/vehicles/activate-from-workflow : workflowData vérifié avant la création", { timeout: 60000 }, () => {
  async function activate(plate: string, workflowData: unknown) {
    const res = await session.call("POST", "/api/vehicles/activate-from-workflow", {
      body: workflowData === undefined ? { vehicleData: vehicleData(plate) } : { vehicleData: vehicleData(plate), workflowData },
    });
    // Lu avant toute assertion : un véhicule orphelin est retrouvé et nettoyé même si le statut échoue.
    return { res, rows: await vehicleByPlate(plate) };
  }

  it("corps sans workflowData : 400 normalisée avec erreurs de champ, aucun véhicule créé", async () => {
    const { res, rows } = await activate(uniqueTestToken("TSTA"), undefined);
    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.errors) && res.body.errors.length).toBeGreaterThan(0);
    expect(leakText(res.body)).not.toMatch(/TypeError|Cannot read|undefined \(reading|at .+\.ts/i);
    expect(rows).toHaveLength(0);
  });

  it("filesize non numérique : 400, aucun véhicule créé", async () => {
    const file = uploadedFile("activate-taille");
    const { res, rows } = await activate(uniqueTestToken("TSTA"), {
      documents: [{ name: "TEST taille", type: "assurance", filename: file.filename, filesize: "abc", file_type: "application/pdf", file_path: file.relative }],
    });
    expect(res.status).toBe(400);
    expect(res.body.errors?.[0]?.field).toMatch(/^documents/);
    expect(rows).toHaveLength(0);
  });

  it("corps réel du client (tout l'état du workflow, fichiers sérialisés vides) : 201", async () => {
    const plate = uniqueTestToken("TSTA");
    const { res, rows } = await activate(plate, {
      ...vehicleData(plate),
      vin: "",
      purchaseDate: "",
      licensePlateExpiry: "",
      insuranceExpiry: "",
      technicalInspectionDate: "",
      notes: "",
      vinValidated: false,
      vinValidationResult: null,
      sessionId: "",
      documents: { carteGrise: {}, assurance: {}, visiteTechnique: null, facturAchat: {} },
      documentsUploaded: true,
      maintenanceScheduled: false,
      firstMaintenanceDate: "",
      maintenanceType: "preventive",
      nextMaintenanceDate: "",
      nextMaintenanceMileage: 0,
      activated: false,
    });
    expect(res.status).toBe(201);
    expect(rows).toHaveLength(1);
  });

  it.each([
    ["status hors énumération", { status: "detruit" }, "status"],
    ["status non textuel", { status: 3 }, "status"],
    ["kilométrage négatif", { nextMaintenanceMileage: -1 }, "nextMaintenanceMileage"],
    ["kilométrage décimal", { nextMaintenanceMileage: 1500.5 }, "nextMaintenanceMileage"],
    ["kilométrage au-delà de la borne", { nextMaintenanceMileage: 10_000_001 }, "nextMaintenanceMileage"],
    ["kilométrage non numérique", { nextMaintenanceMileage: "beaucoup" }, "nextMaintenanceMileage"],
    ["date de maintenance illisible", { nextMaintenanceDate: "bientot" }, "nextMaintenanceDate"],
    ["date de maintenance au format français", { firstMaintenanceDate: "15/01/2027" }, "firstMaintenanceDate"],
    ["date de maintenance hors plage", { firstMaintenanceDate: "1890-01-01" }, "firstMaintenanceDate"],
  ])("%s : 400 sur le champ, aucun véhicule créé", async (_label, workflowData, field) => {
    const { res, rows } = await activate(uniqueTestToken("TSTA"), workflowData);
    expect(res.status).toBe(400);
    expect(res.body.errors?.map((e: { field?: string }) => e.field)).toContain(field);
    expect(rows).toHaveLength(0);
  });

  it("status, date et kilométrage valides : écrits sur l'historique et la fiche véhicule", async () => {
    const { res, rows } = await activate(uniqueTestToken("TSTA"), {
      status: "maintenance",
      maintenanceScheduled: true,
      // Horodatage ISO d'un brouillon restauré : ramené au jour ; kilométrage saisi en texte : converti.
      firstMaintenanceDate: "2027-01-15T00:00:00.000Z",
      nextMaintenanceMileage: "15000",
    });
    expect(res.status).toBe(201);
    expect(rows).toHaveLength(1);
    // La création du véhicule écrit aussi sa ligne (statut de vehicleData) : on cherche celle de l'activation.
    const history = await db.select({ status: statusHistory.status }).from(statusHistory).where(eq(statusHistory.vehicleId, rows[0].id));
    expect(history.map((h) => h.status)).toContain("maintenance");
    const [vehicle] = await db
      .select({ date: vehicles.nextMaintenanceDate, mileage: vehicles.nextMaintenanceMileage })
      .from(vehicles)
      .where(eq(vehicles.id, rows[0].id));
    expect(String(vehicle.date).slice(0, 10)).toBe("2027-01-15");
    expect(vehicle.mileage).toBe(15000);
    const planned = await db.select({ id: workOrders.id }).from(workOrders).where(eq(workOrders.vehicleId, rows[0].id));
    expect(planned).toHaveLength(1);
  });

  it.each([
    ["document d'activation (documents.carteGrise)", (p: string) => ({ documents: { carteGrise: { name: "TEST evasion", filename: "package.json", file_path: p } } })],
    ["document de liste (documents[])", (p: string) => ({ documents: [{ name: "TEST evasion", type: "assurance", filename: "package.json", filesize: 1, file_type: "application/json", file_path: p }] })],
  ])("%s avec file_path hors de uploads/ : véhicule créé, aucun document rattaché", async (_label, body) => {
    // Remonte hors de uploads/ vers un fichier qui existe (package.json du dépôt) : sans le contrôle, il serait rattaché.
    const { res, rows } = await activate(uniqueTestToken("TSTA"), body("uploads/../package.json"));
    expect(res.status).toBe(201);
    expect(rows).toHaveLength(1);
    const docs = await db.select({ filePath: vehicleDocuments.filePath }).from(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, rows[0].id));
    expect(docs).toEqual([]);
  });
});
