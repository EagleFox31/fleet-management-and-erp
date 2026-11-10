import { describe, expect, it } from "vitest";
import { createSessionResume, type SessionResumeDeps } from "../../../client/src/lib/session-resume";
import type { SessionCheck } from "../../../client/src/lib/session-check";

const driver = { id: 7, username: "d", name: "D", email: "d@x", role: "driver" };

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
      return opts.restored ?? true;
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
    expect(await h.resume()).toEqual({ status: "unreachable" });
    expect(h.calls).toEqual(["me", "restore"]);
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
