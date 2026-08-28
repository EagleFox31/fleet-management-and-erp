import { afterEach, describe, expect, it } from "vitest";
import { stockAlertsService } from "../../server/services/stock-alerts-service";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart, createTestUser } from "../support/factories";

const ids = createIdBag();

afterEach(async () => {
  await cleanupCreated(ids);
  ids.userIds.length = 0;
  ids.partIds.length = 0;
});

describe("StockAlertsService", () => {
  it("getInventoryValue reflète une pièce factory", async () => {
    const before = await stockAlertsService.getInventoryValue();
    const user = await createTestUser({ role: "warehouse" });
    ids.userIds.push(user.id);
    const part = await createTestPart({
      createdBy: user.id,
      quantity: 7,
      unitPrice: "100.00",
    });
    ids.partIds.push(part.id);

    const after = await stockAlertsService.getInventoryValue();
    expect(after.totalParts).toBe(before.totalParts + 1);
    expect(after.totalQuantity).toBe(before.totalQuantity + 7);
    expect(after.totalValue).toBeGreaterThanOrEqual(before.totalValue);
  });

  it("getReorderAlerts signale une pièce sous le seuil", async () => {
    const part = await createTestPart({
      quantity: 1,
      minQuantity: 10,
      unitPrice: "50.00",
    });
    ids.partIds.push(part.id);

    const result = await stockAlertsService.getReorderAlerts();
    expect(result.parts.some((row) => row.id === part.id)).toBe(true);
    const alert = result.parts.find((row) => row.id === part.id);
    expect(alert?.shortage).toBeGreaterThan(0);
  });

  it("getRealStock retourne la pièce factory", async () => {
    const part = await createTestPart({ quantity: 3 });
    ids.partIds.push(part.id);

    const result = await stockAlertsService.getRealStock(part.id);
    expect(result.partId).toBe(part.id);
    expect(result.realStock).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.movements)).toBe(true);
  });

  it("getWarehouseStatistics expose un solde de mouvements cohérent", async () => {
    const result = await stockAlertsService.getWarehouseStatistics();
    expect(result.movements.balance).toBe(result.movements.totalIn - result.movements.totalOut);
  });
});
