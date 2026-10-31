import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-error";
import { PENDING_LOGOUT_KEY, createPendingLogout } from "@/lib/pending-logout";

function setup(sendLogout: () => Promise<void>) {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
  const send = vi.fn(sendLogout);
  const pending = createPendingLogout({ storage: () => storage, sendLogout: send, now: () => 1234 });
  return { map, send, pending };
}

describe("déconnexion serveur en attente", () => {
  it("sans repère, ne contacte pas le serveur", async () => {
    const { send, pending } = setup(async () => undefined);
    expect(await pending.flush()).toBe("none");
    expect(send).not.toHaveBeenCalled();
  });

  it("déconnexion hors ligne : le repère reste, puis part au retour du réseau", async () => {
    let online = false;
    const { map, send, pending } = setup(async () => {
      if (!online) throw new TypeError("Failed to fetch");
    });
    pending.mark();
    expect(map.get(PENDING_LOGOUT_KEY)).toBe("1234");

    expect(await pending.flush()).toBe("pending");
    expect(pending.isPending()).toBe(true);

    online = true;
    expect(await pending.flush()).toBe("sent");
    expect(pending.isPending()).toBe(false);
    expect(send).toHaveBeenCalledTimes(2);
    expect(await pending.flush()).toBe("none");
  });

  it("une erreur serveur garde le repère, un 401 le solde", async () => {
    let status = 500;
    const { send, pending } = setup(async () => {
      throw new ApiError(status, "x", null);
    });
    pending.mark();
    expect(await pending.flush()).toBe("pending");
    status = 401;
    expect(await pending.flush()).toBe("sent");
    expect(pending.isPending()).toBe(false);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("un seul envoi à la fois", async () => {
    let release!: () => void;
    const { send, pending } = setup(() => new Promise<void>((resolve) => (release = resolve)));
    pending.mark();
    const first = pending.flush();
    const second = pending.flush();
    release();
    expect(await Promise.all([first, second])).toEqual(["sent", "sent"]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("une nouvelle connexion efface le repère : l'ancienne session n'est plus à fermer", async () => {
    const { send, pending } = setup(async () => undefined);
    pending.mark();
    pending.clear();
    expect(await pending.flush()).toBe("none");
    expect(send).not.toHaveBeenCalled();
  });

  it("tolère un stockage indisponible", async () => {
    const send = vi.fn(async () => undefined);
    const pending = createPendingLogout({ storage: () => null, sendLogout: send });
    pending.mark();
    expect(await pending.flush()).toBe("none");
  });
});
