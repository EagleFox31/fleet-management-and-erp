import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { injectShellManifest, type ShellManifest } from "../../../scripts/lib/sw-shell";

const ORIGIN = "https://app.test";
const absolute = (input: unknown): string => new URL(typeof input === "string" ? input : (input as { url: string }).url, ORIGIN).href;

interface LoadOptions {
  /** Manifeste injecté comme le fait le plugin de build ; absent : worker de développement. */
  manifest?: ShellManifest;
  /** Réseau coupé : tout fetch est rejeté. */
  offline?: boolean;
  /** Réseau qui ne répond jamais (le délai de navigation doit prendre le relais). */
  hanging?: boolean;
}

/** Évalue le vrai `client/public/sw.js` dans un contexte simulé. */
function loadServiceWorker(options: LoadOptions = {}) {
  type Handler = (event: Record<string, unknown>) => void;
  const handlers = new Map<string, Handler>();
  const caches = new Map<string, Map<string, unknown>>();
  const calls = { cachePut: [] as string[], cachesOpen: [] as string[], fetched: [] as string[], fetchInits: [] as unknown[] };
  const network = { offline: options.offline === true, hanging: options.hanging === true };

  const cacheOf = (name: string) => {
    if (!caches.has(name)) caches.set(name, new Map());
    const store = caches.get(name)!;
    return {
      put: async (request: unknown, response: unknown) => {
        calls.cachePut.push(`${name}|${new URL(absolute(request)).pathname}`);
        store.set(absolute(request), response);
      },
      match: async (request: unknown) => store.get(absolute(request)),
      keys: async () => Array.from(store.keys()).map((url) => ({ url })),
      delete: async (request: { url: string }) => store.delete(request.url),
    };
  };

  const source = options.manifest
    ? injectShellManifest(readFileSync(path.resolve("client/public/sw.js"), "utf8"), options.manifest)
    : readFileSync(path.resolve("client/public/sw.js"), "utf8");

  const context = {
    URL,
    console,
    Promise,
    setTimeout,
    Response: { error: () => ({ status: 0, type: "error" }) },
    self: {
      addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
      skipWaiting: async () => undefined,
      clients: { claim: async () => undefined },
      location: { origin: ORIGIN },
    },
    caches: {
      open: async (name: string) => {
        calls.cachesOpen.push(name);
        return cacheOf(name);
      },
      keys: async () => Array.from(caches.keys()),
      delete: async (name: string) => caches.delete(name),
    },
    fetch: async (input: unknown, init?: unknown) => {
      const url = absolute(input);
      calls.fetched.push(url);
      calls.fetchInits.push(init);
      if (network.hanging) return new Promise(() => undefined);
      if (network.offline) throw new TypeError("Failed to fetch");
      return { status: 200, body: `réseau:${url}`, clone() { return this; } };
    },
  };
  vm.runInNewContext(source, context);

  const dispatch = async (type: string, extra: Record<string, unknown> = {}) => {
    const waits: Promise<unknown>[] = [];
    let responded = false;
    let response: Promise<unknown> | undefined;
    const event = {
      ...extra,
      waitUntil: (p: Promise<unknown>) => void waits.push(p),
      respondWith: (p: Promise<unknown>) => {
        responded = true;
        response = p;
        waits.push(p.catch(() => undefined));
      },
    };
    handlers.get(type)!(event);
    await Promise.all(waits);
    return { responded, response: response ? await response : undefined };
  };
  return { caches, calls, dispatch, network };
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
    sw.calls.fetched.length = 0;

    const result = await sw.dispatch("fetch", { request: getRequest("/api/technician/my-work-orders") });

    expect(result.responded).toBe(false);
    expect(sw.calls.cachePut).toEqual([]);
    expect(sw.calls.cachesOpen).toEqual([]);
    expect(sw.calls.fetched).toEqual([]);
  });

  it("garde le cache des assets statiques", async () => {
    const sw = loadServiceWorker();
    await sw.dispatch("install");
    sw.calls.cachePut.length = 0;

    const result = await sw.dispatch("fetch", { request: getRequest("/assets/index-abc.js") });
    await new Promise((resolve) => setTimeout(resolve, 0)); // l'écriture en cache n'est pas attendue par le worker

    expect(result.responded).toBe(true);
    expect(sw.calls.cachePut).toEqual(["fleetos-shell-dev|/assets/index-abc.js"]);
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
      "fleetos-shell-dev",
      new Map<string, unknown>([
        ["https://app.test/api/auth/me", { secret: "A" }],
        ["https://app.test/index.html", "static"],
      ]),
    );

    await sw.dispatch("activate");

    expect(Array.from(sw.caches.keys())).toEqual(["fleetos-shell-dev"]);
    expect(Array.from(sw.caches.get("fleetos-shell-dev")!.keys())).toEqual(["https://app.test/index.html"]);
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
      "fleetos-shell-dev",
      new Map<string, unknown>([
        ["https://app.test/API/auth/me", { secret: "A" }],
        ["https://app.test/index.html", "static"],
      ]),
    );
    await sw.dispatch("activate");
    expect(Array.from(sw.caches.get("fleetos-shell-dev")!.keys())).toEqual(["https://app.test/index.html"]);
  });
});

