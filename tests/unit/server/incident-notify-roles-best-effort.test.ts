import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `getUsersByRole` lève désormais sur erreur (il renvoyait `[]`). La notification d'incident
 * boucle sur plusieurs rôles : un rôle illisible ne doit pas couper la boucle, les rôles
 * suivants restent notifiés et la déclaration n'échoue pas.
 */

const { getUsersByRole, createAlert } = vi.hoisted(() => ({
  getUsersByRole: vi.fn(),
  createAlert: vi.fn(),
}));

vi.mock("../../../server/db", () => ({ db: {} }));
vi.mock("../../../server/lib/driver-scope", () => ({ assignedVehicleIdsOf: vi.fn() }));
vi.mock("../../../server/storage", () => ({ storage: { getUsersByRole, createAlert } }));

// Import statique : enregistre les modules simulés avant les import() dynamiques du service.
import "../../../server/storage";
import "../../../server/lib/driver-scope";
import { defaultDeps } from "../../../server/services/incident-service";

const params = {
  roles: ["admin", "workshop_manager"],
  title: "Panne déclarée",
  message: "TEST",
  link: "/incidents/1",
  dedupeKey: "incident:1",
  priority: "high" as const,
};

beforeEach(() => {
  getUsersByRole.mockReset();
  createAlert.mockReset().mockResolvedValue({ id: 99 });
});

describe("notification d'incident : destinataires au mieux", () => {
  it("rôle 1 illisible : le rôle 2 est notifié, sans erreur", async () => {
    getUsersByRole.mockImplementation(async (role: string) => {
      if (role === "admin") throw new Error("timeout exceeded when trying to connect");
      return [{ id: 2, role }];
    });
    const deps = await defaultDeps();
    await expect(deps.notifyRoles(params)).resolves.toBeUndefined();
    expect(getUsersByRole).toHaveBeenCalledWith("workshop_manager");
    expect(createAlert).toHaveBeenCalledTimes(1);
    expect(createAlert.mock.calls[0][0]).toMatchObject({ userId: 2, dedupeKey: "incident:1" });
  });
});
