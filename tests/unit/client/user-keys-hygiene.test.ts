import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Hygiène du stockage par utilisateur (S1, répétée trois fois : file hors ligne, tampon GPS, réouverture).
 * La règle « un changement de compte détruit ce que l'ancien compte a laissé sur l'appareil » ne tient plus
 * à la seule documentation (docs/analysis/LESSONS_LEARNED.md, 2026-11-10) : ce test échoue si
 *  1. une clé localStorage propre à un utilisateur survit à `activateOfflineUser` d'un autre compte
 *     sans figurer dans la liste gelée ci-dessous ;
 *  2. une famille de clés `fleetos-*` ou un nouveau fichier qui touche localStorage n'est pas classé.
 */
const idb = vi.hoisted(() => ({ dbs: new Map<string, Map<string, unknown>>() }));
vi.mock("idb-keyval", () => ({
  createStore: (db: string) => db,
  get: async (key: string, store?: string) => idb.dbs.get(store ?? "keyval-store")?.get(key),
  set: async (key: string, value: unknown, store?: string) => {
    const name = store ?? "keyval-store";
    if (!idb.dbs.has(name)) idb.dbs.set(name, new Map());
    idb.dbs.get(name)!.set(key, value);
  },
  del: async (key: string, store?: string) => void idb.dbs.get(store ?? "keyval-store")?.delete(key),
  clear: async (store?: string) => void idb.dbs.get(store ?? "keyval-store")?.clear(),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  queryClient: { getQueryData: () => ({ "offline-writes": true, "driver-offline": true }), invalidateQueries: vi.fn() },
}));
vi.mock("@/lib/pending-logout", () => ({ pendingServerLogout: { flush: vi.fn(async () => "none") } }));
vi.mock("@/lib/offline-session-channel", () => ({ sessionChannel: { post: vi.fn(), subscribe: () => () => undefined } }));

import { createFormDraftStorage } from "@/lib/form-draft-storage";
import { gpsBufferKey } from "@/lib/gps-tracking";
import { activateOfflineUser } from "@/lib/offline-storage";
import { setActiveOfflineUserId } from "@/lib/offline-user-scope";

const ROOT = join(__dirname, "..", "..", "..");
const CLIENT_SRC = join(ROOT, "client", "src");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "mocks") continue;
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}
const files = sourceFiles(CLIENT_SRC).map((f) => ({ path: relative(CLIENT_SRC, f).replace(/\\/g, "/"), text: readFileSync(f, "utf8") }));

/**
 * LISTE GELÉE, elle ne peut que diminuer : clés propres à un utilisateur que `activateOfflineUser` ne purge
 * PAS aujourd'hui. Les brouillons (`fleetos-<formId>-v<n>-<userId>`) sont purgés à la déconnexion
 * (`purgeBrowserUserState`) mais pas au changement de compte : les détruire quand une session expire
 * ferait perdre sa saisie à l'utilisateur qui se reconnecte, c'est une décision produit hors du lot GPS.
 * Chacun reste lisible seulement sous la clé de son compte (jamais servi à un autre). Quand une famille
 * est purgée, ce test échoue et demande de la retirer d'ici.
 */
const FROZEN_UNPURGED: Array<{ label: string; matches: (key: string) => boolean }> = [
  { label: "brouillons de formulaire", matches: (key) => /^fleetos-.+-v\d+-\d+$/.test(key) },
];

/** Familles de clés `fleetos-*` connues : toute nouvelle doit être classée ici (propre à un compte ou non). */
const KNOWN_FLEETOS_LITERALS: Record<string, string> = {
  "fleetos-": "gabarits : brouillons (form-draft-storage), préfixe de caches (pwa-register)",
  "fleetos-gps-buffer-": "tampon GPS par compte : purgé (purgeGpsBuffersOfOthers)",
  "fleetos-offline-u": "base IndexedDB par compte : purgée (offlineScope.purgeOthers)",
  "fleetos-offline-lock:": "bail inter-onglets, sans donnée utilisateur",
  "fleetos-offline-resume": "marqueur de reprise : purgé (offlineResume.clearIfNotUser)",
  "fleetos-offline-resume-revoked": "drapeau de révocation, sans donnée utilisateur",
  "fleetos-offline-session": "nom de canal BroadcastChannel",
  "fleetos-offline-db-registry": "noms de bases seulement, aucune donnée",
  "fleetos-query-cache-v1": "ancien format, détruit (purgeLegacy)",
  "fleetos-offline-queue-v1": "ancien format, détruit (purgeLegacy)",
  "fleetos-pending-server-logout": "déconnexion serveur en attente, sans donnée utilisateur",
  "fleetos-submission-key-probe": "sessionStorage (mort avec l'onglet)",
  "fleetos-submission-key-": "sessionStorage (mort avec l'onglet)",
};

