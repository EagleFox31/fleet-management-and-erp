import { afterEach, describe, expect, it } from "vitest";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import {
  createTestPart,
  createTestSupplier,
  createTestUser,
  createTestVehicle,
} from "../support/factories";

const ids = createIdBag();

afterEach(async () => {
  await cleanupCreated(ids);
  ids.userIds.length = 0;
  ids.partIds.length = 0;
  ids.vehicleIds.length = 0;
  ids.supplierIds.length = 0;
  ids.invoiceIds.length = 0;
  ids.fuelRecordIds.length = 0;
});

describe("factories + Postgres TEST", () => {
  it("insère et relit une pièce rattachée à un utilisateur", async () => {
    const user = await createTestUser({ role: "warehouse" });
    ids.userIds.push(user.id);

    const part = await createTestPart({
      createdBy: user.id,
      quantity: 4,
      unitPrice: "2500.00",
    });
    ids.partIds.push(part.id);

    expect(part.reference.startsWith("TEST-")).toBe(true);
    expect(part.quantity).toBe(4);
    expect(part.createdBy).toBe(user.id);
  });

  it("insère un véhicule avec immatriculation unique TEST-", async () => {
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);

    expect(vehicle.registrationNumber.startsWith("TEST-")).toBe(true);
    expect(vehicle.brand).toBe("Renault");
  });

  it("insère un fournisseur unique TEST-", async () => {
    const supplier = await createTestSupplier();
    ids.supplierIds.push(supplier.id);

    expect(supplier.name.startsWith("TEST-")).toBe(true);
    expect(supplier.isActive).toBe(true);
  });
});
