import { describe, expect, it, vi } from "vitest";
import { canReadVehicleSubresources } from "../../../server/lib/vehicle-retired";

const client = { id: 7, role: "client" };

describe("canReadVehicleSubresources", () => {
  it("personnel : lit tout, sans lecture du véhicule", async () => {
    const load = vi.fn();
    expect(await canReadVehicleSubresources({ id: 1, role: "technician" }, load)).toBe(true);
    expect(load).not.toHaveBeenCalled();
  });

  it("client : son véhicule actif seulement", async () => {
    expect(await canReadVehicleSubresources(client, async () => ({ ownerId: 7, deletedAt: null }))).toBe(true);
    expect(await canReadVehicleSubresources(client, async () => ({ ownerId: 7, deletedAt: new Date() }))).toBe(false);
    expect(await canReadVehicleSubresources(client, async () => ({ ownerId: 8, deletedAt: null }))).toBe(false);
    expect(await canReadVehicleSubresources(client, async () => ({ ownerId: null, deletedAt: null }))).toBe(false);
    expect(await canReadVehicleSubresources(client, async () => undefined)).toBe(false);
  });

  it("sans utilisateur : refusé", async () => {
    expect(await canReadVehicleSubresources(undefined, async () => ({ ownerId: 7, deletedAt: null }))).toBe(false);
  });
});
