import * as XLSX from "xlsx";
import { afterEach, describe, expect, it } from "vitest";
import { excelExportService } from "../../server/services/excel-export-service";
import { partsService } from "../../server/services/parts-service";
import { stockAlertsService } from "../../server/services/stock-alerts-service";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart, createTestUser } from "../support/factories";

/**
 * Niveau I, PRT3 : cycle de l'alerte de stock bas.
 * - Sous le seuil (ou pile au seuil) : la pièce est dans la liste de réappro.
 * - Réappro au-dessus du seuil : elle en sort ; retrait sous le seuil : elle y entre.
 * - L'indicateur « Alerte CDE » de l'export d'inventaire suit le stock réel : il ne reste pas
 *   figé à la valeur de la création (une pièce réapprovisionnée restait en alerte dans l'export).
 */

const ids = createIdBag();

afterEach(async () => {
  await cleanupCreated(ids);
  ids.userIds.length = 0;
  ids.partIds.length = 0;
});

async function newPart(quantity: number, minQuantity: number) {
  const user = await createTestUser({ role: "warehouse" });
  ids.userIds.push(user.id);
  const part = await createTestPart({ createdBy: user.id, quantity, minQuantity });
  ids.partIds.push(part.id);
  return { part, userId: user.id };
}

async function inReorderList(partId: number) {
  const result = await stockAlertsService.getReorderAlerts();
  return result.parts.some((row) => row.id === partId);
}

async function exportedAlert(reference: string): Promise<string | undefined> {
  const buffer = await excelExportService.exportInventory();
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets["Inventaire"]);
  const row = rows.find((r) => r["Référence"] === reference);
  return row?.["Alerte CDE"] as string | undefined;
}

describe("PRT3 alerte de stock bas", { timeout: 120000 }, () => {
  it("sous le seuil : alerte ; réappro au-dessus du seuil : alerte levée (liste de réappro)", async () => {
    const { part, userId } = await newPart(2, 5);
    expect(await inReorderList(part.id)).toBe(true);

    await partsService.updateStock(part.id, 10, "TEST réappro", userId);
    expect(await inReorderList(part.id)).toBe(false);
  });

  it("retrait sous le seuil : l'alerte apparaît", async () => {
    const { part, userId } = await newPart(20, 5);
    expect(await inReorderList(part.id)).toBe(false);

    await partsService.updateStock(part.id, -16, "TEST sortie", userId);
    expect(await inReorderList(part.id)).toBe(true);
  });

  // Régression : l'export lisait `parts.reorder_alert`, que `updateStock` ne recalculait pas.
  it("export d'inventaire : « Alerte CDE » suit le stock après une sortie", async () => {
    const { part, userId } = await newPart(20, 5);
    await partsService.updateStock(part.id, -16, "TEST sortie", userId);
    expect(await exportedAlert(part.reference)).toBe("OUI");
  });

  it("pile au seuil : en alerte ; un seul de plus : levée", async () => {
    const { part, userId } = await newPart(5, 5);
    expect(await inReorderList(part.id)).toBe(true);

    await partsService.updateStock(part.id, 1, "TEST réappro d'une unité", userId);
    expect(await inReorderList(part.id)).toBe(false);
  });

  it("réappro insuffisante : l'alerte reste, le manque se réduit", async () => {
    const { part, userId } = await newPart(1, 10);
    const before = (await stockAlertsService.getReorderAlerts()).parts.find((r) => r.id === part.id);
    expect(before?.shortage).toBe(9);

    await partsService.updateStock(part.id, 4, "TEST réappro partielle", userId);
    const after = (await stockAlertsService.getReorderAlerts()).parts.find((r) => r.id === part.id);
    expect(after?.shortage).toBe(5);
  });
});
