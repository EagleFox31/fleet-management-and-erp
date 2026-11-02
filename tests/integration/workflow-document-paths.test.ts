import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { DocumentManagementService, type DocumentData } from "../../server/services/document-management-service";
import { vehicleDocuments } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Activation d'un véhicule depuis le workflow : les `file_path` des documents
 * viennent du corps de la requête. Ils étaient vérifiés par `fs.access` sur
 * n'importe quel chemin du disque, puis enregistrés tels quels : un chemin hors
 * de `uploads/` devenait un document du véhicule (et la réponse révélait
 * l'existence du fichier).
 */

const ids = createIdBag();
const dir = join(process.cwd(), "uploads", uniqueTestToken("wfpaths"));

afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await cleanupCreated(ids);
});

function doc(filePath: string, name: string): DocumentData {
  return { name, type: "autre", filename: "piece.pdf", filesize: 1, file_type: "application/pdf", file_path: filePath };
}

async function vehicleId() {
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  return vehicle.id;
}

describe("documents du workflow : chemins bornés à uploads/", { timeout: 60000 }, () => {
  it("un chemin hors de uploads/ n'est jamais enregistré, même si le fichier existe", async () => {
    const id = await vehicleId();
    await DocumentManagementService.saveDocumentsToDatabase(id, [
      doc("package.json", "TEST relatif"),
      doc(join(process.cwd(), "package.json"), "TEST absolu"),
      doc("uploads/../package.json", "TEST remontée"),
    ]);
    const rows = await db.select().from(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, id));
    expect(rows).toEqual([]);
  });

  it("non-régression : un fichier téléversé sous uploads/ est enregistré", async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "piece.pdf"), "%PDF-1.4");
    const relativePath = `uploads/${dir.split(/[\\/]/).pop()}/piece.pdf`;
    const id = await vehicleId();
    await DocumentManagementService.saveDocumentsToDatabase(id, [doc(relativePath, "TEST valide")]);
    const rows = await db.select().from(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, id));
    expect(rows.map((r) => r.filePath)).toEqual([relativePath]);
  });
});
