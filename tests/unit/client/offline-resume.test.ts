import { beforeEach, describe, expect, it } from "vitest";
import {
  RESUME_DB,
  RESUME_KEY,
  RESUME_TTL_MS,
  createOfflineResume,
  resumeFlagNames,
  resumeProfileOf,
  type ResumeKv,
} from "../../../client/src/lib/offline-resume";
import { DRIVER_CACHE_MAX_AGE_MS, isOfflineDbName } from "../../../client/src/lib/offline-user-scope";

function fakeKv() {
  const store = new Map<string, unknown>();
  const kv: ResumeKv = {
    get: async <T>(db: string, key: string) => store.get(`${db}/${key}`) as T | undefined,
    set: async (db, key, value) => void store.set(`${db}/${key}`, structuredClone(value)),
    del: async (db, key) => void store.delete(`${db}/${key}`),
  };
  return { kv, store, raw: () => store.get(`${RESUME_DB}/${RESUME_KEY}`) as Record<string, unknown> | undefined };
}

const T0 = Date.UTC(2026, 10, 10, 8, 0, 0);
const ON = { "driver-offline": true, "offline-writes": true };

let h: ReturnType<typeof fakeKv>;
let resume: ReturnType<typeof createOfflineResume>;

beforeEach(() => {
  h = fakeKv();
  resume = createOfflineResume(h.kv);
});

