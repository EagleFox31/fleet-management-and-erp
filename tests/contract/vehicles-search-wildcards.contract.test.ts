import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Recherche véhicules : `%`, `_` et `\` sont du texte. Cas POSITIFS : un
 * véhicule dont l'immatriculation contient ces caractères est trouvé (un test
 * qui n'affirme qu'une liste vide passe aussi si l'échappement est cassé).
 */

const ids = createIdBag();
const token = uniqueTestToken("vwc");
let session: Awaited<ReturnType<typeof startContractActors<"admin">>>;
const vehicleIds: Record<string, number> = {};

const search = async (term: string) => {
  const res = await session.call("GET", `/api/vehicles?${new URLSearchParams({ search: term, limit: "50" })}`, { actor: "admin" });
  expect(res.status).toBe(200);
  return (res.body.vehicles as Array<{ id: number }>).map((v) => v.id);
};

beforeAll(async () => {
  session = await startContractActors({ admin: "admin" }, ids.userIds);
  for (const [key, suffix] of Object.entries({ pct: "50%x", under: "a_b", back: "c\\d", plain: "50zx", plain2: "aXb" })) {
    const v = await createTestVehicle({ registrationNumber: `${token}-${suffix}` });
    ids.vehicleIds.push(v.id);
    vehicleIds[key] = v.id;
  }
}, 60000);

afterAll(async () => {
  try {
    await cleanupCreated(ids);
  } finally {
    await session?.close();
  }
}, 60000);

describe("recherche véhicules : caractères spéciaux littéraux", { timeout: 60000 }, () => {
  it("% est trouvé tel quel et ne joue pas le joker", async () => {
    const found = await search(`${token}-50%x`);
    expect(found).toContain(vehicleIds.pct);
    expect(found).not.toContain(vehicleIds.plain);
  });

  it("_ est trouvé tel quel et ne joue pas le joker", async () => {
    const found = await search(`${token}-a_b`);
    expect(found).toContain(vehicleIds.under);
    expect(found).not.toContain(vehicleIds.plain2);
  });

  it("l'antislash est trouvé tel quel", async () => {
    expect(await search(`${token}-c\\d`)).toContain(vehicleIds.back);
  });
});
