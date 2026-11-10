import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { maintenanceSchedules, users, vehicles } from "../../shared/schema";
import { startContractSession } from "../support/contract-session";
import { createTestVehicle } from "../support/factories";
import { BACKSLASH, sendRawResponse } from "../support/raw-request";

/**
 * Cible brute non canonique sur la vraie app (`createApp`). Pour `/api\users/62#x`, `parseurl` donne
 * `/api/users/62` a l'app mais `//users/62` a apiRouter : les gardes de `server/api/` (dernier admin,
 * vehicule retire, audit, idempotence) etaient sautees et la route de `server/routes.ts` s'executait.
 * `rejectNonCanonicalTarget` refuse en 400 avant tout routage ; `\` dans la query et `%5C` passent.
 */
const B = BACKSLASH;
let session: Awaited<ReturnType<typeof startContractSession<"admin" | "tech">>>;
let retiredVehicleId = 0;

beforeAll(async () => {
  session = await startContractSession({ admin: "admin", tech: "technician" });
  const vehicle = await createTestVehicle({});
  session.ids.vehicleIds.push(vehicle.id);
  retiredVehicleId = vehicle.id;
  await db.update(vehicles).set({ deletedAt: new Date() }).where(eq(vehicles.id, vehicle.id));
}, 120000);

afterAll(async () => {
  await session?.stop();
});

const asAdmin = () => ({ headers: { Cookie: session.cookieOf("admin") } });

describe("cible non canonique : 400 avant tout routage", () => {
  it.each([
    (id: number) => `/api${B}users/${id}#x`,
    (id: number) => `http://localhost/api${B}users/${id}`,
    (id: number) => `/api/users${B}${id}#`,
    (id: number) => `/api/users/${id}${B}#`,
    (id: number) => `http://localhost/api/users/${id}`,
  ])("garde dernier admin : PATCH %s refuse, role inchange", async (target) => {
    const techId = session.userId("tech");
    const res = await sendRawResponse(session.port, "PATCH", target(techId), { ...asAdmin(), body: { role: "admin" } });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ code: "NON_CANONICAL_TARGET" });
    const [row] = await db.select({ role: users.role }).from(users).where(eq(users.id, techId));
    expect(row.role).toBe("technician");
  });

  it("garde vehicule retire : POST avec barre inverse refuse, aucune ligne creee", async () => {
    const body = { vehicleId: retiredVehicleId, title: "TEST antislash", frequency: "monthly", frequencyValue: 1, scheduledDate: new Date().toISOString().slice(0, 10) };
    const canonical = await sendRawResponse(session.port, "POST", "/api/maintenance-schedules", { ...asAdmin(), body });
    expect(canonical.status).toBe(409);
    const bypass = await sendRawResponse(session.port, "POST", `/api${B}maintenance-schedules#`, { ...asAdmin(), body });
    expect(bypass.status).toBe(400);
    expect(JSON.parse(bypass.body)).toMatchObject({ code: "NON_CANONICAL_TARGET" });
    const [{ n }] = await db.select({ n: count() }).from(maintenanceSchedules).where(eq(maintenanceSchedules.vehicleId, retiredVehicleId));
    expect(n).toBe(0);
  });

  it("anonyme : 400 avant l'authentification", async () => {
    expect((await sendRawResponse(session.port, "PATCH", `/api${B}users/1#x`)).status).toBe(400);
    expect((await sendRawResponse(session.port, "PATCH", "/api/users/1")).status).toBe(401);
  });
});

describe("cibles legitimes inchangees", () => {
  it.each([`/api/vehicles?search=a${B}b`, "/api/vehicles?search=a%5Cb"])("GET %s : 200", async (target) => {
    expect((await sendRawResponse(session.port, "GET", target, asAdmin())).status).toBe(200);
  });

  it("%5C dans le chemin n'est pas converti : pas de refus NON_CANONICAL_TARGET", async () => {
    const res = await sendRawResponse(session.port, "GET", "/api/vehicles%5C1", asAdmin());
    expect(res.body).not.toContain("NON_CANONICAL_TARGET");
  });
});

describe("prefixe /api insensible a la casse, comme le montage", () => {
  it("GET /API/vehicles : servi par l'API, avec no-store", async () => {
    const res = await fetch(`http://127.0.0.1:${session.port}/API/vehicles`, asAdmin());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});
