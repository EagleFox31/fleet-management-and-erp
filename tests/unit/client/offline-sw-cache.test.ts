import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

/** Évalue le vrai `client/public/sw.js` dans un contexte simulé. */
function loadServiceWorker() {
  type Handler = (event: Record<string, unknown>) => void;
  const handlers = new Map<string, Handler>();
  const caches = new Map<string, Map<string, unknown>>();
  const calls = { cachePut: [] as string[], cachesOpen: [] as string[], fetched: [] as string[] };

  const cacheOf = (name: string) => {
    if (!caches.has(name)) caches.set(name, new Map());
    const store = caches.get(name)!;
    return {
      addAll: async (urls: string[]) => urls.forEach((u) => store.set(new URL(u, "https://app.test").href, "static")),
      put: async (request: { url: string }, response: unknown) => {
        calls.cachePut.push(`${name}|${new URL(request.url).pathname}`);
        store.set(request.url, response);
      },
      keys: async () => Array.from(store.keys()).map((url) => ({ url })),
      delete: async (request: { url: string }) => store.delete(request.url),
    };
  };

  const context = {
    URL,
    console,
    Promise,
    self: {
      addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
      skipWaiting: async () => undefined,
      clients: { claim: async () => undefined },
      location: { origin: "https://app.test" },
    },
    caches: {
      open: async (name: string) => {
        calls.cachesOpen.push(name);
        return cacheOf(name);
      },
      keys: async () => Array.from(caches.keys()),
      delete: async (name: string) => caches.delete(name),
      match: async (request: { url: string }) => {
        for (const store of caches.values()) if (store.has(request.url)) return store.get(request.url);
        return undefined;
      },
    },
    fetch: async (request: { url: string }) => {
      calls.fetched.push(request.url);
      return { status: 200, clone() { return this; } };
    },
  };
  vm.runInNewContext(readFileSync(path.resolve("client/public/sw.js"), "utf8"), context);

  const dispatch = async (type: string, extra: Record<string, unknown> = {}) => {
    const waits: Promise<unknown>[] = [];
    let responded = false;
    const event = {
      ...extra,
      waitUntil: (p: Promise<unknown>) => void waits.push(p),
      respondWith: (p: Promise<unknown>) => {
        responded = true;
        waits.push(p);
      },
    };
    handlers.get(type)!(event);
    await Promise.all(waits);
    return { responded };
  };
  return { caches, calls, dispatch };
}

describe("service worker : aucune réponse /api/* en Cache Storage", () => {
  const getRequest = (pathname: string) => ({
    url: `https://app.test${pathname}`,
    method: "GET",
    mode: "cors",
  });

  it("n'intercepte pas un GET /api/* et n'écrit rien dans le cache", async () => {
    const sw = loadServiceWorker();
    await sw.dispatch("install");
    sw.calls.cachePut.length = 0;
    sw.calls.cachesOpen.length = 0;

    const result = await sw.dispatch("fetch", { request: getRequest("/api/technician/my-work-orders") });

    expect(result.responded).toBe(false);
    expect(sw.calls.cachePut).toEqual([]);
    expect(sw.calls.cachesOpen).toEqual([]);
    expect(sw.calls.fetched).toEqual([]);
  });

  it("garde le cache des assets statiques", async () => {
    const sw = loadServiceWorker();
    await sw.dispatch("install");

    const result = await sw.dispatch("fetch", { request: getRequest("/assets/index-abc.js") });
    await new Promise((resolve) => setTimeout(resolve, 0)); // l'écriture en cache n'est pas attendue par le worker

    expect(result.responded).toBe(true);
    expect(sw.calls.cachePut).toEqual(["fleetos-static-v2|/assets/index-abc.js"]);
  });

  it("à l'activation, supprime les anciens caches (réponses API comprises)", async () => {
    const sw = loadServiceWorker();
    // État d'un téléphone installé avant la mise à jour : cache v1 avec des réponses API
    sw.caches.set(
      "fleetos-tech-v1.0.0",
      new Map<string, unknown>([["https://app.test/api/technician/my-work-orders", { secret: "A" }]]),
    );
    // Et une entrée /api/* égarée dans le cache courant
    sw.caches.set(
      "fleetos-static-v2",
      new Map<string, unknown>([
        ["https://app.test/api/auth/me", { secret: "A" }],
        ["https://app.test/index.html", "static"],
      ]),
    );

    await sw.dispatch("activate");

    expect(Array.from(sw.caches.keys())).toEqual(["fleetos-static-v2"]);
    expect(Array.from(sw.caches.get("fleetos-static-v2")!.keys())).toEqual(["https://app.test/index.html"]);
  });
});

describe("service worker : détection de /api insensible à la casse", () => {
  const getRequest = (pathname: string) => ({ url: `https://app.test${pathname}`, method: "GET", mode: "cors" });

  it.each(["/API/auth/me", "/Api/technician/my-work-orders", "/api//auth/me", "//api/auth/me", "/api"])(
    "n'intercepte pas %s",
    async (pathname) => {
      const sw = loadServiceWorker();
      await sw.dispatch("install");
      sw.calls.cachePut.length = 0;

      const result = await sw.dispatch("fetch", { request: getRequest(pathname) });

      expect(result.responded).toBe(false);
      expect(sw.calls.cachePut).toEqual([]);
    },
  );

  it("ne prend pas pour une API un asset dont le nom commence par api", async () => {
    const sw = loadServiceWorker();
    await sw.dispatch("install");
    const result = await sw.dispatch("fetch", { request: getRequest("/apidocs/index.html") });
    expect(result.responded).toBe(true);
  });

  it("à l'activation, supprime aussi une entrée /API/ égarée dans le cache courant", async () => {
    const sw = loadServiceWorker();
    sw.caches.set(
      "fleetos-static-v2",
      new Map<string, unknown>([
        ["https://app.test/API/auth/me", { secret: "A" }],
        ["https://app.test/index.html", "static"],
      ]),
    );
    await sw.dispatch("activate");
    expect(Array.from(sw.caches.get("fleetos-static-v2")!.keys())).toEqual(["https://app.test/index.html"]);
  });
});
