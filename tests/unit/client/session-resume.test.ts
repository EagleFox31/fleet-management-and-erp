import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createSessionResume, type SessionResumeDeps } from "../../../client/src/lib/session-resume";
import type { SessionCheck } from "../../../client/src/lib/session-check";
import type { PendingLogoutOutcome } from "../../../client/src/lib/pending-logout";

const userA = { id: 11, username: "a", name: "A", email: "a@x", role: "client" };

function harness(opts: { pending?: PendingLogoutOutcome; session?: SessionCheck; activeAtStart?: number | null }) {
  const calls: string[] = [];
  let active: number | null = opts.activeAtStart ?? null;
  const deps: SessionResumeDeps = {
    async flushPendingLogout() {
      calls.push("logout");
      return opts.pending ?? "none";
    },
    async checkSession() {
      calls.push("me");
      return opts.session ?? { status: "anonymous" };
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
  };
  return { resume: createSessionResume(deps), calls, active: () => active };
}

describe("reprise de session au démarrage (CDC-10a)", () => {
  it("la déconnexion différée part avant /api/auth/me", async () => {
    const h = harness({ pending: "sent", session: { status: "anonymous" } });
    await h.resume();
    expect(h.calls.slice(0, 2)).toEqual(["logout", "me"]);
  });

  it("déconnexion différée encore en attente : aucune session restaurée, /me n'est pas appelé", async () => {
    const h = harness({ pending: "pending", session: { status: "authenticated", user: userA } });
    expect(await h.resume()).toEqual({ status: "anonymous" });
    expect(h.calls).toEqual(["logout"]);
    expect(h.active()).toBeNull();
  });

  it("session restaurée : le compte devient l'utilisateur hors ligne actif", async () => {
    const h = harness({ session: { status: "authenticated", user: userA } });
    expect((await h.resume()).status).toBe("authenticated");
    expect(h.active()).toBe(11);
  });

  it("401 : le compte actif au départ est expiré", async () => {
    const h = harness({ activeAtStart: 11, session: { status: "anonymous" } });
    await h.resume();
    expect(h.calls).toContain("expire:11");
    expect(h.active()).toBeNull();
  });

  it("serveur injoignable : rien n'est expiré ni activé (nouvelle tentative)", async () => {
    const h = harness({ activeAtStart: 11, session: { status: "unreachable" } });
    expect((await h.resume()).status).toBe("unreachable");
    expect(h.calls).toEqual(["logout", "me"]);
    expect(h.active()).toBe(11);
  });

  it("le fournisseur d'authentification amorce par resumeSession, pas par checkSession seul", () => {
    // Garde-fou : une fusion avait remplacé le point d'entrée et rendu la composition morte.
    const src = readFileSync(resolve(__dirname, "../../../client/src/hooks/useAuth.tsx"), "utf8");
    expect(src).toMatch(/await resumeSession\(\)/);
    expect(src).not.toMatch(/await checkSession\(/);
  });
});
