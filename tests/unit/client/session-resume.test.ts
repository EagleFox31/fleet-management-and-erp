import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createLogout, createSessionResume, type SessionResumeDeps } from "../../../client/src/lib/session-resume";
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
    async purgeLocal() {
      calls.push("purge");
      active = null;
    },
    // Marqueur de reprise hors ligne : couvert par session-resume-offline.test.ts.
    async recordOnline() {},
    async restoreOffline() {
      return null;
    },
    async clearResume() {},
  };
  return { resume: createSessionResume(deps), calls, active: () => active };
}

describe("reprise de session au démarrage (CDC-10a)", () => {
  it("la déconnexion différée part avant /api/auth/me", async () => {
    const h = harness({ pending: "sent", session: { status: "anonymous" } });
    await h.resume();
    expect(h.calls.filter((c) => c !== "purge").slice(0, 2)).toEqual(["logout", "me"]);
  });

  it("déconnexion différée encore en attente : aucune session restaurée, /me n'est pas appelé", async () => {
    const h = harness({ pending: "pending", session: { status: "authenticated", user: userA } });
    expect(await h.resume()).toEqual({ status: "anonymous" });
    expect(h.calls).toEqual(["logout", "purge"]);
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

  it("déconnexion trouvée en attente au démarrage : la purge locale est refaite avant /me (onglet fermé pendant le POST)", async () => {
    const h = harness({ pending: "sent", activeAtStart: 11, session: { status: "anonymous" } });
    await h.resume();
    expect(h.calls.slice(0, 3)).toEqual(["logout", "purge", "me"]);
  });

  it("aucune déconnexion en attente : aucune purge au démarrage", async () => {
    const h = harness({ session: { status: "authenticated", user: userA } });
    await h.resume();
    expect(h.calls).not.toContain("purge");
  });

  it("le fournisseur d'authentification amorce par resumeSession, pas par checkSession seul", () => {
    // Garde-fou : une fusion avait remplacé le point d'entrée et rendu la composition morte.
    const src = readFileSync(resolve(__dirname, "../../../client/src/hooks/useAuth.tsx"), "utf8");
    const bootstrap = readFileSync(resolve(__dirname, "../../../client/src/lib/auth-bootstrap.ts"), "utf8");
    expect(src).toMatch(/createAuthBootstrap\(\{[\s\S]*resumeSession/);
    expect(bootstrap).toMatch(/await deps\.resumeSession\(\)/);
    expect(src).not.toMatch(/await checkSession\(/);
    expect(bootstrap).not.toMatch(/await checkSession\(/);
  });
});

describe("déconnexion (CDC-10a, réserve R2)", () => {
  function logoutHarness(post: () => Promise<void>) {
    const calls: string[] = [];
    let pending = false;
    const logout = createLogout({
      markPending: () => { calls.push("mark"); pending = true; },
      clearPending: () => { calls.push("clear"); pending = false; },
      purgeLocal: async () => { calls.push("purge"); },
      postLogout: async () => { calls.push("post"); await post(); },
    });
    return { logout, calls, pending: () => pending };
  }

  it("la purge locale précède le POST /logout : un onglet fermé pendant l'appel ne laisse rien de lisible", async () => {
    let calledBeforePurge = false;
    const h = logoutHarness(async () => new Promise<void>(() => {})); // POST qui ne répond jamais
    void h.logout();
    await new Promise((r) => setTimeout(r, 0));
    calledBeforePurge = h.calls.indexOf("post") < h.calls.indexOf("purge");
    expect(h.calls).toEqual(["mark", "purge", "post"]);
    expect(calledBeforePurge).toBe(false);
    expect(h.pending()).toBe(true);
  });

  it("serveur joint : le repère de déconnexion différée est levé", async () => {
    const h = logoutHarness(async () => {});
    await h.logout();
    expect(h.calls).toEqual(["mark", "purge", "post", "clear"]);
    expect(h.pending()).toBe(false);
  });

  it("serveur injoignable : purge faite, repère gardé, erreur relancée", async () => {
    const h = logoutHarness(async () => { throw new Error("offline"); });
    await expect(h.logout()).rejects.toThrow("offline");
    expect(h.calls).toEqual(["mark", "purge", "post"]);
    expect(h.pending()).toBe(true);
  });
});
