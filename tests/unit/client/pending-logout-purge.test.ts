import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn() }));

import { ApiError } from "@/lib/api-error";
import { createPendingLogout, PENDING_LOGOUT_KEY } from "@/lib/pending-logout";

// Retour du réseau après une déconnexion dont la purge locale est restée incomplète :
// la purge est refaite AVANT d'effacer le repère, et le repère reste si elle échoue encore.
function makePending(sendLogout: () => Promise<void>) {
  const data = new Map<string, string>();
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
  const pending = createPendingLogout({ storage: () => storage, sendLogout });
  pending.mark();
  return { pending, has: () => data.has(PENDING_LOGOUT_KEY) };
}

describe("repère de déconnexion et purge locale refaite", () => {
  it("purge réussie : le repère est effacé APRÈS la purge", async () => {
    const order: string[] = [];
    const h = makePending(async () => void order.push("serveur"));
    const outcome = await h.pending.flush({
      beforeClear: async () => {
        order.push(h.has() ? "purge (repère présent)" : "purge (repère déjà effacé)");
        return true;
      },
    });
    expect(outcome).toBe("sent");
    expect(order).toEqual(["serveur", "purge (repère présent)"]);
    expect(h.has()).toBe(false);
  });

  it("purge encore incomplète (faux) : le repère reste, issue pending", async () => {
    const h = makePending(async () => undefined);
    expect(await h.pending.flush({ beforeClear: async () => false })).toBe("pending");
    expect(h.has()).toBe(true);
  });

  it("purge qui lève : le repère reste", async () => {
    const h = makePending(async () => undefined);
    expect(
      await h.pending.flush({
        beforeClear: async () => {
          throw new Error("IndexedDB indisponible");
        },
      }),
    ).toBe("pending");
    expect(h.has()).toBe(true);
  });

  it("purge réussie au second essai : le repère part alors", async () => {
    const h = makePending(async () => undefined);
    expect(await h.pending.flush({ beforeClear: async () => false })).toBe("pending");
    expect(await h.pending.flush({ beforeClear: async () => true })).toBe("sent");
    expect(h.has()).toBe(false);
  });

  it("sans option : comportement inchangé", async () => {
    const h = makePending(async () => undefined);
    expect(await h.pending.flush()).toBe("sent");
    expect(h.has()).toBe(false);
  });
});

describe("chemin 401 : le serveur ne connaît déjà plus la session, la purge locale est refaite quand même", () => {
  const unauthorized = async () => {
    throw new ApiError(401, "Utilisateur non authentifié", null);
  };

  it("401 puis purge réussie : la purge tourne, repère encore présent, puis effacé", async () => {
    const h = makePending(unauthorized);
    const beforeClear = vi.fn(async () => {
      expect(h.has()).toBe(true);
      return true;
    });
    expect(await h.pending.flush({ beforeClear })).toBe("sent");
    expect(beforeClear).toHaveBeenCalledTimes(1);
    expect(h.has()).toBe(false);
  });

  it("401 puis purge incomplète : le repère reste, issue pending", async () => {
    const h = makePending(unauthorized);
    expect(await h.pending.flush({ beforeClear: async () => false })).toBe("pending");
    expect(h.has()).toBe(true);
  });

  it("401 puis purge qui lève : le repère reste", async () => {
    const h = makePending(unauthorized);
    expect(
      await h.pending.flush({
        beforeClear: async () => {
          throw new Error("IndexedDB indisponible");
        },
      }),
    ).toBe("pending");
    expect(h.has()).toBe(true);
  });
});
