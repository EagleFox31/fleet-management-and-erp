import { describe, expect, it } from "vitest";
import {
  fetchAllPages,
  fetchAllUsers,
  fetchAllVehicles,
  fetchFuelRecords,
  REPORT_MAX_USERS,
  ReportRefusedError,
  reportErrorContext,
} from "@/lib/fetch-all-pages";
import { userMessageOf } from "@/lib/api-error";

/**
 * Rapports PDF : `GET /api/vehicles` plafonne à 1000 par appel. Un seul appel `limit=1000`
 * omettait les véhicules suivants sans le dire. Lecture page par page, même règle que les OT.
 */
const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));

function fakeVehicles(all: { id: number }[], { failAtOffset }: { failAtOffset?: number } = {}) {
  const calls: string[] = [];
  const fetchFn = async (url: string) => {
    calls.push(url);
    const params = new URL(url, "http://x").searchParams;
    const limit = Number(params.get("limit") ?? 10);
    const offset = Number(params.get("offset") ?? 0);
    if (offset === failAtOffset) return { ok: false, status: 500, json: async () => ({ message: "x" }) };
    return { ok: true, status: 200, json: async () => ({ vehicles: all.slice(offset, offset + limit), total: all.length }) };
  };
  return { fetchFn, calls };
}

describe("lecture complète des véhicules pour un rapport", () => {
  it("2 500 véhicules : 3 pages de 1000, tous lus", async () => {
    const { fetchFn, calls } = fakeVehicles(items(2500));
    await expect(fetchAllVehicles(fetchFn)).resolves.toHaveLength(2500);
    expect(calls).toEqual([
      "/api/vehicles?limit=1000&offset=0",
      "/api/vehicles?limit=1000&offset=1000",
      "/api/vehicles?limit=1000&offset=2000",
    ]);
  });

  it("échec en page 2 : refus avec un message lisible", async () => {
    const { fetchFn } = fakeVehicles(items(2500), { failAtOffset: 1000 });
    const error = await fetchAllVehicles(fetchFn).catch((e) => e);
    expect(error).toBeInstanceOf(ReportRefusedError);
    expect(userMessageOf(error, "repli")).toMatch(/Les véhicules n'ont pas pu être lus en entier/);
    // Statut HTTP gardé pour les logs (`reportErrorContext`), jamais dans le message affiché.
    expect(error.detail).toEqual({ path: "/api/vehicles", reason: "http", status: 500, offset: 1000 });
    expect(reportErrorContext(error)).toEqual({ err: error, refusal: error.detail });
    expect(userMessageOf(error, "repli")).not.toMatch(/500/);
  });

  it("véhicule répété d'une page à l'autre : refus", async () => {
    const all = items(1500);
    const fetchFn = async (url: string) => {
      const offset = Number(new URL(url, "http://x").searchParams.get("offset"));
      const page = offset === 0 ? all.slice(0, 1000) : [all[999], ...all.slice(1001)];
      return { ok: true, status: 200, json: async () => ({ vehicles: page, total: 1500 }) };
    };
    const error = await fetchAllVehicles(fetchFn).catch((e) => e);
    expect(error).toBeInstanceOf(ReportRefusedError);
    expect(error.detail).toMatchObject({ reason: "incomplete", total: 1500, received: 1499 });
  });

  it("total qui change en cours de lecture : refus", async () => {
    const all = items(1500);
    const fetchFn = async (url: string) => {
      const offset = Number(new URL(url, "http://x").searchParams.get("offset"));
      return { ok: true, status: 200, json: async () => ({ vehicles: all.slice(offset, offset + 1000), total: offset ? 1501 : 1500 }) };
    };
    await expect(fetchAllVehicles(fetchFn)).rejects.toBeInstanceOf(ReportRefusedError);
  });

  it("page vide avant le total annoncé : refus", async () => {
    const all = items(1200);
    const fetchFn = async (url: string) => {
      const offset = Number(new URL(url, "http://x").searchParams.get("offset"));
      return { ok: true, status: 200, json: async () => ({ vehicles: offset ? [] : all.slice(0, 1000), total: 1200 }) };
    };
    await expect(fetchAllVehicles(fetchFn)).rejects.toBeInstanceOf(ReportRefusedError);
  });

  it("au-delà de 20 pages : refus clair dès le premier appel", async () => {
    const calls: string[] = [];
    const fetchFn = async (url: string) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => ({ vehicles: [], total: 20001 }) };
    };
    const error = await fetchAllVehicles(fetchFn).catch((e) => e);
    expect(userMessageOf(error, "repli")).toMatch(/Trop de véhicules pour un seul rapport \(20\s001, limite 20\s000\)/);
    expect(calls).toHaveLength(1);
  });
});

