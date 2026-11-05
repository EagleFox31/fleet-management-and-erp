import { createServer, type Server } from "http";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  TARIFF_GRID_PATH,
  TARIFF_SUGGEST_PATH,
  tariffListResponseSchema,
  tariffSuggestionSchema,
} from "../../shared/contracts/tariff-grid";
import { db } from "../../server/db";
import { tariffGrid } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestClient, createTestUser, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/** O3 : grille tarifaire (drapeau, rôles, unicité, chevauchement, suggestion sans écriture). */
process.env.FEATURE_FLAGS = "pricing=on";

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<string, string>();
let clientId = 0;
const origin = uniqueTestToken("orig");
const destination = uniqueTestToken("dest");

async function login(role: TestUserRole) {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  cookies.set(role, res.headers.get("set-cookie")!.split(";")[0]);
}
async function call(method: string, path: string, role?: string, body?: unknown) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { "Content-Type": "application/json", ...(role ? { Cookie: cookies.get(role)! } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const tariff = (over: Record<string, unknown> = {}) => ({
  origin,
  destination,
  pricingUnit: "ton",
  unitPrice: 100,
  validFrom: "2026-01-01",
  validTo: "2026-12-31",
  ...over,
});
const suggestPath = (extra = "") =>
  `${TARIFF_SUGGEST_PATH}?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&date=2026-06-01${extra}`;

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  for (const role of ["admin", "management", "logistics", "secretary", "technician", "client"] as const) await login(role);
  const client = await createTestClient();
  ids.clientIds.push(client.id);
  clientId = client.id;
}, 180000);
afterAll(async () => {
  await db.delete(tariffGrid).where(eq(tariffGrid.origin, origin));
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

describe("grille tarifaire", { timeout: 120000 }, () => {
  it("rôles : lecture admin, direction, secrétariat et logistique ; écriture admin et direction ; le reste 403", async () => {
    expect((await call("GET", TARIFF_GRID_PATH)).status).toBe(401);
    for (const role of ["technician", "client"]) {
      expect((await call("GET", TARIFF_GRID_PATH, role)).status).toBe(403);
      expect((await call("GET", suggestPath(), role)).status).toBe(403);
    }
    for (const role of ["admin", "management", "secretary", "logistics"]) {
      const res = await call("GET", TARIFF_GRID_PATH, role);
      expect(res.status).toBe(200);
      tariffListResponseSchema.parse(res.body);
      expect((await call("GET", suggestPath(), role)).status).toBe(200);
    }
    for (const role of ["secretary", "logistics", "technician", "client"]) {
      expect((await call("POST", TARIFF_GRID_PATH, role, tariff())).status).toBe(403);
      expect((await call("PUT", TARIFF_GRID_PATH + "/1", role, tariff())).status).toBe(403);
      expect((await call("DELETE", TARIFF_GRID_PATH + "/1", role)).status).toBe(403);
    }
  });

  it("corps strict : champs serveur, unité, prix, dates et période invalides refusés en 400", async () => {
    for (const bad of [
      { createdBy: 1 },
      { id: 5 },
      { pricingUnit: "kg" },
      { unitPrice: -1 },
      { unitPrice: 10.5 },
      { validFrom: "2026-02-30" },
      { validFrom: "2026-05-01", validTo: "2026-04-01" },
      { origin: "  " },
    ]) {
      expect((await call("POST", TARIFF_GRID_PATH, "admin", tariff(bad))).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await call("POST", TARIFF_GRID_PATH, "admin", tariff({ clientId: 2147483000 }))).status).toBe(400);
  });

  it("création : tarif générique, audit renseigné, rejeu identique refusé en 409 (client NULL compte)", async () => {
    const res = await call("POST", TARIFF_GRID_PATH, "admin", tariff());
    expect(res.status).toBe(201);
    const [stored] = await db.select().from(tariffGrid).where(eq(tariffGrid.id, res.body.id));
    expect(stored).toMatchObject({ clientId: null, cargoType: "", createdBy: stored.updatedBy });
    expect(stored.createdBy).not.toBeNull();
    expect((await call("POST", TARIFF_GRID_PATH, "admin", tariff())).status).toBe(409);
    expect((await call("POST", TARIFF_GRID_PATH, "management", tariff({ origin: origin.toUpperCase() }))).status).toBe(409);
  });

  it("l'index unique refuse le doublon exact même hors service (NULL non distincts)", async () => {
    await expect(
      db.insert(tariffGrid).values({ origin, destination, pricingUnit: "ton", unitPrice: "1.00", validFrom: "2026-01-01" }),
    ).rejects.toThrow();
  });

  it("chevauchement de période pour la même clé : 409 ; période contiguë et autre clé : 201", async () => {
    expect((await call("POST", TARIFF_GRID_PATH, "admin", tariff({ validFrom: "2026-12-31", validTo: null }))).status).toBe(409);
    expect((await call("POST", TARIFF_GRID_PATH, "admin", tariff({ validFrom: "2027-01-01", validTo: null }))).status).toBe(201);
    expect((await call("POST", TARIFF_GRID_PATH, "admin", tariff({ clientId }))).status).toBe(201);
    expect((await call("POST", TARIFF_GRID_PATH, "admin", tariff({ cargoType: "Coton" }))).status).toBe(201);
  });

  it("modification : rejouable, 404 inconnu, chevauchement refusé, ses propres dates ne comptent pas", async () => {
    const created = await call("POST", TARIFF_GRID_PATH, "admin", tariff({ cargoType: "Ciment", validFrom: "2025-01-01", validTo: "2025-06-30" }));
    expect(created.status).toBe(201);
    const path = `${TARIFF_GRID_PATH}/${created.body.id}`;
    const edit = tariff({ cargoType: "Ciment", validFrom: "2025-01-01", validTo: "2025-08-31", unitPrice: 130 });
    expect((await call("PUT", path, "admin", edit)).status).toBe(200);
    expect((await call("PUT", path, "admin", edit)).status).toBe(200);
    expect((await call("PUT", `${TARIFF_GRID_PATH}/99999999`, "admin", edit)).status).toBe(404);
    const other = await call("POST", TARIFF_GRID_PATH, "admin", tariff({ cargoType: "Ciment", validFrom: "2025-09-01", validTo: "2025-12-31" }));
    expect(other.status).toBe(201);
    expect((await call("PUT", path, "admin", { ...edit, validTo: "2025-09-15" })).status).toBe(409);
  });

  it("suggestion : tarif du client avant le générique, sans écriture, null hors période", async () => {
    const before = await db.select().from(tariffGrid).where(eq(tariffGrid.origin, origin));
    const generic = tariffSuggestionSchema.parse((await call("GET", suggestPath(), "management")).body);
    expect(generic.suggestion).toMatchObject({ source: "generic", unitPrice: 100 });
    const forClient = await call("GET", suggestPath(`&clientId=${clientId}`), "admin");
    expect(tariffSuggestionSchema.parse(forClient.body).suggestion).toMatchObject({ source: "client" });
    const out = await call("GET", suggestPath().replace("2026-06-01", "2020-01-01"), "admin");
    expect(out.body.suggestion).toBeNull();
    expect((await call("GET", `${TARIFF_SUGGEST_PATH}?destination=x`, "admin")).status).toBe(400);
    expect((await call("GET", `${TARIFF_SUGGEST_PATH}?origin=${origin}&destination=${destination}`, "admin")).status).toBe(200);
    const after = await db.select().from(tariffGrid).where(eq(tariffGrid.origin, origin));
    expect(after).toEqual(before);
  });

  it("un tarif désactivé ne bloque plus sa période (création et réactivation)", async () => {
    const first = await call("POST", TARIFF_GRID_PATH, "admin", tariff({ cargoType: "Riz", validFrom: "2024-01-01", validTo: "2024-12-31" }));
    expect(first.status).toBe(201);
    expect((await call("DELETE", `${TARIFF_GRID_PATH}/${first.body.id}`, "admin")).status).toBe(200);
    const again = await call("POST", TARIFF_GRID_PATH, "admin", tariff({ cargoType: "Riz", validFrom: "2024-01-01", validTo: "2024-12-31", unitPrice: 80 }));
    expect(again.status).toBe(201);
    const reactivate = tariff({ cargoType: "Riz", validFrom: "2024-01-01", validTo: "2024-12-31", active: true });
    expect((await call("PUT", `${TARIFF_GRID_PATH}/${first.body.id}`, "admin", reactivate)).status).toBe(409);
  });

  it("désactivation : l'historique reste, le tarif n'est plus suggéré", async () => {
    const created = await call("POST", TARIFF_GRID_PATH, "admin", tariff({ cargoType: "Sable", unitPrice: 55 }));
    expect(created.status).toBe(201);
    expect((await call("GET", suggestPath("&cargoType=Sable"), "admin")).body.suggestion.unitPrice).toBe(55);
    expect((await call("DELETE", `${TARIFF_GRID_PATH}/${created.body.id}`, "admin")).status).toBe(200);
    expect((await call("GET", suggestPath("&cargoType=Sable"), "admin")).body.suggestion.unitPrice).toBe(100);
    expect((await call("DELETE", `${TARIFF_GRID_PATH}/99999999`, "admin")).status).toBe(404);
    const list = tariffListResponseSchema.parse((await call("GET", `${TARIFF_GRID_PATH}?activeOnly=false`, "admin")).body);
    expect(list.rows.find((r) => r.id === created.body.id)?.active).toBe(false);
  });
});

describe("drapeau désactivé", () => {
  it("la route est introuvable (404) même pour l'admin", async () => {
    process.env.FEATURE_FLAGS = "";
    try {
      expect((await call("GET", TARIFF_GRID_PATH, "admin")).status).toBe(404);
    } finally {
      process.env.FEATURE_FLAGS = "pricing=on";
    }
  });
});
