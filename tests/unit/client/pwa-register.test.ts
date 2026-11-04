import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerPwaServiceWorker } from "../../../client/src/lib/pwa-register";

describe("enregistrement du service worker PWA", () => {
  const register = vi.fn(async () => ({}));
  const unregister = vi.fn(async () => true);
  const getRegistrations = vi.fn(async () => [{ unregister }, { unregister }]);
  let loadHandler: (() => void) | undefined;
  let cacheNames: string[] = [];
  const deleted: string[] = [];

  beforeEach(() => {
    register.mockClear();
    unregister.mockClear();
    getRegistrations.mockClear();
    loadHandler = undefined;
    vi.stubGlobal("window", {
      addEventListener: (type: string, handler: () => void) => {
        if (type === "load") loadHandler = handler;
      },
    });
    vi.stubGlobal("navigator", { serviceWorker: { register, getRegistrations } });
    cacheNames = ["fleetos-static-v2", "fleetos-tech-v1.0.0", "workbox-autre-app"];
    deleted.length = 0;
    vi.stubGlobal("caches", {
      keys: async () => cacheNames,
      delete: async (name: string) => void deleted.push(name),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("en développement : n'enregistre rien et retire les workers déjà installés", async () => {
    registerPwaServiceWorker({ isProd: false });
    loadHandler?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(register).not.toHaveBeenCalled();
    // Seuls les caches de l'application sont vidés
    expect(deleted).toEqual(["fleetos-static-v2", "fleetos-tech-v1.0.0"]);
    expect(getRegistrations).toHaveBeenCalledTimes(1);
    expect(unregister).toHaveBeenCalledTimes(2);
  });

  it("en production : enregistre /sw.js sans rien retirer", () => {
    registerPwaServiceWorker({ isProd: true });
    loadHandler?.();

    expect(register).toHaveBeenCalledWith("/sw.js");
    expect(getRegistrations).not.toHaveBeenCalled();
  });

  it("en développement avec opt-in explicite : enregistre /sw.js", () => {
    registerPwaServiceWorker({ isProd: false, forceEnable: true });
    loadHandler?.();

    expect(register).toHaveBeenCalledWith("/sw.js");
    expect(unregister).not.toHaveBeenCalled();
  });
});