describe("pleins de carburant pour un rapport", () => {
  it("liste lue : renvoyée telle quelle", async () => {
    const fetchFn = async () => ({ ok: true, status: 200, json: async () => [{ id: 1 }, { id: 2 }] });
    await expect(fetchFuelRecords(fetchFn)).resolves.toHaveLength(2);
  });

  it("échec ou réponse qui n'est pas une liste : refus, jamais un rapport à 0", async () => {
    const failed = async () => ({ ok: false, status: 500, json: async () => ({ message: "x" }) });
    const notAList = async () => ({ ok: true, status: 200, json: async () => ({ records: [] }) });
    for (const fetchFn of [failed, notAList]) {
      const error = await fetchFuelRecords(fetchFn).catch((e) => e);
      expect(error).toBeInstanceOf(ReportRefusedError);
      expect(userMessageOf(error, "repli")).toMatch(/Les pleins de carburant n'ont pas pu être lus/);
    }
    const error = await fetchFuelRecords(failed).catch((e) => e);
    expect(error.detail).toEqual({ path: "/api/fuel-records", reason: "http", status: 500 });
  });

  it("autre erreur qu'un refus : seule l'erreur est journalisée", () => {
    const error = new Error("x");
    expect(reportErrorContext(error)).toEqual({ err: error });
  });
});

describe("utilisateurs pour un rapport (liste non paginée, bornée)", () => {
  const list = (n: number) => async (url: string) => {
    expect(url).toBe("/api/users");
    return { ok: true, status: 200, json: async () => items(n) };
  };

  it("liste sous la borne : renvoyée en entier", async () => {
    await expect(fetchAllUsers(list(REPORT_MAX_USERS))).resolves.toHaveLength(10_000);
  });

  it("au-delà de 10 000 : refus lisible, sans détail technique", async () => {
    const error = await fetchAllUsers(list(REPORT_MAX_USERS + 1)).catch((e) => e);
    expect(error).toBeInstanceOf(ReportRefusedError);
    expect(userMessageOf(error, "repli")).toBe(
      "Trop d'utilisateurs pour un seul rapport (10 001, limite 10 000) : le rapport n'a pas été généré.",
    );
  });

  it("échec ou réponse qui n'est pas une liste : refus lisible", async () => {
    const failed = async () => ({ ok: false, status: 403, json: async () => ({ message: "x" }) });
    const notAList = async () => ({ ok: true, status: 200, json: async () => ({ users: [] }) });
    for (const fetchFn of [failed, notAList]) {
      const error = await fetchAllUsers(fetchFn).catch((e) => e);
      expect(error).toBeInstanceOf(ReportRefusedError);
      expect(userMessageOf(error, "repli")).toBe(
        "Les utilisateurs n'ont pas pu être lus : le rapport n'a pas été généré. Réessayez.",
      );
    }
    // Statut HTTP gardé pour les logs, jamais dans le message.
    const error = await fetchAllUsers(failed).catch((e) => e);
    expect(error.detail).toEqual({ path: "/api/users", reason: "http", status: 403 });
  });
});

describe("lecture paginée générique", () => {
  it("chemin qui porte déjà des paramètres : limit et offset ajoutés avec &", async () => {
    const calls: string[] = [];
    const fetchFn = async (url: string) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => ({ rows: [{ id: 1 }], total: 1 }) };
    };
    await fetchAllPages(fetchFn, {
      path: "/api/x?status=open",
      listKey: "rows",
      pageSize: 10,
      unreadable: "illisible",
      tooMany: () => "trop",
    });
    expect(calls).toEqual(["/api/x?status=open&limit=10&offset=0"]);
  });

  it("élément sans id : refus, le dédoublonnage ne peut pas être vérifié", async () => {
    const fetchFn = async () => ({ ok: true, status: 200, json: async () => ({ rows: [{ name: "a" }], total: 1 }) });
    await expect(
      fetchAllPages(fetchFn, { path: "/api/x", listKey: "rows", pageSize: 10, unreadable: "illisible", tooMany: () => "trop" }),
    ).rejects.toBeInstanceOf(ReportRefusedError);
  });
});
