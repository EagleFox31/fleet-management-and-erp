import { describe, expect, it } from "vitest";
import { fetchAllWorkOrders, ReportRefusedError } from "@/lib/fetch-all-work-orders";
import { userMessageOf } from "@/lib/api-error";

/**
 * Rapport des coûts de maintenance : `GET /api/work-orders` est paginé (50 par défaut).
 * Un seul appel sans `limit` ne lisait que les 50 premiers OT et sous-évaluait le total.
 */
const orders = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));

function fakeApi(all: { id: number }[], { failAtOffset, total }: { failAtOffset?: number; total?: number } = {}) {
  const calls: string[] = [];
  const fetchFn = async (url: string) => {
    calls.push(url);
    const params = new URL(url, "http://x").searchParams;
    const limit = Number(params.get("limit") ?? 50);
    const offset = Number(params.get("offset") ?? 0);
    if (offset === failAtOffset) return { ok: false, status: 500, json: async () => ({ message: "x" }) };
    return {
      ok: true,
      status: 200,
      json: async () => ({ workOrders: all.slice(offset, offset + limit), total: total ?? all.length }),
    };
  };
  return { fetchFn, calls };
}

describe("lecture complète des ordres de travail", () => {
  it("120 OT sur 3 pages : tous lus", async () => {
    const { fetchFn, calls } = fakeApi(orders(120));
    const result = await fetchAllWorkOrders(fetchFn, { pageSize: 50 });
    expect(result).toHaveLength(120);
    expect(calls).toEqual([
      "/api/work-orders?limit=50&offset=0",
      "/api/work-orders?limit=50&offset=50",
      "/api/work-orders?limit=50&offset=100",
    ]);
  });

  it("par défaut : pages de 500", async () => {
    const { fetchFn, calls } = fakeApi(orders(3));
    await fetchAllWorkOrders(fetchFn);
    expect(calls).toEqual(["/api/work-orders?limit=500&offset=0"]);
  });

  it("aucun OT : liste vide, pas d'erreur", async () => {
    const { fetchFn } = fakeApi([]);
    await expect(fetchAllWorkOrders(fetchFn)).resolves.toEqual([]);
  });

  it("échec en page 2 : refus, pas un rapport sur la page 1", async () => {
    const { fetchFn } = fakeApi(orders(120), { failAtOffset: 50 });
    await expect(fetchAllWorkOrders(fetchFn, { pageSize: 50 })).rejects.toBeInstanceOf(ReportRefusedError);
  });

  it("page vide avant le total annoncé : refus", async () => {
    const { fetchFn } = fakeApi(orders(60), { total: 120 });
    await expect(fetchAllWorkOrders(fetchFn, { pageSize: 50 })).rejects.toBeInstanceOf(ReportRefusedError);
  });

  it("réponse qui n'a pas la forme { workOrders, total } : refus", async () => {
    const fetchFn = async () => ({ ok: true, status: 200, json: async () => [{ id: 1 }] });
    await expect(fetchAllWorkOrders(fetchFn)).rejects.toBeInstanceOf(ReportRefusedError);
  });

  it("au-delà de la borne (20 pages) : refus clair dès la première page, sans boucler", async () => {
    const { fetchFn, calls } = fakeApi(orders(1001), {});
    const error = await fetchAllWorkOrders(fetchFn, { pageSize: 50 }).catch((e) => e);
    expect(error).toBeInstanceOf(ReportRefusedError);
    expect(userMessageOf(error, "repli")).toMatch(/Trop d'ordres de travail pour un seul rapport \(1\s001, limite 1\s000\)/);
    expect(calls).toHaveLength(1);
  });

  it("un OT répété d'une page à l'autre (tri sans départage) : refus, pas un coût faux", async () => {
    // Page 2 répète le dernier OT de la page 1 et saute le suivant : le compte vaut `total`.
    const all = orders(100);
    const fetchFn = async (url: string) => {
      const offset = Number(new URL(url, "http://x").searchParams.get("offset"));
      const page = offset === 0 ? all.slice(0, 50) : [all[49], ...all.slice(51, 100)];
      return { ok: true, status: 200, json: async () => ({ workOrders: page, total: 100 }) };
    };
    await expect(fetchAllWorkOrders(fetchFn, { pageSize: 50 })).rejects.toBeInstanceOf(ReportRefusedError);
  });

  it("total qui change d'une page à l'autre : refus", async () => {
    const all = orders(100);
    const fetchFn = async (url: string) => {
      const offset = Number(new URL(url, "http://x").searchParams.get("offset"));
      return {
        ok: true,
        status: 200,
        json: async () => ({ workOrders: all.slice(offset, offset + 50), total: offset === 0 ? 100 : 101 }),
      };
    };
    await expect(fetchAllWorkOrders(fetchFn, { pageSize: 50 })).rejects.toBeInstanceOf(ReportRefusedError);
  });

  it("borne dépassée : le total aussi est formaté en français", async () => {
    const fetchFn = async () => ({ ok: true, status: 200, json: async () => ({ workOrders: [], total: 12345 }) });
    const error = await fetchAllWorkOrders(fetchFn).catch((e) => e);
    expect(userMessageOf(error, "repli")).toMatch(/\(12\s345, limite 10\s000\)/);
  });

  it("les messages de refus sont lisibles tels quels", async () => {
    const { fetchFn } = fakeApi(orders(120), { failAtOffset: 50 });
    const error = await fetchAllWorkOrders(fetchFn, { pageSize: 50 }).catch((e) => e);
    expect(userMessageOf(error, "repli")).toMatch(/n'ont pas pu être lus en entier/);
  });
});
