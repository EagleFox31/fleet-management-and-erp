import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../server/db", () => ({ db: {} }));
import { broadcastDriverEvent } from "../../../server/lib/driver-realtime";
import { redactDriverPersonalData } from "../../../server/lib/driver-scope";

const FORBIDDEN = ["cniNumber", "licenseNumber", "birthDate"];

afterEach(() => {
  delete (global as any).broadcastUpdate;
});

describe("broadcastDriverEvent : aucune donnee personnelle en scope broadcast", () => {
  it("ne transmet que l'identifiant et les extras fournis", () => {
    const spy = vi.fn();
    (global as any).broadcastUpdate = spy;
    broadcastDriverEvent("driver_updated", 7);
    broadcastDriverEvent("driver_cpc_updated", 7, { cpcDate: "2026-01-01" });
    broadcastDriverEvent("driver_cpc_statuses_synced", null, { result: { updated: 2 } });
    expect(spy).toHaveBeenCalledTimes(3);
    for (const [, event] of spy.mock.calls) {
      expect(event.scope).toEqual({ type: "broadcast" });
      const flat = JSON.stringify(event);
      for (const key of FORBIDDEN) expect(flat).not.toContain(key);
    }
    expect(spy.mock.calls[0][1].payload).toEqual({ driverId: 7 });
  });

  it("sans diffuseur global : no-op", () => {
    expect(() => broadcastDriverEvent("driver_created", 1)).not.toThrow();
  });
});

describe("redactDriverPersonalData : refus par defaut", () => {
  const row = { id: 1, userId: 5, cniNumber: "C", licenseNumber: "L", birthDate: "2000-01-01" };
  it("sans lecteur : version masquee", () => {
    const out: any = redactDriverPersonalData(row as any, undefined as any);
    for (const key of FORBIDDEN) expect(out).not.toHaveProperty(key);
  });
  it("gestionnaire : fiche complete ; autre personnel : masquee", () => {
    expect((redactDriverPersonalData(row as any, { id: 9, role: "logistics" } as any) as any).licenseNumber).toBe("L");
    expect(redactDriverPersonalData(row as any, { id: 9, role: "technician" } as any)).not.toHaveProperty("licenseNumber");
  });
});
