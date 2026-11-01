import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { vehicles, workOrders } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestPart, createTestSupplier, createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Niveau C, T8 : listes principales (véhicules, ordres de travail, pièces, fournisseurs).
 * Chaque suite part de lignes créées ici et repérées par un jeton unique placé dans le champ cherché.
 * Bornes : 200 avec repli ou 400, jamais 500. Recherche `%`, `_`, `'` : doit être du texte littéral.
 * Missions et documents n'ont ni pagination ni filtre côté serveur (liste complète, ou liste par véhicule) :
 * rien à tester au contrat tant qu'ils n'en exposent pas.
 */

const ACTORS = { admin: "admin", client: "client" } as const;
type Actor = keyof typeof ACTORS;
const ids = createIdBag();
const workOrderIds: number[] = [];
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
const get = (path: string, actor: Actor = "admin") => session.call("GET", path, { actor });
const q = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(Object.entries(params).filter((e): e is [string, string | number] => e[1] !== undefined).map(([k, v]) => [k, String(v)])).toString();
const noLeak = (res: { body: any }) => expect(JSON.stringify(res.body)).not.toMatch(/SQLSTATE|violates|invalid input syntax|at \S+:\d+/);

beforeAll(async () => {
  session = await startContractActors(ACTORS, ids.userIds);
}, 60000);

afterAll(async () => {
  try {
    if (workOrderIds.length > 0) await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
    await cleanupCreated(ids);
  } finally {
    await session?.close();
  }
}, 60000);

type Domain = {
  path: string;
  token: string;
  seeded: number[];
  /** Sélecteur de lignes dans le corps de réponse. */
  rows: (body: any) => any[];
};

/** Parcourt toutes les pages et vérifie total, absence de doublon et de trou. */
async function walkPages(d: Domain, pageSize: number) {
  const seen: number[] = [];
  let total: number | undefined;
  for (let offset = 0; offset < d.seeded.length + pageSize; offset += pageSize) {
    const res = await get(`${d.path}?${q({ search: d.token, limit: pageSize, offset })}`);
    expect(res.status).toBe(200);
    const rows = d.rows(res.body);
    expect(rows.length).toBeLessThanOrEqual(pageSize);
    total = res.body.total;
    seen.push(...rows.map((r: any) => r.id));
  }
  expect(total).toBe(d.seeded.length);
  expect(new Set(seen).size).toBe(seen.length);
  expect([...seen].sort((a, b) => a - b)).toEqual([...d.seeded].sort((a, b) => a - b));
}

const idsOf = (d: Domain, res: { body: any }): number[] => d.rows(res.body).map((r: any) => r.id);

