import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { drivers } from "../../shared/schema";
import { DRIVER_LINK_ROLE_REFUSED_MESSAGE, DRIVER_LINK_USER_NOT_FOUND_MESSAGE } from "../../server/lib/driver-link";
import { startContractSession } from "../support/contract-session";
import { uniqueTestToken } from "../support/ids";

/**
 * Liaison d'une fiche chauffeur à un compte (`drivers.userId`), par `POST /api/drivers` et `PATCH /api/drivers/:id`.
 * Le compte lié lit la fiche et ses missions par `/api/drivers/me`, réservé aux lecteurs des missions : un
 * technicien ou un client ne peut pas être lié (400, sans écriture). Chauffeur et personnel lecteur restent liables,
 * une fiche sans compte (`userId` null) aussi. Cause racine de la fuite corrigée par `driver-me-role`.
 */
type Actor = "logistics" | "driver" | "technician" | "client" | "warehouse";
let session: Awaited<ReturnType<typeof startContractSession<Actor>>>;
const driverIds: number[] = [];
const UNKNOWN_USER_ID = 2147480000;

const newFiche = (extra: Record<string, unknown> = {}) => ({ firstName: "Test", lastName: uniqueTestToken("liaison"), ...extra });
const userIdOfFiche = async (id: number) => (await db.select({ userId: drivers.userId }).from(drivers).where(eq(drivers.id, id)))[0]?.userId;
const fichesOf = async (userId: number) => (await db.select({ id: drivers.id }).from(drivers).where(eq(drivers.userId, userId))).length;

async function post(body: Record<string, unknown>) {
  const res = await session.call("POST", "/api/drivers", { actor: "logistics", body });
  if (res.body?.id) driverIds.push(res.body.id);
  return res;
}

beforeAll(async () => {
  session = await startContractSession<Actor>({
    logistics: "logistics",
    driver: "driver",
    technician: "technician",
    client: "client",
    warehouse: "warehouse",
  });
}, 60000);

afterAll(async () => {
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await session.stop();
});

describe("POST /api/drivers : compte lié", { timeout: 60000 }, () => {
  it.each(["technician", "client"] as const)("%s : 400 lisible, aucune fiche créée", async (actor) => {
    const userId = session.userId(actor);
    const res = await post(newFiche({ userId }));
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(DRIVER_LINK_ROLE_REFUSED_MESSAGE);
    expect(await fichesOf(userId)).toBe(0);
  });

  it("compte inconnu : 400 lisible", async () => {
    const res = await post(newFiche({ userId: UNKNOWN_USER_ID }));
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(DRIVER_LINK_USER_NOT_FOUND_MESSAGE);
  });

  it("chauffeur : fiche créée et liée", async () => {
    const res = await post(newFiche({ userId: session.userId("driver") }));
    expect([200, 201]).toContain(res.status);
    expect(await userIdOfFiche(res.body.id)).toBe(session.userId("driver"));
  });

  it("sans compte (userId null) : fiche créée", async () => {
    const res = await post(newFiche({ userId: null }));
    expect([200, 201]).toContain(res.status);
    expect(await userIdOfFiche(res.body.id)).toBeNull();
  });
});

describe("PATCH /api/drivers/:id : compte lié", { timeout: 60000 }, () => {
  let ficheId = 0;

  beforeAll(async () => {
    const res = await post(newFiche());
    expect([200, 201]).toContain(res.status);
    ficheId = res.body.id;
  });

  it.each(["technician", "client"] as const)("%s : 400 lisible, fiche non liée", async (actor) => {
    const res = await session.call("PATCH", `/api/drivers/${ficheId}`, { actor: "logistics", body: { userId: session.userId(actor) } });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(DRIVER_LINK_ROLE_REFUSED_MESSAGE);
    expect(await userIdOfFiche(ficheId)).toBeNull();
  });

  it("personnel lecteur des missions (magasinier) : liaison acceptée, puis déliée par null", async () => {
    const linked = await session.call("PATCH", `/api/drivers/${ficheId}`, { actor: "logistics", body: { userId: session.userId("warehouse") } });
    expect(linked.status).toBe(200);
    expect(await userIdOfFiche(ficheId)).toBe(session.userId("warehouse"));

    const unlinked = await session.call("PATCH", `/api/drivers/${ficheId}`, { actor: "logistics", body: { userId: null } });
    expect(unlinked.status).toBe(200);
    expect(await userIdOfFiche(ficheId)).toBeNull();
  });

  it("modification sans toucher au compte : non bloquée", async () => {
    const res = await session.call("PATCH", `/api/drivers/${ficheId}`, { actor: "logistics", body: { firstName: "Renomme" } });
    expect(res.status).toBe(200);
  });
});