/** Fichiers autorisés à toucher localStorage directement : un nouveau fichier doit être classé ici. */
const LOCAL_STORAGE_FILES = new Set([
  "lib/form-draft-storage.ts",
  "lib/gps-tracking.ts",
  "hooks/use-gps-tracking.ts",
  "lib/offline-kv.ts",
  "lib/offline-queue.ts",
  "lib/pending-logout.ts",
  "components/maintenance/work-order-form.tsx", // currentVehicleRegistration : clé globale, purgée à la déconnexion
  "pages/maintenance/work-orders/new.tsx", // idem
]);

let map: Map<string, string>;
beforeEach(() => {
  idb.dbs.clear();
  map = new Map();
  vi.stubGlobal("navigator", { onLine: false });
  vi.stubGlobal("indexedDB", {
    databases: async () => [],
    deleteDatabase: () => {
      const request: { onsuccess?: () => void } = {};
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  });
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    localStorage: {
      get length() {
        return map.size;
      },
      key: (i: number) => Array.from(map.keys())[i] ?? null,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    },
  });
  setActiveOfflineUserId(null);
});

/** Identifiants de formulaire réellement déclarés dans le code (`formId: "..."`), jamais une liste recopiée. */
function declaredFormIds(): string[] {
  const ids = new Set<string>();
  for (const { text } of files) {
    for (const match of text.matchAll(/formId:\s*(?:"([^"]+)"|`([^`]+)`)/g)) {
      ids.add((match[1] ?? match[2]).replace(/\$\{[^}]*\}/g, "1"));
    }
  }
  return Array.from(ids);
}

function writeUserKeys(userId: number): string[] {
  window.localStorage.setItem(gpsBufferKey(userId, 11), "[]");
  window.localStorage.setItem(gpsBufferKey(userId, 12), "[]");
  for (const formId of declaredFormIds()) {
    createFormDraftStorage<{ x: number }>({ formId, version: 1 }).save(userId, { data: { x: 1 }, savedAt: "2026-11-10T00:00:00Z" });
  }
  return Array.from(map.keys()).filter((key) => key.endsWith(`-${userId}`) || key.includes(`-u${userId}-`));
}

describe("changement de compte : les clés propres à l'ancien compte", () => {
  it("le test voit bien des clés GPS et des brouillons (garde-fou du test lui-même)", () => {
    const keys = writeUserKeys(7);
    expect(keys.some((k) => k.startsWith("fleetos-gps-buffer-"))).toBe(true);
    expect(declaredFormIds().length).toBeGreaterThanOrEqual(4);
    expect(keys.length).toBeGreaterThan(declaredFormIds().length);
  });

  it("chaque clé de A est purgée par activateOfflineUser(B), sauf la liste gelée, qui ne peut que diminuer", () => {
    setActiveOfflineUserId(7);
    const keysOfA = writeUserKeys(7);
    const keysOfB = writeUserKeys(8);

    activateOfflineUser(new QueryClient(), 8, { broadcast: false });

    const survivors = keysOfA.filter((key) => map.has(key));
    const unexplained = survivors.filter((key) => !FROZEN_UNPURGED.some((rule) => rule.matches(key)));
    expect(unexplained, "clé(s) de l'ancien compte non purgée(s) au changement de compte : purger, ou geler ici avec justification").toEqual([]);

    // La liste ne peut que diminuer : une règle qui ne retient plus aucune clé doit être retirée.
    for (const rule of FROZEN_UNPURGED) {
      expect(survivors.some((key) => rule.matches(key)), `« ${rule.label} » est désormais purgé : retirer la règle de FROZEN_UNPURGED`).toBe(true);
    }
    // Le compte qui arrive ne perd rien.
    expect(keysOfB.filter((key) => !map.has(key))).toEqual([]);
  });
});

describe("classement automatique des clés de stockage", () => {
  it("toute famille `fleetos-*` du code est classée", () => {
    const found = new Set<string>();
    for (const { text } of files) {
      for (const match of text.matchAll(/["'`](fleetos-[A-Za-z0-9:_-]*)/g)) found.add(match[1]);
    }
    const unclassified = Array.from(found).filter((literal) => !(literal in KNOWN_FLEETOS_LITERALS));
    expect(unclassified, "nouvelle clé `fleetos-*` : la classer (propre à un compte ? purgée au changement de compte ?) dans ce test").toEqual([]);
  });

  it("tout fichier qui touche localStorage est classé", () => {
    const users = files
      .filter(({ text }) => text.split("\n").some((line) => /\blocalStorage\b/.test(line) && !/^\s*(\/\/|\/?\*)/.test(line)))
      .map(({ path }) => path)
      .filter((path) => !LOCAL_STORAGE_FILES.has(path));
    expect(users, "nouveau fichier qui écrit dans localStorage : ses clés propres à un utilisateur doivent être purgées au changement de compte").toEqual([]);
  });
});
