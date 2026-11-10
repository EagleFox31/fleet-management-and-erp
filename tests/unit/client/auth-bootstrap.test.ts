import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAuthBootstrap,
  type AuthBootstrapDeps,
  type AuthBootstrapState,
} from "../../../client/src/lib/auth-bootstrap";
import { checkSession, type SessionCheck } from "../../../client/src/lib/session-check";
import { isOfflineReadOnly, offlineHomePathFor } from "../../../client/src/lib/offline-read-only";

const T0 = 1_800_000_000_000;
const GRANT = { userId: 7, profile: "driver", expiresAt: T0 + 72 * 3600_000 };
const USER = { id: 7, username: "d", name: "D", email: "d@x", role: "driver" };

function setup(script: SessionCheck[]) {
  const states: AuthBootstrapState[] = [];
  const expired: number[] = [];
  let stale = false;
  let i = 0;
  const deps: AuthBootstrapDeps = {
    resumeSession: async () => script[Math.min(i++, script.length - 1)],
    expireOfflineGrant: async (g) => void expired.push(g.userId),
    now: () => Date.now(),
    isStale: () => stale,
    onState: (s) => void states.push(s),
  };
  const boot = createAuthBootstrap(deps);
  return { boot, states, expired, last: () => states[states.length - 1], stale: () => (stale = true) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

describe("amorçage de session : reprise hors ligne", () => {
  it("grant renvoyé : plus de voile, user reste null, aucun rôle reconstruit", async () => {
    const h = setup([{ status: "unreachable", resumed: GRANT }]);
    void h.boot.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.last()).toEqual({ user: null, isLoading: false, sessionUnreachable: false, offlineGrant: GRANT });
    expect(isOfflineReadOnly(h.last())).toBe(true);
    h.boot.dispose();
  });

  it("sans grant : voile d'attente, pas de lecture seule", async () => {
    const h = setup([{ status: "unreachable" }]);
    void h.boot.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.last()).toMatchObject({ user: null, isLoading: true, sessionUnreachable: true, offlineGrant: null });
    expect(isOfflineReadOnly(h.last())).toBe(false);
    h.stale();
  });

  it("la boucle continue : /me répond, user renseigné et grant effacé", async () => {
    const h = setup([{ status: "unreachable", resumed: GRANT }, { status: "authenticated", user: USER }]);
    void h.boot.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.last()).toEqual({ user: USER, isLoading: false, sessionUnreachable: false, offlineGrant: null });
    expect(isOfflineReadOnly(h.last())).toBe(false);
  });

  it("401 : grant effacé, écran de connexion (user null, plus de chargement)", async () => {
    const h = setup([{ status: "unreachable", resumed: GRANT }, { status: "anonymous" }]);
    void h.boot.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.last()).toEqual({ user: null, isLoading: false, sessionUnreachable: false, offlineGrant: null });
  });

  it("échéance atteinte : retour au voile et lectures hors ligne coupées", async () => {
    const h = setup([{ status: "unreachable", resumed: GRANT }]);
    void h.boot.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.expired).toEqual([]);
    await vi.advanceTimersByTimeAsync(72 * 3600_000 + 1);
    expect(h.expired).toEqual([7]);
    expect(h.last()).toMatchObject({ user: null, isLoading: true, sessionUnreachable: true, offlineGrant: null });
    h.stale();
  });

  it("amorçage remplacé (connexion, déconnexion) : plus rien n'est publié", async () => {
    const h = setup([{ status: "unreachable", resumed: GRANT }]);
    h.stale();
    void h.boot.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.states).toEqual([]);
  });
});

describe("table profil vers accueil", () => {
  it("le chauffeur a l'accueil « / », un profil inconnu n'en a pas", () => {
    expect(offlineHomePathFor("driver")).toBe("/");
    expect(offlineHomePathFor("admin")).toBeNull();
  });
});

describe("amorçage de session : compte supprimé (404 sur /api/auth/me)", () => {
  it("lecture hors ligne ouverte, puis /me répond 404 : grant effacé, écran de connexion", async () => {
    const notFound = (async () => new Response(JSON.stringify({ message: "Utilisateur non trouvé" }), { status: 404 })) as unknown as typeof fetch;
    const script: Array<() => Promise<SessionCheck>> = [
      async () => ({ status: "unreachable", resumed: GRANT }),
      () => checkSession(notFound),
    ];
    let i = 0;
    const states: AuthBootstrapState[] = [];
    const boot = createAuthBootstrap({
      resumeSession: () => script[Math.min(i++, script.length - 1)](),
      expireOfflineGrant: async () => {},
      now: () => Date.now(),
      isStale: () => false,
      onState: (s) => void states.push(s),
    });
    void boot.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(states[0].offlineGrant).toEqual(GRANT);
    expect(states[states.length - 1]).toEqual({ user: null, isLoading: false, sessionUnreachable: false, offlineGrant: null });
    boot.dispose();
  });
});