describe("marqueur offline-resume : contenu", () => {
  it("la durée de vie est celle du cache chauffeur (72 h)", () => {
    expect(RESUME_TTL_MS).toBe(72 * 60 * 60 * 1000);
    expect(RESUME_TTL_MS).toBe(DRIVER_CACHE_MAX_AGE_MS);
  });

  it("ne vit pas dans une base de cache de lecture (jamais vidée avec elle)", () => {
    expect(isOfflineDbName(RESUME_DB)).toBe(false);
  });

  it("instantané des clés persistées : ni jeton, ni cookie, ni email, ni nom", async () => {
    const user = { id: 7, role: "driver", email: "chauffeur@x.cm", name: "Paul Mbarga", username: "pmbarga", token: "tok" };
    expect(await resume.record(user, ON, T0)).toBe(true);
    const stored = h.raw()!;
    expect(Object.keys(stored).sort()).toEqual(["expiresAt", "flags", "lastOnlineAt", "maxSeenAt", "profile", "userId", "version"]);
    expect(stored).toEqual({
      version: 1,
      userId: 7,
      profile: "driver",
      lastOnlineAt: T0,
      expiresAt: T0 + RESUME_TTL_MS,
      maxSeenAt: T0,
      flags: { "driver-offline": true, "offline-writes": true },
    });
    const json = JSON.stringify([...h.store.entries()]);
    for (const secret of ["chauffeur@x.cm", "Paul Mbarga", "pmbarga", "tok", "email", "cookie", "session"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("seuls les drapeaux nommés par les profils de reprise sont gardés", async () => {
    await resume.record({ id: 7, role: "driver" }, { ...ON, "technician-offline": true, autre: true }, T0);
    expect(Object.keys(h.raw()!.flags as object).sort()).toEqual([...resumeFlagNames()].sort());
  });
});

describe("marqueur offline-resume : échéance", () => {
  it("lisible exactement à 72 h", async () => {
    await resume.record({ id: 7, role: "driver" }, ON, T0);
    const grant = await resume.read(T0 + RESUME_TTL_MS);
    expect(grant?.userId).toBe(7);
  });

  it("refusé à 72 h + 1 ms, et supprimé", async () => {
    await resume.record({ id: 7, role: "driver" }, ON, T0);
    expect(await resume.read(T0 + RESUME_TTL_MS + 1)).toBeNull();
    expect(h.raw()).toBeUndefined();
  });

  it("une échéance écrite plus loin que 72 h après le dernier contact est refusée", async () => {
    await resume.record({ id: 7, role: "driver" }, ON, T0);
    h.store.set(`${RESUME_DB}/${RESUME_KEY}`, { ...h.raw()!, expiresAt: T0 + RESUME_TTL_MS * 10 });
    expect(await resume.read(T0 + 1000)).toBeNull();
    expect(h.raw()).toBeUndefined();
  });

  it("un dernier contact dans le futur (horloge reculée) est refusé", async () => {
    await resume.record({ id: 7, role: "driver" }, ON, T0 + 60 * 60 * 1000);
    expect(await resume.read(T0)).toBeNull();
  });

  it("plusieurs relances hors ligne : expiresAt et lastOnlineAt ne bougent pas", async () => {
    await resume.record({ id: 7, role: "driver" }, ON, T0);
    for (const hours of [1, 5, 20, 40, 71]) {
      expect((await resume.read(T0 + hours * 3600_000))?.userId).toBe(7);
      expect((await resume.peek(T0 + hours * 3600_000))?.expiresAt).toBe(T0 + RESUME_TTL_MS);
      expect(h.raw()).toMatchObject({ lastOnlineAt: T0, expiresAt: T0 + RESUME_TTL_MS });
    }
  });

  it("un contact réseau (touch) repousse l'échéance du même compte", async () => {
    await resume.record({ id: 7, role: "driver" }, ON, T0);
    expect(await resume.touch(7, null, T0 + 3600_000)).toBe(true);
    expect(h.raw()).toMatchObject({ lastOnlineAt: T0 + 3600_000, expiresAt: T0 + 3600_000 + RESUME_TTL_MS, flags: ON });
  });

  it("touch sans marqueur, ou pour un autre compte : aucune écriture", async () => {
    expect(await resume.touch(7, ON, T0)).toBe(false);
    expect(h.raw()).toBeUndefined();
    await resume.record({ id: 7, role: "driver" }, ON, T0);
    const before = structuredClone(h.raw());
    expect(await resume.touch(8, ON, T0 + 1000)).toBe(false);
    expect(h.raw()).toEqual(before);
  });

  it("touch d'un marqueur déjà échu ne le ressuscite pas", async () => {
    await resume.record({ id: 7, role: "driver" }, ON, T0);
    expect(await resume.touch(7, ON, T0 + RESUME_TTL_MS + 1)).toBe(false);
    expect(h.raw()).toBeUndefined();
  });
});

describe("marqueur offline-resume : profil et drapeaux", () => {
  it("le chauffeur est le seul profil de reprise (table, pas de test de rôle)", () => {
    expect(resumeProfileOf("driver")?.id).toBe("driver");
    expect(resumeProfileOf("technician")).toBeNull();
    expect(resumeProfileOf("admin")).toBeNull();
    expect(resumeProfileOf("client")).toBeNull();
  });

  it.each(["technician", "admin", "warehouse", "client"])("profil %s : rien n'est écrit", async (role) => {
    expect(await resume.record({ id: 9, role }, ON, T0)).toBe(false);
    expect(h.raw()).toBeUndefined();
  });

  it("un non-chauffeur qui se connecte efface le marqueur du chauffeur précédent", async () => {
    await resume.record({ id: 7, role: "driver" }, ON, T0);
    expect(await resume.record({ id: 9, role: "technician" }, ON, T0 + 1000)).toBe(false);
    expect(h.raw()).toBeUndefined();
  });

  it("un marqueur dont le profil n'est pas de reprise est refusé et supprimé", async () => {
    await resume.record({ id: 7, role: "driver" }, ON, T0);
    h.store.set(`${RESUME_DB}/${RESUME_KEY}`, { ...h.raw()!, profile: "technician" });
    expect(await resume.read(T0 + 1000)).toBeNull();
    expect(h.raw()).toBeUndefined();
  });

  it("driver-offline éteint : rien, marqueur supprimé", async () => {
    await resume.record({ id: 7, role: "driver" }, { ...ON, "driver-offline": false }, T0);
    expect(await resume.read(T0 + 1000)).toBeNull();
    expect(h.raw()).toBeUndefined();
  });

  it("offline-writes éteint : rien (le profil chauffeur exige les deux)", async () => {
    await resume.record({ id: 7, role: "driver" }, { ...ON, "offline-writes": false }, T0);
    expect(await resume.read(T0 + 1000)).toBeNull();
  });

  it("drapeau absent = éteint", async () => {
    h.store.set(`${RESUME_DB}/${RESUME_KEY}`, {
      version: 1,
      userId: 7,
      profile: "driver",
      lastOnlineAt: T0,
      expiresAt: T0 + RESUME_TTL_MS,
      flags: { "driver-offline": true },
    });
    expect(await resume.read(T0 + 1000)).toBeNull();
    expect(h.raw()).toBeUndefined();
  });

  it("drapeaux inconnus à l'écriture (null) : éteints pour un nouveau compte, gardés pour le même compte", async () => {
    await resume.record({ id: 7, role: "driver" }, null, T0);
    expect(h.raw()!.flags).toEqual({ "driver-offline": false, "offline-writes": false });
    await resume.record({ id: 7, role: "driver" }, ON, T0 + 1000);
    await resume.record({ id: 7, role: "driver" }, null, T0 + 2000);
    expect(h.raw()!.flags).toEqual(ON);
    await resume.record({ id: 8, role: "driver" }, null, T0 + 3000);
    expect(h.raw()!.flags).toEqual({ "driver-offline": false, "offline-writes": false });
  });

  it("le lecteur de drapeaux rendu vient du marqueur, pas du réseau", async () => {
    await resume.record({ id: 7, role: "driver" }, ON, T0);
    const grant = await resume.read(T0 + 1000);
    expect(grant?.isFlagOn("driver-offline")).toBe(true);
    expect(grant?.isFlagOn("technician-offline")).toBe(false);
    expect(grant?.isFlagOn("inconnu")).toBe(false);
  });
});

describe("marqueur offline-resume : purge", () => {
  it("clear supprime le marqueur", async () => {
    await resume.record({ id: 7, role: "driver" }, ON, T0);
    await resume.clear();
    expect(h.raw()).toBeUndefined();
    expect(await resume.read(T0 + 1000)).toBeNull();
  });

  it("clearIfNotUser : supprime pour un autre compte, garde pour le même", async () => {
    await resume.record({ id: 7, role: "driver" }, ON, T0);
    await resume.clearIfNotUser(7);
    expect(h.raw()).toBeDefined();
    await resume.clearIfNotUser(8);
    expect(h.raw()).toBeUndefined();
  });

  it("un compte différent qui se connecte remplace le marqueur", async () => {
    await resume.record({ id: 7, role: "driver" }, ON, T0);
    await resume.record({ id: 8, role: "driver" }, ON, T0 + 1000);
    expect(h.raw()).toMatchObject({ userId: 8 });
  });

  it("une purge lancée pendant une écriture l'emporte (ordre de lancement)", async () => {
    const pending = resume.record({ id: 7, role: "driver" }, ON, T0);
    const purge = resume.clear();
    await Promise.all([pending, purge]);
    expect(h.raw()).toBeUndefined();
  });

  it.each([null, "x", 12, [], { version: 2 }, { version: 1, userId: -1, profile: "driver" }])(
    "enregistrement illisible %j : refusé et supprimé",
    async (garbage) => {
      h.store.set(`${RESUME_DB}/${RESUME_KEY}`, garbage);
      expect(await resume.read(T0)).toBeNull();
      expect(h.raw()).toBeUndefined();
    },
  );
});

describe("marqueur offline-resume : horloge reculée (maxSeenAt)", () => {
  const H = 3600_000;
  it("une lecture hors ligne fait monter maxSeenAt sans repousser l'échéance", async () => {
    await resume.record({ id: 7, role: "driver" }, ON, T0);
    await resume.read(T0 + 10 * H);
    expect(h.raw()).toMatchObject({ maxSeenAt: T0 + 10 * H, lastOnlineAt: T0, expiresAt: T0 + RESUME_TTL_MS });
  });

  it("horloge reculée de plus de 5 minutes sous la dernière heure vue : refusé", async () => {
    await resume.record({ id: 7, role: "driver" }, ON, T0);
    await resume.read(T0 + 10 * H);
    expect(await resume.read(T0 + 2 * H)).toBeNull();
    expect(await resume.peek(T0 + 2 * H)).toBeNull();
  });

  it("recul de moins de 5 minutes toléré, maxSeenAt ne redescend pas", async () => {
    await resume.record({ id: 7, role: "driver" }, ON, T0);
    await resume.read(T0 + 10 * H);
    expect((await resume.read(T0 + 10 * H - 4 * 60_000))?.userId).toBe(7);
    expect(h.raw()!.maxSeenAt).toBe(T0 + 10 * H);
  });

  it("risque assumé : une horloge ramenée à chaque démarrage près de maxSeenAt prolonge la lecture au-delà de 72 h réelles", async () => {
    await resume.record({ id: 7, role: "driver" }, ON, T0);
    await resume.read(T0 + 71 * H);
    // Trois jours réels passent, mais l'appareil affiche toujours la même heure (à 4 min près) : lisible.
    expect((await resume.read(T0 + 71 * H - 4 * 60_000))?.userId).toBe(7);
    expect((await resume.read(T0 + 71 * H - 3 * 60_000))?.userId).toBe(7);
    // L'échéance, elle, n'a pas bougé : l'heure de l'appareil qui avance la fait jouer.
    expect(h.raw()!.expiresAt).toBe(T0 + RESUME_TTL_MS);
    expect(await resume.read(T0 + RESUME_TTL_MS + 1)).toBeNull();
  });

  it("marqueur écrit sans maxSeenAt (avant ce correctif) : lisible, borné par lastOnlineAt", async () => {
    await resume.record({ id: 7, role: "driver" }, ON, T0);
    const legacy = { ...h.raw()! };
    delete legacy.maxSeenAt;
    h.store.set(`${RESUME_DB}/${RESUME_KEY}`, legacy);
    expect((await resume.read(T0 + H))?.userId).toBe(7);
    expect(await resume.read(T0 - 10 * 60_000)).toBeNull();
  });

  it("maxSeenAt inférieur à lastOnlineAt : marqueur falsifié, refusé", async () => {
    await resume.record({ id: 7, role: "driver" }, ON, T0);
    h.store.set(`${RESUME_DB}/${RESUME_KEY}`, { ...h.raw()!, maxSeenAt: T0 - 1 });
    expect(await resume.read(T0 + H)).toBeNull();
  });
});

describe("marqueur offline-resume : drapeau éteint reçu en ligne", () => {
  it("touch avec un drapeau éteint supprime le marqueur tout de suite", async () => {
    await resume.record({ id: 7, role: "driver" }, ON, T0);
    expect(await resume.touch(7, { ...ON, "offline-writes": false }, T0 + 1000)).toBe(false);
    expect(h.raw()).toBeUndefined();
  });

  it("record avec un drapeau éteint n'écrit rien et supprime l'ancien marqueur", async () => {
    await resume.record({ id: 7, role: "driver" }, ON, T0);
    expect(await resume.record({ id: 7, role: "driver" }, { ...ON, "driver-offline": false }, T0 + 1000)).toBe(false);
    expect(h.raw()).toBeUndefined();
  });

  it("drapeaux inconnus (null) : le marqueur est gardé", async () => {
    await resume.record({ id: 7, role: "driver" }, ON, T0);
    expect(await resume.touch(7, null, T0 + 1000)).toBe(true);
    expect(h.raw()).toBeDefined();
  });
});