describe("service worker : la revalidation en arrière-plan ne sature pas les connexions", () => {
  // Régression e2e 02/05/21 : chaque module en cache était re-téléchargé à chaque
  // chargement (des centaines avec Vite), les appels /api/* de la page attendaient
  // derrière sur les 6 connexions du navigateur et /api/auth/me dépassait 10 s.
  const getRequest = (pathname: string, mode = "cors") => ({
    url: `https://app.test${pathname}`,
    method: "GET",
    mode,
  });

  it("ne revalide pas un module déjà en cache", async () => {
    const sw = loadServiceWorker();
    await sw.dispatch("install");
    await sw.dispatch("fetch", { request: getRequest("/src/pages/dashboard.tsx") });
    sw.calls.fetched.length = 0;

    const result = await sw.dispatch("fetch", { request: getRequest("/src/pages/dashboard.tsx") });

    expect(result.responded).toBe(true);
    expect(sw.calls.fetched).toEqual([]);
  });

  it("revalide la coque statique non empreintée, jamais la navigation dans le cache", async () => {
    const sw = loadServiceWorker();
    await sw.dispatch("install");
    sw.calls.fetched.length = 0;
    sw.calls.cachePut.length = 0;

    await sw.dispatch("fetch", { request: getRequest("/manifest.json") });
    await sw.dispatch("fetch", { request: getRequest("/vehicles", "navigate") });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sw.calls.fetched).toEqual(["https://app.test/manifest.json", "https://app.test/vehicles"]);
    // La réponse de navigation n'est pas écrite : l'index.html du cache reste celui du build précaché.
    expect(sw.calls.cachePut).toEqual(["fleetos-shell-dev|/manifest.json"]);
  });
});

const MANIFEST: ShellManifest = { build: "abc1234567", assets: ["/assets/index-AAA.js", "/assets/index-BBB.css", "/assets/font-CCC.woff2"] };
const SHELL = "fleetos-shell-abc1234567";
const navigate = (pathname: string) => ({ url: `${ORIGIN}${pathname}`, method: "GET", mode: "navigate" });
const asset = (pathname: string) => ({ url: `${ORIGIN}${pathname}`, method: "GET", mode: "cors" });

describe("service worker : précache de la coquille du build (V5b-3d)", () => {
  it("nomme le cache d'après le build injecté", async () => {
    const sw = loadServiceWorker({ manifest: MANIFEST });
    await sw.dispatch("install");
    expect(Array.from(sw.caches.keys())).toEqual([SHELL]);
  });

  it("à l'installation, télécharge hors cache HTTP et écrit la coquille fixe et tous les assets du build", async () => {
    const sw = loadServiceWorker({ manifest: MANIFEST });
    await sw.dispatch("install");

    const cached = Array.from(sw.caches.get(SHELL)!.keys()).map((url) => new URL(url).pathname).sort();
    expect(cached).toEqual(["/", "/index.html", "/manifest.json", "/favicon.jpg", "/logo.jpg", ...MANIFEST.assets].sort());
    expect(sw.calls.fetchInits.every((init) => (init as { cache?: string }).cache === "reload")).toBe(true);
  });

  it("ne met aucune réponse /api/* dans la coquille", async () => {
    const sw = loadServiceWorker({ manifest: MANIFEST });
    await sw.dispatch("install");
    await sw.dispatch("fetch", { request: asset("/api/auth/me") });
    const paths = Array.from(sw.caches.get(SHELL)!.keys()).map((url) => new URL(url).pathname);
    expect(paths.filter((p) => /^\/api(\/|$)/i.test(p))).toEqual([]);
  });

  it("l'installation échoue si une ressource manque (pas de coquille partielle)", async () => {
    const sw = loadServiceWorker({ manifest: MANIFEST, offline: true });
    await expect(sw.dispatch("install")).rejects.toThrow();
  });

  it("sans manifeste (développement) : coquille fixe seulement, nom de cache stable", async () => {
    const sw = loadServiceWorker();
    await sw.dispatch("install");
    expect(Array.from(sw.caches.keys())).toEqual(["fleetos-shell-dev"]);
    expect(sw.calls.fetched).toHaveLength(5);
  });
});

