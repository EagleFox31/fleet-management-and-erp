import { beforeEach, describe, expect, it, vi } from "vitest";

const { findActiveSessionUser } = vi.hoisted(() => ({ findActiveSessionUser: vi.fn() }));
vi.mock("../../../server/services/session-user", () => ({ findActiveSessionUser }));

import { VIEWER_READ_ONLY_MESSAGE, viewerReadOnlyGuard } from "../../../server/middleware/viewer-read-only-guard";

type Req = { method: string; path: string; session?: { userId?: number }; user?: { role: string } };

const viewerStored = () => findActiveSessionUser.mockResolvedValueOnce({ role: "viewer" });

async function run(req: Req): Promise<unknown> {
  return new Promise((resolve) => {
    void viewerReadOnlyGuard(req as never, {} as never, (error?: unknown) => resolve(error ?? null));
  });
}

describe("viewerReadOnlyGuard : rôle normalisé, allowlist, rôle relu depuis la session", () => {
  beforeEach(() => findActiveSessionUser.mockReset());

  it("laisse passer les lectures et les requêtes sans session, sans toucher la base", async () => {
    expect(await run({ method: "GET", path: "/vehicles", session: { userId: 1 } })).toBeNull();
    expect(await run({ method: "POST", path: "/vehicles" })).toBeNull();
    expect(findActiveSessionUser).not.toHaveBeenCalled();
  });

  it("refuse l'écriture d'un lecteur, même si le rôle est stocké « Viewer » ou « lecteur »", async () => {
    for (const role of ["viewer", " Viewer ", "LECTEUR"]) {
      findActiveSessionUser.mockResolvedValueOnce({ role });
      const error = await run({ method: "POST", path: "/vehicles", session: { userId: 1 } });
      expect(error).toMatchObject({ status: 403, message: VIEWER_READ_ONLY_MESSAGE });
    }
  });

  it("ignore req.user : le rôle vient de la session, même si un req.user admin est posé", async () => {
    viewerStored();
    expect(await run({ method: "DELETE", path: "/vehicles/1", session: { userId: 1 }, user: { role: "admin" } })).toMatchObject({ status: 403 });
    expect(findActiveSessionUser).toHaveBeenCalledWith(1);
  });

  it("laisse le libre-service et la session au lecteur", async () => {
    for (const [method, path] of [["POST", "/auth/login"], ["POST", "/users/change-password"], ["PATCH", "/alerts/42/read"], ["PATCH", "/onboarding/complete/"]]) {
      expect(await run({ method, path, session: { userId: 1 } })).toBeNull();
    }
    expect(findActiveSessionUser).not.toHaveBeenCalled();
    viewerStored();
    expect(await run({ method: "POST", path: "/alerts/read-all", session: { userId: 1 } })).toMatchObject({ status: 403 });
  });

  it("ne bloque pas les autres rôles", async () => {
    findActiveSessionUser.mockResolvedValueOnce({ role: "Technicien" });
    expect(await run({ method: "POST", path: "/vehicles", session: { userId: 1 } })).toBeNull();
  });
});
