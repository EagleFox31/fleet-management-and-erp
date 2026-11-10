import { describe, expect, it } from "vitest";
import { REALTIME_EVENTS } from "@shared/contracts/realtime-events";
import {
  INCIDENT_FORBIDDEN_MESSAGE,
  INCIDENT_OUT_OF_SCOPE_MESSAGE,
  INCIDENT_READ_FORBIDDEN_MESSAGE,
  createIncident,
  incidentScopeError,
  listIncidents,
  type IncidentDeps,
} from "../../../server/services/incident-service";

describe("incidentScopeError", () => {
  it("chauffeur : oui sur son véhicule, 403 ailleurs", () => {
    expect(incidentScopeError({ id: 5, role: "driver" }, 10, [10, 11])).toBeNull();
    const err = incidentScopeError({ id: 5, role: "driver" }, 12, [10, 11]);
    expect(err?.status).toBe(403);
    expect(err?.message).toBe(INCIDENT_OUT_OF_SCOPE_MESSAGE);
    expect(incidentScopeError({ id: 5, role: "driver" }, 10, [])?.status).toBe(403);
  });
  it("client : 403", () => {
    const err = incidentScopeError({ id: 9, role: "client" }, 10, [10]);
    expect(err?.status).toBe(403);
    expect(err?.message).toBe(INCIDENT_FORBIDDEN_MESSAGE);
  });
  it("personnel : tout véhicule ; anonyme : 401", () => {
    for (const role of ["admin", "workshop_manager", "technician", "secretary"]) {
      expect(incidentScopeError({ id: 1, role }, 99, [])).toBeNull();
    }
    expect(incidentScopeError(undefined, 1, [])?.status).toBe(401);
  });
});

function makeDeps(assigned: number[], vehicles: { registrationNumber: string }[] = [{ registrationNumber: "AB-123-CD" }]) {
  const calls = { inserted: [] as any[], notified: [] as any[], events: [] as any[] };
  const deps: IncidentDeps = {
    now: () => new Date("2026-11-02T08:00:00Z"),
    assignedVehicleIds: async () => assigned,
    notifyRoles: async (p) => {
      calls.notified.push(p);
    },
    broadcast: (event, data) => {
      calls.events.push({ event, data });
    },
    db: {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => vehicles }) }) }),
      transaction: async (fn: (tx: any) => Promise<any>) =>
        fn({
          insert: () => ({
            values: (v: any) => {
              calls.inserted.push(v);
              return { returning: async () => [{ id: 7, workOrderId: null, ...v }] };
            },
          }),
        }),
    },
  };
  return { deps, calls };
}

describe("createIncident", () => {
  it("chauffeur sur son véhicule : insertion avec audit, alerte puis événement", async () => {
    const { deps, calls } = makeDeps([10]);
    const out = await createIncident({ id: 5, role: "driver" }, { vehicleId: 10, description: "Fuite d'huile", severity: "high" }, deps);
    expect(out).toMatchObject({ id: 7, vehicleId: 10, vehicleRegistration: "AB-123-CD", reportedBy: 5, status: "open", severity: "high" });
    expect(calls.inserted[0]).toMatchObject({ createdBy: 5, updatedBy: 5, reportedBy: 5 });
    expect(calls.notified[0]).toMatchObject({ roles: ["workshop_manager", "admin"], dedupeKey: "incident_reported:7", priority: "high" });
    expect(calls.notified[0].message).toBe("Panne grave déclarée sur le véhicule AB-123-CD.");
    expect(calls.events).toEqual([
      {
        event: "incident_reported",
        data: expect.objectContaining({ payload: { id: 7, vehicleId: 10, severity: "high" }, scope: REALTIME_EVENTS.incident_reported.scope }),
      },
    ]);
  });

  it("hors véhicule ou client : 403, aucune écriture, aucun événement", async () => {
    for (const actor of [{ id: 5, role: "driver" }, { id: 9, role: "client" }]) {
      const { deps, calls } = makeDeps([10]);
      await expect(createIncident(actor, { vehicleId: 99, description: "Panne moteur", severity: "low" }, deps)).rejects.toMatchObject({ status: 403 });
      expect(calls.inserted).toEqual([]);
      expect(calls.events).toEqual([]);
    }
  });

  it("véhicule inexistant : 404 avant toute écriture (pas de violation de clé étrangère)", async () => {
    const { deps, calls } = makeDeps([], []);
    await expect(createIncident({ id: 1, role: "admin" }, { vehicleId: 404, description: "Panne moteur", severity: "low" }, deps)).rejects.toMatchObject({ status: 404 });
    expect(calls.inserted).toEqual([]);
    expect(calls.notified).toEqual([]);
    expect(calls.events).toEqual([]);
  });

  it("l'échec de l'alerte n'annule pas la déclaration", async () => {
    const { deps, calls } = makeDeps([10]);
    deps.notifyRoles = async () => {
      throw new Error("alerte indisponible");
    };
    const out = await createIncident({ id: 5, role: "driver" }, { vehicleId: 10, description: "Pneu à plat", severity: "low" }, deps);
    expect(out.id).toBe(7);
    expect(calls.events).toHaveLength(1);
  });
});

describe("listIncidents", () => {
  it("hors atelier, logistique et chauffeur : 403 avant toute lecture", async () => {
    const db = { select: () => { throw new Error("lecture interdite"); } };
    for (const role of ["accountant", "viewer", "secretary", "warehouse", "technician", "management", "user", "client"]) {
      await expect(listIncidents({ id: 1, role }, {}, { db })).rejects.toMatchObject({ status: 403, message: INCIDENT_READ_FORBIDDEN_MESSAGE });
    }
  });
});