describe("service worker : navigation hors ligne (V5b-3d)", () => {
  it("coupure juste après l'installation : n'importe quelle route de l'app sert l'index.html du cache", async () => {
    const sw = loadServiceWorker({ manifest: MANIFEST });
    await sw.dispatch("install");
    await sw.dispatch("activate");
    sw.network.offline = true;

    for (const route of ["/", "/login", "/missions/12", "/driver/dashboard"]) {
      const result = await sw.dispatch("fetch", { request: navigate(route) });
      expect(result.responded).toBe(true);
      expect(result.response).toMatchObject({ body: `réseau:${ORIGIN}/index.html` });
    }
  });

  it("hors ligne, un asset précaché est servi sans réseau", async () => {
    const sw = loadServiceWorker({ manifest: MANIFEST });
    await sw.dispatch("install");
    sw.network.offline = true;
    sw.calls.fetched.length = 0;

    const result = await sw.dispatch("fetch", { request: asset("/assets/index-AAA.js") });
    expect(result.response).toMatchObject({ body: `réseau:${ORIGIN}/assets/index-AAA.js` });
    expect(sw.calls.fetched).toEqual([]);
  });

  it("réseau qui ne répond pas : la coquille en cache prend le relais après le délai", async () => {
    const sw = loadServiceWorker({ manifest: MANIFEST });
    await sw.dispatch("install");
    sw.network.hanging = true;
    const result = await sw.dispatch("fetch", { request: navigate("/missions") });
    expect(result.response).toMatchObject({ body: `réseau:${ORIGIN}/index.html` });
  }, 10_000);

  it("en ligne, la navigation prend l'index.html du réseau sans l'écrire dans le cache", async () => {
    const sw = loadServiceWorker({ manifest: MANIFEST });
    await sw.dispatch("install");
    sw.calls.cachePut.length = 0;
    const result = await sw.dispatch("fetch", { request: navigate("/missions") });
    expect(result.response).toMatchObject({ body: `réseau:${ORIGIN}/missions` });
    expect(sw.calls.cachePut).toEqual([]);
  });

  it("hors ligne sans coquille : réponse d'erreur réseau, pas d'exception du worker", async () => {
    const sw = loadServiceWorker({ manifest: MANIFEST, offline: true });
    const result = await sw.dispatch("fetch", { request: navigate("/missions") });
    expect(result.response).toMatchObject({ type: "error" });
  });
});

describe("service worker : versionnage et nettoyage à l'activation (V5b-3d)", () => {
  it("supprime les anciennes coquilles (build précédent, anciens noms) et laisse les autres caches", async () => {
    const sw = loadServiceWorker({ manifest: MANIFEST });
    sw.caches.set("fleetos-shell-old0000000", new Map([["https://app.test/index.html", "ancien"]]));
    sw.caches.set("fleetos-static-v2", new Map([["https://app.test/index.html", "v2"]]));
    sw.caches.set("fleetos-tech-v1.0.0", new Map([["https://app.test/api/technician/my-work-orders", "A"]]));
    sw.caches.set("fleetos-offline-u12", new Map([["donnees", "utilisateur 12"]]));
    sw.caches.set("workbox-runtime", new Map([["x", "y"]]));
    await sw.dispatch("install");

    await sw.dispatch("activate");

    expect(Array.from(sw.caches.keys()).sort()).toEqual(["fleetos-offline-u12", SHELL, "workbox-runtime"].sort());
    expect(sw.caches.get("fleetos-offline-u12")!.get("donnees")).toBe("utilisateur 12");
  });

  it("garde la coquille courante intacte (même build réinstallé)", async () => {
    const sw = loadServiceWorker({ manifest: MANIFEST });
    await sw.dispatch("install");
    const before = Array.from(sw.caches.get(SHELL)!.keys()).sort();
    await sw.dispatch("activate");
    expect(Array.from(sw.caches.get(SHELL)!.keys()).sort()).toEqual(before);
  });

  it("deux builds ont deux caches distincts : chacun sert l'index.html de son build", async () => {
    const first = loadServiceWorker({ manifest: MANIFEST });
    await first.dispatch("install");
    const second = loadServiceWorker({ manifest: { build: "zzz9999999", assets: ["/assets/index-NEW.js"] } });
    await second.dispatch("install");
    expect(Array.from(second.caches.keys())).toEqual(["fleetos-shell-zzz9999999"]);
    expect(Array.from(second.caches.get("fleetos-shell-zzz9999999")!.keys()).map((u) => new URL(u).pathname)).toContain("/assets/index-NEW.js");
    expect(Array.from(first.caches.get(SHELL)!.keys()).map((u) => new URL(u).pathname)).not.toContain("/assets/index-NEW.js");
  });
});
