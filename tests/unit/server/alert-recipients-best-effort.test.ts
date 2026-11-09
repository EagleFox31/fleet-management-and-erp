import { describe, expect, it, vi } from "vitest";

const { getUsersByRole } = vi.hoisted(() => ({ getUsersByRole: vi.fn() }));
vi.mock("../../../server/storage", () => ({ storage: { getUsersByRole } }));

import { usersByRolesBestEffort } from "../../../server/lib/alert-recipients";

describe("usersByRolesBestEffort", () => {
  it("garde les rôles lisibles, journalise et ignore le rôle en échec", async () => {
    const failure = new Error("timeout exceeded when trying to connect");
    getUsersByRole.mockImplementation(async (role: string) => {
      if (role === "secretary") throw failure;
      return [{ id: role === "admin" ? 1 : 2 }];
    });
    const log = { warn: vi.fn() };

    const users = await usersByRolesBestEffort(["admin", "secretary", "workshop_manager"], log, { requestId: "r-1" });

    expect(users.map((u) => u.id)).toEqual([1, 2]);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0][0]).toMatchObject({ err: failure, requestId: "r-1", role: "secretary" });
  });

  it("ne lève jamais, même si tous les rôles échouent", async () => {
    getUsersByRole.mockRejectedValue(new Error("down"));
    await expect(usersByRolesBestEffort(["admin"], { warn: vi.fn() })).resolves.toEqual([]);
  });
});
