import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-error";
import { createSubmissionKeyStore, isIndeterminateOutcome, missionFuelKeyScope } from "@/lib/submission-key";

/**
 * Clé d'un envoi qui débite la carte carburant (LESSONS_LEARNED, 3 novembre 2026) :
 * une issue inconnue (réseau, 5xx) CONSERVE la clé, sinon un nouvel envoi après une
 * coupure débite une seconde fois. Libérée au succès, sur un 4xx, à l'annulation.
 */
function fakeStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const networkError = new TypeError("Failed to fetch");
const serverError = new ApiError(502, "Service indisponible", null);
const clientError = new ApiError(400, "Données invalides", null);
const conflict = new ApiError(409, "Plein déjà enregistré", null);

describe("isIndeterminateOutcome", () => {
  it.each([
    ["réseau", networkError, true],
    ["5xx", serverError, true],
    ["500", new ApiError(500, "x", null), true],
    ["400", clientError, false],
    ["409", conflict, false],
  ])("%s", (_label, error, expected) => {
    expect(isIndeterminateOutcome(error)).toBe(expected);
  });
});

describe("createSubmissionKeyStore", () => {
  const scope = missionFuelKeyScope(42);

  it("la même clé est renvoyée tant que l'envoi n'est pas réglé", () => {
    const store = createSubmissionKeyStore(scope, fakeStorage());
    expect(store.take()).toBe(store.take());
  });

  it.each([
    ["réseau", networkError],
    ["5xx", serverError],
  ])("issue inconnue (%s) : clé conservée, même après annulation et rechargement", (_label, error) => {
    const storage = fakeStorage();
    const first = createSubmissionKeyStore(scope, storage);
    const key = first.take();
    first.settle(error);
    first.discard();
    expect(first.take()).toBe(key);

    // Rechargement de la page : nouvelle instance, même stockage.
    const reloaded = createSubmissionKeyStore(scope, storage);
    expect(reloaded.take()).toBe(key);
  });

  it.each([
    ["succès", undefined],
    ["400", clientError],
    ["409", conflict],
  ])("issue connue (%s) : clé libérée, l'envoi suivant en prend une nouvelle", (_label, error) => {
    const store = createSubmissionKeyStore(scope, fakeStorage());
    const key = store.take();
    store.settle(error);
    expect(store.take()).not.toBe(key);
  });

  it("issue inconnue puis succès du rejeu : clé libérée", () => {
    const store = createSubmissionKeyStore(scope, fakeStorage());
    const key = store.take();
    store.settle(networkError);
    expect(store.take()).toBe(key);
    store.settle();
    expect(store.take()).not.toBe(key);
  });

  it("annulation sans envoi incertain : clé libérée", () => {
    const store = createSubmissionKeyStore(scope, fakeStorage());
    const key = store.take();
    store.discard();
    expect(store.take()).not.toBe(key);
  });

  it("une clé par mission", () => {
    const storage = fakeStorage();
    const a = createSubmissionKeyStore(missionFuelKeyScope(1), storage);
    const b = createSubmissionKeyStore(missionFuelKeyScope(2), storage);
    expect(a.take()).not.toBe(b.take());
  });

  it("stockage corrompu ou refusé : pas d'exception, une clé quand même", () => {
    const broken = {
      getItem: () => "{pas du json",
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => undefined,
    };
    const store = createSubmissionKeyStore(scope, broken);
    const key = store.take();
    expect(typeof key).toBe("string");
    store.settle(networkError);
    expect(store.take()).toBe(key);
  });

  const fillA = { quantity: 40, unitPrice: 840, stationName: "Total Akwa", notes: null };
  const fillB = { ...fillA, quantity: 35 };

  it("issue incertaine puis MÊME saisie (fiche rouverte) : même clé, le serveur rejoue", () => {
    const storage = fakeStorage();
    const store = createSubmissionKeyStore(scope, storage);
    const key = store.take(fillA);
    store.settle(networkError);
    store.discard();
    expect(createSubmissionKeyStore(scope, storage).take({ ...fillA })).toBe(key);
  });

  it("issue incertaine puis AUTRE saisie : nouvelle clé (nouvelle intention, pas de 409)", () => {
    const store = createSubmissionKeyStore(scope, fakeStorage());
    const key = store.take(fillA);
    store.settle(serverError);
    store.discard();
    const next = store.take(fillB);
    expect(next).not.toBe(key);
    // La nouvelle clé n'hérite pas de l'incertitude : une annulation la libère.
    store.discard();
    expect(store.take(fillB)).not.toBe(next);
  });

  it("envoi non réglé (double clic) : même clé, même si l'empreinte change", () => {
    const store = createSubmissionKeyStore(scope, fakeStorage());
    expect(store.take(fillA)).toBe(store.take(fillB));
  });
});
