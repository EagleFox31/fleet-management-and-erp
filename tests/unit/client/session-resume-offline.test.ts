import { describe, expect, it } from "vitest";
import { resumeDeadlineFor } from "../../../client/src/lib/offline-data-banner";
import { createLogout, createSessionResume, type SessionResumeDeps } from "../../../client/src/lib/session-resume";
import type { SessionCheck } from "../../../client/src/lib/session-check";

const driver = { id: 7, username: "d", name: "D", email: "d@x", role: "driver" };

const GRANT = { userId: 7, profile: "driver", expiresAt: 9_999 };
function harness(opts: { session: SessionCheck; activeAtStart?: number | null; restored?: boolean }) {
  const calls: string[] = [];
  let active: number | null = opts.activeAtStart ?? null;
  const deps: SessionResumeDeps = {
    async flushPendingLogout() {
      return "none";
    },
    async checkSession() {
      calls.push("me");
      return opts.session;
    },
    getActiveUserId: () => active,
    activateUser(id) {
      calls.push(`activate:${id}`);
      active = id;
    },
    async expireUser(id) {
      calls.push(`expire:${id}`);
      active = null;
    },
    async purgeLocal() {
      calls.push("purge");
    },
    async recordOnline(user) {
      calls.push(`record:${user.id}`);
    },
    async restoreOffline() {
      calls.push("restore");
      return (opts.restored ?? true) ? GRANT : null;
    },
    async clearResume() {
      calls.push("clear-resume");
    },
  };
  return { resume: createSessionResume(deps), calls };
}

describe("reprise de session : restauration hors ligne (V5b-3b)", () => {
  it("réseau injoignable au démarrage : la restauration est tentée, le résultat reste unreachable", async () => {
    const h = harness({ session: { status: "unreachable" } });
    expect(await h.resume()).toEqual({ status: "unreachable", resumed: GRANT });
    expect(h.calls).toEqual(["me", "restore"]);
  });

  it("restauration refusée (null) : pas de resumed", async () => {
    const h = harness({ session: { status: "unreachable" }, restored: false });
    expect(await h.resume()).toEqual({ status: "unreachable" });
  });

  it.each([401, 403, 500, 503])("réponse HTTP %i : jamais de restauration", async (httpStatus) => {
    const session: SessionCheck =
      httpStatus === 401 ? { status: "anonymous" } : { status: "unreachable", httpStatus };
    const h = harness({ session });
    await h.resume();
    expect(h.calls).not.toContain("restore");
  });

  it("401 : le marqueur est effacé même sans compte actif au départ", async () => {
    const h = harness({ session: { status: "anonymous" } });
    await h.resume();
    expect(h.calls).toEqual(["me", "clear-resume"]);
  });

  it("401 avec un compte actif : expiration puis effacement du marqueur", async () => {
    const h = harness({ session: { status: "anonymous" }, activeAtStart: 7 });
    await h.resume();
    expect(h.calls).toEqual(["me", "expire:7", "clear-resume"]);
  });

  it("un compte déjà actif en mémoire n'est pas restauré une seconde fois", async () => {
    const h = harness({ session: { status: "unreachable" }, activeAtStart: 7 });
    await h.resume();
    expect(h.calls).not.toContain("restore");
  });

  it("session confirmée par /me : activation puis marqueur réécrit avec le compte renvoyé", async () => {
    const h = harness({ session: { status: "authenticated", user: driver } });
    await h.resume();
    expect(h.calls).toEqual(["me", "activate:7", "record:7"]);
  });

  it("une erreur de la restauration ne casse pas le démarrage", async () => {
    const calls: string[] = [];
    const resume = createSessionResume({
      flushPendingLogout: async () => "none",
      checkSession: async () => ({ status: "unreachable" }),
      getActiveUserId: () => null,
      activateUser: () => undefined,
      expireUser: async () => undefined,
      purgeLocal: async () => undefined,
      recordOnline: async () => undefined,
      restoreOffline: async () => {
        calls.push("restore");
        throw new Error("idb");
      },
      clearResume: async () => undefined,
    });
    expect(await resume()).toEqual({ status: "unreachable" });
    expect(calls).toEqual(["restore"]);
  });
});

describe("reprise de session : réponse non JSON et purge (audit)", () => {
  it.each([
    ["200 text/html", { status: "unreachable", httpStatus: 200 } as SessionCheck],
    ["redirection", { status: "unreachable", httpStatus: 302 } as SessionCheck],
  ])("%s : restoreOffline jamais appelé", async (_label, session) => {
    const h = harness({ session });
    await h.resume();
    expect(h.calls).not.toContain("restore");
  });

  function withPending(outcome: "sent" | "pending", purged: boolean | void) {
    const calls: string[] = [];
    const resume = createSessionResume({
      flushPendingLogout: async () => outcome,
      checkSession: async () => {
        calls.push("me");
        return { status: "unreachable" };
      },
      getActiveUserId: () => null,
      activateUser: () => undefined,
      expireUser: async () => undefined,
      purgeLocal: async () => {
        calls.push("purge");
        return purged;
      },
      markPendingLogout: () => calls.push("mark"),
      recordOnline: async () => undefined,
      restoreOffline: async () => {
        calls.push("restore");
        return { userId: 7, profile: "driver", expiresAt: 9_999 };
      },
      clearResume: async () => undefined,
    });
    return { resume, calls };
  }

  it("déconnexion en attente puis réseau coupé : purge, aucune restauration", async () => {
    const h = withPending("pending", undefined);
    expect(await h.resume()).toEqual({ status: "anonymous" });
    expect(h.calls).toEqual(["purge"]);
  });

  it("déconnexion envoyée mais purge locale incomplète : repère remis, aucune restauration", async () => {
    const h = withPending("sent", false);
    expect(await h.resume()).toEqual({ status: "anonymous" });
    expect(h.calls).toEqual(["purge", "mark"]);
  });
});

describe("déconnexion : le repère reste tant que la purge locale n'a pas abouti", () => {
  const build = (purged: boolean | void) => {
    const calls: string[] = [];
    const logout = createLogout({
      markPending: () => calls.push("mark"),
      clearPending: () => calls.push("clear"),
      purgeLocal: async () => purged,
      postLogout: async () => void calls.push("post"),
    });
    return { logout, calls };
  };
  it("purge complète : repère effacé après le POST", async () => {
    const h = build(true);
    await h.logout();
    expect(h.calls).toEqual(["mark", "post", "clear"]);
  });
  it("purge incomplète, POST réussi : repère gardé", async () => {
    const h = build(false);
    await h.logout();
    expect(h.calls).toEqual(["mark", "post"]);
  });
});

describe("bandeau : échéance du marqueur du compte actif", () => {
  it("autre compte, aucun compte actif, ou échu : aucune échéance", () => {
    const found = { userId: 7, expiresAt: 1000 };
    expect(resumeDeadlineFor(found, 7, 500)).toBe(1000);
    expect(resumeDeadlineFor(found, 8, 500)).toBeNull();
    expect(resumeDeadlineFor(found, null, 500)).toBeNull();
    expect(resumeDeadlineFor(found, 7, 1001)).toBeNull();
    expect(resumeDeadlineFor(null, 7, 500)).toBeNull();
  });
});
