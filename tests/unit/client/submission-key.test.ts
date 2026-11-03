import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-error";
import { createSubmissionKeyStore, IDEMPOTENCY_HEADER, isIndeterminateOutcome, missionFuelKeyScope, partStockKeyScope, sendWithSubmissionKey } from "@/lib/submission-key";

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
    expect(first.hasUncertainSubmission()).toBe(true);
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
    expect(store.hasUncertainSubmission()).toBe(false);
    expect(store.take()).not.toBe(key);
  });

  it("issue inconnue puis succès du rejeu : clé libérée", () => {
    const store = createSubmissionKeyStore(scope, fakeStorage());
    const key = store.take();
    store.settle(networkError);
    expect(store.take()).toBe(key);
    store.settle();
    expect(store.hasUncertainSubmission()).toBe(false);
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
});

describe("sendWithSubmissionKey (ajustement de stock)", () => {
  it("l'en-tête client est celui que lit la garde serveur", async () => {
    const server = await import("../../../server/lib/idempotency-config");
    expect(IDEMPOTENCY_HEADER).toBe(server.IDEMPOTENCY_HEADER);
  });

  it("issue inconnue : le réessai de la même intention renvoie la même clé", async () => {
    const storage = fakeStorage();
    const scope = partStockKeyScope(7, 3);
    const keys: string[] = [];
    await expect(sendWithSubmissionKey(scope, async (k) => { keys.push(k); throw serverError; }, storage)).rejects.toBe(serverError);
    await expect(sendWithSubmissionKey(scope, async (k) => { keys.push(k); throw networkError; }, storage)).rejects.toBe(networkError);
    await sendWithSubmissionKey(scope, async (k) => { keys.push(k); return "ok"; }, storage);
    expect(new Set(keys).size).toBe(1);
    expect(storage.map.size).toBe(0);
  });

  it("nouvelle intention : nouvelle clé (après succès, autre quantité, autre pièce, refus 4xx)", async () => {
    const storage = fakeStorage();
    const keys: string[] = [];
    const record = async (k: string) => { keys.push(k); return k; };
    await sendWithSubmissionKey(partStockKeyScope(7, 3), record, storage);
    await sendWithSubmissionKey(partStockKeyScope(7, 3), record, storage);
    await sendWithSubmissionKey(partStockKeyScope(7, -3), record, storage);
    await sendWithSubmissionKey(partStockKeyScope(8, 3), record, storage);
    await expect(sendWithSubmissionKey(partStockKeyScope(9, 1), async (k) => { keys.push(k); throw conflict; }, storage)).rejects.toBe(conflict);
    await sendWithSubmissionKey(partStockKeyScope(9, 1), record, storage);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("une intention en suspens ne bloque pas une autre intention", async () => {
    const storage = fakeStorage();
    const stuck = partStockKeyScope(7, 3);
    let stuckKey = "";
    await expect(sendWithSubmissionKey(stuck, async (k) => { stuckKey = k; throw serverError; }, storage)).rejects.toBe(serverError);
    const other = await sendWithSubmissionKey(partStockKeyScope(7, 5), async (k) => k, storage);
    expect(other).not.toBe(stuckKey);
    expect(createSubmissionKeyStore(stuck, storage).hasUncertainSubmission()).toBe(true);
  });
});