/** Cas communs à toutes les listes recherchables. */
function searchCases(getDomain: () => Domain, quoteRowId: () => number, options: { nulByteRejected?: boolean } = {}) {
  it("liste vide : jeton inconnu", async () => {
    const d = getDomain();
    const res = await get(`${d.path}?${q({ search: uniqueTestToken("absent") })}`);
    expect(res.status).toBe(200);
    expect(d.rows(res.body)).toEqual([]);
  });

  it("apostrophe : recherche littérale, la ligne est trouvée", async () => {
    const d = getDomain();
    const res = await get(`${d.path}?${q({ search: `${d.token}-q'z` })}`);
    expect(res.status).toBe(200);
    expect(idsOf(d, res)).toEqual([quoteRowId()]);
  });

  it("injection SQL classique : aucune ligne, jamais 500", async () => {
    const d = getDomain();
    const res = await get(`${d.path}?${q({ search: `${d.token}' OR '1'='1` })}`);
    expect(res.status).toBe(200);
    noLeak(res);
    expect(d.rows(res.body)).toEqual([]);
  });

  it("antislash, guillemet et pourcent-zéro littéral : jamais 500", async () => {
    const d = getDomain();
    for (const term of ["\\", '"', "%00"]) {
      const res = await get(`${d.path}?${q({ search: term })}`);
      expect(res.status, term).toBeLessThan(500);
      noLeak(res);
    }
  });

  // Défaut figé : un octet nul dans la recherche est refusé par PostgreSQL et la route répond 500
  // (véhicules et ordres de travail avalent l'erreur et renvoient une liste vide, sans 500).
  if (options.nulByteRejected) {
    it.fails("octet nul dans la recherche : 400 ou liste vide, pas 500", async () => {
      const d = getDomain();
      const res = await get(`${d.path}?${q({ search: "\u0000x" })}`);
      expect(res.status).toBeLessThan(500);
    });
  }

  // Défaut figé : `%` et `_` ne sont pas échappés avant le ILIKE, ils agissent comme jokers.
  it.fails("joker % : traité comme texte, aucune ligne ne contient un pourcent", async () => {
    const d = getDomain();
    const res = await get(`${d.path}?${q({ search: `${d.token}-%` })}`);
    expect(idsOf(d, res)).toEqual([]);
  });

  it.fails("joker _ : traité comme texte, aucune ligne ne contient un souligné", async () => {
    const d = getDomain();
    const res = await get(`${d.path}?${q({ search: `${d.token}_0` })}`);
    expect(idsOf(d, res)).toEqual([]);
  });
}

describe("T8 : véhicules", { timeout: 120000 }, () => {
  const token = uniqueTestToken("lv");
  const vehicleIds: number[] = [];
  let quoteId = 0;
  let clientVehicleId = 0;
  const domain: Domain = { path: "/api/vehicles", token, seeded: vehicleIds, rows: (b) => b.vehicles };

  beforeAll(async () => {
    for (let i = 0; i < 5; i++) {
      const v = await createTestVehicle({ registrationNumber: `${token}-${i}`, brand: i % 2 === 0 ? "LvMarqueA" : "LvMarqueB" });
      ids.vehicleIds.push(v.id);
      vehicleIds.push(v.id);
    }
    const quoted = await createTestVehicle({ registrationNumber: `${token}-q'z` });
    ids.vehicleIds.push(quoted.id);
    quoteId = quoted.id;
    const gone = await createTestVehicle({ registrationNumber: `${token}-gone` });
    ids.vehicleIds.push(gone.id);
    await db.update(vehicles).set({ deletedAt: new Date() }).where(eq(vehicles.id, gone.id));
    const owned = await createTestVehicle({ registrationNumber: `${token}-own`, ownerId: session.userIdOf("client") });
    ids.vehicleIds.push(owned.id);
    clientVehicleId = owned.id;
  }, 60000);

  // Les 5 lignes numérotées, la ligne à apostrophe et celle du client forment le jeu de pagination.
  const paginationSet = (): Domain => ({ ...domain, seeded: [...vehicleIds, quoteId, clientVehicleId] });

  it("pages sans doublon ni trou, total cohérent, véhicule supprimé exclu", async () => {
    await walkPages(paginationSet(), 2);
  });

  it("tri explicite sur une clé unique, ascendant puis descendant, stable", async () => {
    const asc = await get(`/api/vehicles?${q({ search: token, limit: 50, sort_by: "registrationNumber", sort_order: "asc" })}`);
    const desc = await get(`/api/vehicles?${q({ search: token, limit: 50, sort_by: "registrationNumber", sort_order: "desc" })}`);
    const a = idsOf(domain, asc);
    expect(a).toHaveLength(paginationSet().seeded.length);
    expect(idsOf(domain, desc)).toEqual([...a].reverse());
  });

  it("filtre statut et recherche par marque ne renvoient que ce qui correspond", async () => {
    await db.update(vehicles).set({ status: "maintenance" }).where(eq(vehicles.id, vehicleIds[0]));
    const byStatus = await get(`/api/vehicles?${q({ search: token, status: "maintenance", limit: 50 })}`);
    expect(idsOf(domain, byStatus)).toEqual([vehicleIds[0]]);
    expect(byStatus.body.total).toBe(1);
    const byBrand = await get(`/api/vehicles?${q({ search: "lvmarquea", limit: 500 })}`);
    const mine = byBrand.body.vehicles.filter((v: any) => String(v.registrationNumber).startsWith(token));
    expect(mine.map((v: any) => v.id).sort()).toEqual([vehicleIds[0], vehicleIds[2], vehicleIds[4]].sort());
    expect(byBrand.body.vehicles.every((v: any) => /lvmarquea/i.test(v.brand))).toBe(true);
  });

  searchCases(paginationSet, () => quoteId);

  it.each([["limit", "abc"], ["limit", "-1"], ["limit", "0"], ["offset", "abc"]])("borne %s=%s : 200, jamais 500", async (name, value) => {
    const res = await get(`/api/vehicles?${q({ search: token, [name]: value })}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    noLeak(res);
  });

  // Défaut figé : l'erreur SQL est avalée par le stockage (storage.ts, catch de getVehicles) et la liste
  // revient vide avec total 0 alors que des lignes existent : un écran croit qu'il n'y a aucun véhicule.
  it.fails("offset négatif : 400 ou repli, pas une liste vide avec total 0", async () => {
    const res = await get(`/api/vehicles?${q({ search: token, offset: -1 })}`);
    expect(res.status === 400 || res.body.total > 0).toBe(true);
  });

  it.fails("limit hors entier sûr : 400 ou repli, pas une liste vide avec total 0", async () => {
    const res = await get(`/api/vehicles?${q({ search: token, limit: "99999999999999999999" })}`);
    expect(res.status === 400 || res.body.total > 0).toBe(true);
  });

  // Défaut figé : GET /api/vehicles ne filtre pas sur ownerScopeOf (routes.ts, « tous les utilisateurs voient
  // tous les véhicules ») alors qu'AGENTS.md §11 réserve au client ses seuls véhicules.
  it.fails("client : ne voit pas les véhicules des autres", async () => {
    const res = await get(`/api/vehicles?${q({ search: token, limit: 50 })}`, "client");
    expect(idsOf(domain, res)).toEqual([clientVehicleId]);
  });
});

describe("T8 : ordres de travail", { timeout: 120000 }, () => {
  const token = uniqueTestToken("lw");
  const seeded: number[] = [];
  let quoteId = 0;
  let clientWorkOrderId = 0;
  const domain: Domain = { path: "/api/work-orders", token, seeded, rows: (b) => b.workOrders };

  async function addWorkOrder(vehicleId: number, title: string, extra: Partial<typeof workOrders.$inferInsert> = {}) {
    const [row] = await db.insert(workOrders).values({ vehicleId, title, description: "T8", ...extra }).returning();
    workOrderIds.push(row.id);
    return row.id;
  }

  beforeAll(async () => {
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    for (let i = 0; i < 5; i++) {
      seeded.push(await addWorkOrder(vehicle.id, `${token}-${i}`, { priority: i === 0 ? "critical" : "low", status: i === 1 ? "in_progress" : "pending" }));
    }
    quoteId = await addWorkOrder(vehicle.id, `${token}-q'z`);
    const owned = await createTestVehicle({ ownerId: session.userIdOf("client") });
    ids.vehicleIds.push(owned.id);
    clientWorkOrderId = await addWorkOrder(owned.id, `${token}-own`, { priority: "low" });
  }, 60000);

  const paginationSet = (): Domain => ({ ...domain, seeded: [...seeded, quoteId, clientWorkOrderId] });

  it("pages sans doublon ni trou, total cohérent", async () => {
    await walkPages(paginationSet(), 2);
  });

  it("filtres statut et priorité ne renvoient que ce qui correspond", async () => {
    const byPriority = await get(`/api/work-orders?${q({ search: token, priority: "critical" })}`);
    expect(idsOf(domain, byPriority)).toEqual([seeded[0]]);
    expect(byPriority.body.total).toBe(1);
    const byStatus = await get(`/api/work-orders?${q({ search: token, status: "in_progress" })}`);
    expect(idsOf(domain, byStatus)).toEqual([seeded[1]]);
  });

  searchCases(paginationSet, () => quoteId);

  it("repli documenté : limit 0 ou négative vaut 1, non numérique vaut 50, offset négatif vaut 0", async () => {
    const total = paginationSet().seeded.length;
    for (const limit of ["0", "-1"]) {
      const res = await get(`/api/work-orders?${q({ search: token, limit })}`);
      expect(res.status).toBe(200);
      expect(res.body.workOrders).toHaveLength(1);
      expect(res.body.total).toBe(total);
    }
    for (const params of [{ limit: "abc" }, { offset: "-1" }, { offset: "abc" }, { limit: "99999999999999999999" }, { limit: 100000 }]) {
      const res = await get(`/api/work-orders?${q({ search: token, ...params })}`);
      expect(res.status, JSON.stringify(params)).toBe(200);
      expect(res.body.workOrders).toHaveLength(total);
    }
  });

  it("client : ne voit que les ordres de ses véhicules, total cohérent", async () => {
    const res = await get(`/api/work-orders?${q({ limit: 50 })}`, "client");
    expect(res.status).toBe(200);
    expect(idsOf(domain, res)).toEqual([clientWorkOrderId]);
    expect(res.body.total).toBe(1);
  });
});

describe("T8 : pièces", { timeout: 120000 }, () => {
  const token = uniqueTestToken("lp");
  const seeded: number[] = [];
  let quoteId = 0;
  const domain: Domain = { path: "/api/parts", token, seeded, rows: (b) => b.parts };

  beforeAll(async () => {
    for (let i = 0; i < 5; i++) {
      const p = await createTestPart({ name: `${token}-${i}`, reference: `${token}-ref-${i}` });
      ids.partIds.push(p.id);
      seeded.push(p.id);
    }
    const quoted = await createTestPart({ name: `${token}-q'z`, reference: `${token}-ref-q` });
    ids.partIds.push(quoted.id);
    quoteId = quoted.id;
  }, 60000);

  const paginationSet = (): Domain => ({ ...domain, seeded: [...seeded, quoteId] });

  it("pages sans doublon ni trou, total cohérent (tri par référence, unique)", async () => {
    await walkPages(paginationSet(), 2);
  });

  it("tri par référence ascendant puis descendant, sens inverse l'un de l'autre", async () => {
    const asc = await get(`/api/parts?${q({ search: token, limit: 50, sort_by: "reference", sort_order: "asc" })}`);
    const desc = await get(`/api/parts?${q({ search: token, limit: 50, sort_by: "reference", sort_order: "desc" })}`);
    const a = idsOf(domain, asc);
    expect(a).toHaveLength(paginationSet().seeded.length);
    expect(idsOf(domain, desc)).toEqual([...a].reverse());
  });

  it("recherche par référence : ne renvoie que ce qui correspond", async () => {
    const res = await get(`/api/parts?${q({ search: `${token}-ref-3` })}`);
    expect(idsOf(domain, res)).toEqual([seeded[3]]);
    expect(res.body.total).toBe(1);
  });

  searchCases(paginationSet, () => quoteId, { nulByteRejected: true });

  it.each([["limit", "abc"], ["limit", "-1"], ["limit", "0"], ["offset", "abc"]])("borne %s=%s : 200, jamais 500", async (name, value) => {
    const res = await get(`/api/parts?${q({ search: token, [name]: value })}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    noLeak(res);
  });

  // Défaut figé : routes.ts, GET /api/parts : `page = floor(offset / limit) + 1` n'est pas borné,
  // un offset négatif donne un OFFSET négatif en SQL et la route répond 500.
  it.fails("offset négatif : 400 ou repli, pas 500", async () => {
    const res = await get(`/api/parts?${q({ search: token, offset: -1 })}`);
    expect(res.status).toBeLessThan(500);
  });

  it.fails("limit hors entier sûr : 400 ou repli, pas 500", async () => {
    const res = await get(`/api/parts?${q({ search: token, limit: "99999999999999999999" })}`);
    expect(res.status).toBeLessThan(500);
  });
});

describe("T8 : fournisseurs (liste complète filtrable, sans pagination)", { timeout: 120000 }, () => {
  const token = uniqueTestToken("ls");
  const seeded: number[] = [];
  let inactiveId = 0;
  let quoteId = 0;
  const domain: Domain = { path: "/api/suppliers", token, seeded, rows: (b) => b };

  beforeAll(async () => {
    for (let i = 0; i < 4; i++) {
      const s = await createTestSupplier({ name: `${token}-${i}`, category: `${token}-cat`, isActive: true });
      ids.supplierIds.push(s.id);
      seeded.push(s.id);
    }
    const inactive = await createTestSupplier({ name: `${token}-4`, category: `${token}-cat`, isActive: false });
    ids.supplierIds.push(inactive.id);
    inactiveId = inactive.id;
    const quoted = await createTestSupplier({ name: `${token}-q'z`, category: `${token}-cat` });
    ids.supplierIds.push(quoted.id);
    quoteId = quoted.id;
  }, 60000);

  const everySeeded = () => [...seeded, inactiveId, quoteId].sort((a, b) => a - b);
  const sorted = (res: { body: any }) => idsOf(domain, res).sort((a, b) => a - b);

  it("recherche par jeton : exactement les fournisseurs créés, sans doublon", async () => {
    const res = await get(`/api/suppliers?${q({ search: token })}`);
    expect(res.status).toBe(200);
    expect(sorted(res)).toEqual(everySeeded());
  });

  it("filtre isActive et catégorie ne renvoient que ce qui correspond", async () => {
    const inactive = await get(`/api/suppliers?${q({ search: token, isActive: "false" })}`);
    expect(idsOf(domain, inactive)).toEqual([inactiveId]);
    const active = await get(`/api/suppliers?${q({ search: token, isActive: "true" })}`);
    expect(sorted(active)).toEqual([...seeded, quoteId].sort((a, b) => a - b));
    const byCategory = await get(`/api/suppliers?${q({ category: `${token}-CAT` })}`);
    expect(sorted(byCategory)).toEqual(everySeeded());
  });

  it("tri : le plus récent d'abord, stable d'un appel à l'autre", async () => {
    const first = await get(`/api/suppliers?${q({ search: token })}`);
    const second = await get(`/api/suppliers?${q({ search: token })}`);
    expect(idsOf(domain, first)).toEqual(idsOf(domain, second));
    expect(idsOf(domain, first)[0]).toBe(quoteId);
  });

  searchCases(() => ({ ...domain, seeded: everySeeded() }), () => quoteId, { nulByteRejected: true });

  it("paramètres de pagination inconnus : ignorés, 200, liste complète", async () => {
    const res = await get(`/api/suppliers?${q({ search: token, limit: "abc", offset: -1, page: 0 })}`);
    expect(res.status).toBe(200);
    expect(sorted(res)).toEqual(everySeeded());
  });

  // Défaut figé : suppliers.routes.ts, `isActive = (valeur === 'true')` : une valeur invalide est lue comme
  // « inactif » et la liste revient avec les seuls fournisseurs inactifs, sans 400.
  it.fails("isActive invalide : 400 ou filtre ignoré, pas lu comme inactif", async () => {
    const res = await get(`/api/suppliers?${q({ search: token, isActive: "maybe" })}`);
    expect(res.status === 400 || idsOf(domain, res).includes(seeded[0])).toBe(true);
  });

  // Défaut figé : la catégorie passe par ILIKE sans échappement, `%` agit comme joker.
  it.fails("catégorie avec joker % : traitée comme texte", async () => {
    const res = await get(`/api/suppliers?${q({ category: `${token}-%` })}`);
    expect(idsOf(domain, res)).toEqual([]);
  });
});
