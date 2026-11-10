import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../server/lib/preventive-date-job-config", () => ({ isPreventiveDateJobEnabled: () => true }));
// Pas d'export `listenerPool` : la création du verrou lève, hors de runPreventiveDateCheck.
vi.mock("../../../server/db", () => ({}));
vi.mock("../../../server/services/preventive-maintenance-service", () => ({
  preventiveMaintenanceService: { checkDateBasedMaintenance: vi.fn() },
}));

import { preventiveDateCheckTick, resetPreventiveDateCheckState } from "../../../server/jobs/preventive-date-check";

afterEach(() => resetPreventiveDateCheckState());

describe("preventiveDateCheckTick (V5a)", () => {
  it("ne lève jamais, même si le verrou ne peut pas être créé : le cycle d'alertes continue", async () => {
    await expect(preventiveDateCheckTick(1_000)).resolves.toBeUndefined();
  });
});
