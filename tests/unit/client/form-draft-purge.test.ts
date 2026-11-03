import { describe, expect, it } from "vitest";
import { purgeBrowserUserState } from "@/lib/form-draft-storage";

function fakeLocalStorage(initial: Record<string, string>) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    storage: {
      get length() {
        return map.size;
      },
      key: (i: number) => Array.from(map.keys())[i] ?? null,
      removeItem: (k: string) => void map.delete(k),
    },
  };
}

describe("purge des brouillons à la déconnexion", () => {
  it("efface les brouillons de tous les comptes et la saisie globale, garde le reste", () => {
    const { map, storage } = fakeLocalStorage({
      "fleetos-work-order-form-v1-12": "{}",
      "fleetos-tire-wizard-draft-v2-7": "{}",
      "fleetos-incident-new-v1-anonymous": "{}",
      "fleetos-work-order-item-45-v1-12": "{}",
      currentVehicleRegistration: "AB-123-CD",
      "fleetos-pending-server-logout": "1",
      "fleetos-offline-db-registry": "[]",
      theme: "dark",
    });

    const purged = purgeBrowserUserState(storage);

    expect(purged).toBe(4);
    expect(Array.from(map.keys()).sort()).toEqual(["fleetos-offline-db-registry", "fleetos-pending-server-logout", "theme"]);
  });

  it("ne lève pas si le stockage est indisponible", () => {
    expect(purgeBrowserUserState(null)).toBe(0);
    expect(
      purgeBrowserUserState({
        length: 1,
        key: () => {
          throw new Error("denied");
        },
        removeItem: () => undefined,
      }),
    ).toBe(0);
  });
});
