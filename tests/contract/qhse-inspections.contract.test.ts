import { createServer, type Server } from "http";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../../server/db";
import { initializeDatabase } from "../../server/init-database";
import { drivers, qhseInspectionCriteria, qhseInspections } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD } from "../support/factories";
import { TEST_PREFIX } from "../support/ids";

/**
 * Contrôles inopinés QHSE (lot Q1) : drapeau, 401, 403 par rôle, chauffeur limité à ses contrôles,
 * validation de la grille, idempotence du schéma.
 */

const previousFlags = process.env.FEATURE_FLAGS;
let server: Server;
let baseUrl = "";
const ids = createIdBag();
const driverIds: number[] = [];
const criterionCodes = [`${TEST_PREFIX.toLowerCase().replace(/[^a-z0-9]/g, "")}_crit`];

async function call(method: string, cookie: string | null, path: string, body?: unknown) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function login(username: string): Promise<string> {
  const res = await fetch(baseUrl + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  if (previousFlags === undefined) delete process.env.FEATURE_FLAGS;
  else process.env.FEATURE_FLAGS = previousFlags;
  if (driverIds.length > 0) await db.delete(qhseInspections).where(inArray(qhseInspections.driverId, driverIds));
  await db.delete(qhseInspectionCriteria).where(inArray(qhseInspectionCriteria.code, criterionCodes));
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("contrôles inopinés QHSE", { timeout: 180000 }, () => {
  it("drapeau coupé : la route n'existe pas", async () => {
    delete process.env.FEATURE_FLAGS;
    expect((await call("GET", null, "/api/qhse/inspections")).status).toBe(404);
    expect((await call("GET", null, "/api/qhse/criteria")).status).toBe(404);
  });

  it("applique les rôles, la cloison chauffeur et la validation de la grille", async () => {
    process.env.FEATURE_FLAGS = "qhse=on";

    const admin = await createTestUser({ role: "admin" });
    const management = await createTestUser({ role: "management" });
    const logistics = await createTestUser({ role: "logistics" });
    const workshop = await createTestUser({ role: "workshop_manager" });
    const client = await createTestUser({ role: "client" });
    const driverUser = await createTestUser({ role: "driver" });
    const otherDriverUser = await createTestUser({ role: "driver" });
    const driverNoProfile = await createTestUser({ role: "driver" });
    ids.userIds.push(admin.id, management.id, logistics.id, workshop.id, client.id, driverUser.id, otherDriverUser.id, driverNoProfile.id);
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const [ownDriver] = await db.insert(drivers).values({ userId: driverUser.id, firstName: "Test", lastName: TEST_PREFIX }).returning();
    const [otherDriver] = await db.insert(drivers).values({ userId: otherDriverUser.id, firstName: "Test", lastName: TEST_PREFIX }).returning();
    driverIds.push(ownDriver.id, otherDriver.id);

    const cookie = Object.fromEntries(
      await Promise.all(
        Object.entries({ admin, management, logistics, workshop, client, driverUser, otherDriverUser, driverNoProfile }).map(
          async ([key, u]) => [key, await login(u.username)] as const,
        ),
      ),
    ) as Record<string, string>;

    // Grille d'origine, semée par init-database : cabine et arrêt.
    const cabin = await call("GET", cookie.logistics, "/api/qhse/criteria?category=cabin&active=true");
    expect(cabin.status).toBe(200);
    expect(cabin.body.length).toBeGreaterThanOrEqual(10);
    const stop = await call("GET", cookie.logistics, "/api/qhse/criteria?category=stop");
    const cabinId = cabin.body[0].id as number;
    const stopId = stop.body[0].id as number;

    const payload = (driverId: number, items = [{ criterionId: cabinId, conform: false, observation: "Ceinture non portée" }]) => ({
      kind: "cabin",
      location: "Aire de Douala",
      vehicleId: vehicle.id,
      driverId,
      items,
      generalObservation: "RAS par ailleurs",
    });

    // 401 sans session.
    expect((await call("GET", null, "/api/qhse/inspections")).status).toBe(401);
    expect((await call("POST", null, "/api/qhse/inspections", payload(ownDriver.id))).status).toBe(401);

    // 403 : rôles hors saisie, y compris le chauffeur en écriture et en lecture de la grille.
    for (const role of ["workshop", "client", "driverUser"]) {
      expect((await call("POST", cookie[role], "/api/qhse/inspections", payload(ownDriver.id))).status).toBe(403);
      expect((await call("GET", cookie[role], "/api/qhse/criteria")).status).toBe(403);
      expect((await call("POST", cookie[role], "/api/qhse/criteria", { code: "x1", label: "Test", category: "cabin" })).status).toBe(403);
    }
    expect((await call("GET", cookie.workshop, "/api/qhse/inspections")).status).toBe(403);
    expect((await call("GET", cookie.client, "/api/qhse/inspections")).status).toBe(403);
    // La logistique saisit mais ne configure pas la grille.
    expect((await call("POST", cookie.logistics, "/api/qhse/criteria", { code: "x1", label: "Test", category: "cabin" })).status).toBe(403);
    expect((await call("PATCH", cookie.logistics, `/api/qhse/criteria/${cabinId}`, { active: true })).status).toBe(403);

    // Corps invalides : 400.
    expect((await call("POST", cookie.admin, "/api/qhse/inspections", { ...payload(ownDriver.id), items: [] })).status).toBe(400);
    expect((await call("POST", cookie.admin, "/api/qhse/inspections", { ...payload(ownDriver.id), vehicleId: 2147483648 })).status).toBe(400);
    expect((await call("POST", cookie.admin, "/api/qhse/inspections", payload(ownDriver.id, [
      { criterionId: cabinId, conform: true }, { criterionId: cabinId, conform: false },
    ]))).status).toBe(400);
    // Critère de l'autre grille, inexistant : 400. Véhicule ou chauffeur inconnu : 404.
    expect((await call("POST", cookie.admin, "/api/qhse/inspections", payload(ownDriver.id, [{ criterionId: stopId, conform: true }]))).status).toBe(400);
    expect((await call("POST", cookie.admin, "/api/qhse/inspections", payload(ownDriver.id, [{ criterionId: 2147483647, conform: true }]))).status).toBe(400);
    expect((await call("POST", cookie.admin, "/api/qhse/inspections", { ...payload(ownDriver.id), vehicleId: 2147483647 })).status).toBe(404);
    expect((await call("POST", cookie.admin, "/api/qhse/inspections", payload(2147483647))).status).toBe(404);

    // Saisie par les trois rôles autorisés.
    const created = await call("POST", cookie.admin, "/api/qhse/inspections", payload(ownDriver.id));
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ kind: "cabin", driverId: ownDriver.id, inspectorId: admin.id, nonConformCount: 1 });
    expect(created.body.items[0]).toMatchObject({ criterionId: cabinId, conform: false, observation: "Ceinture non portée" });
    expect(typeof created.body.items[0].code).toBe("string");
    const byManagement = await call("POST", cookie.management, "/api/qhse/inspections", payload(otherDriver.id));
    expect(byManagement.status).toBe(201);
    expect((await call("POST", cookie.logistics, "/api/qhse/inspections", payload(otherDriver.id))).status).toBe(201);

    // Le client ne peut pas écrire l'inspecteur ni l'audit.
    const forged = await call("POST", cookie.admin, "/api/qhse/inspections", { ...payload(ownDriver.id), inspectorId: workshop.id });
    expect(forged.status).toBe(201);
    expect(forged.body.inspectorId).toBe(admin.id);

    // Personnel : voit tout, filtres.
    const all = await call("GET", cookie.management, `/api/qhse/inspections?driverId=${otherDriver.id}`);
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(2);
    expect((await call("GET", cookie.management, "/api/qhse/inspections?kind=bogus")).status).toBe(400);
    expect((await call("GET", cookie.management, "/api/qhse/inspections?driverId=2147483648")).status).toBe(400);

    // Chauffeur : ses seuls contrôles, en liste comme en détail.
    const mine = await call("GET", cookie.driverUser, "/api/qhse/inspections");
    expect(mine.status).toBe(200);
    expect(mine.body.items.length).toBe(2);
    expect(mine.body.items.every((i: { driverId: number }) => i.driverId === ownDriver.id)).toBe(true);
    // Un filtre sur un autre chauffeur ne contourne pas la cloison.
    const spoof = await call("GET", cookie.driverUser, `/api/qhse/inspections?driverId=${otherDriver.id}`);
    expect(spoof.status).toBe(200);
    expect(spoof.body.total).toBe(0);
    expect((await call("GET", cookie.driverUser, `/api/qhse/inspections/${created.body.id}`)).status).toBe(200);
    expect((await call("GET", cookie.driverUser, `/api/qhse/inspections/${byManagement.body.id}`)).status).toBe(403);
    expect((await call("GET", cookie.driverUser, "/api/qhse/inspections/2147483647")).status).toBe(403);
    // Compte chauffeur sans fiche liée : rien.
    const none = await call("GET", cookie.driverNoProfile, "/api/qhse/inspections");
    expect(none.status).toBe(200);
    expect(none.body.total).toBe(0);
    // Détail côté personnel : 200, absent 404.
    expect((await call("GET", cookie.logistics, `/api/qhse/inspections/${byManagement.body.id}`)).status).toBe(200);
    expect((await call("GET", cookie.logistics, "/api/qhse/inspections/2147483647")).status).toBe(404);
    expect((await call("GET", cookie.logistics, "/api/qhse/inspections/0")).status).toBe(400);

    // Grille : création, doublon, désactivation (le critère inactif est refusé en saisie).
    const code = criterionCodes[0];
    const newCriterion = await call("POST", cookie.management, "/api/qhse/criteria", { code, label: "Critère de test", category: "stop" });
    expect(newCriterion.status).toBe(201);
    expect((await call("POST", cookie.admin, "/api/qhse/criteria", { code, label: "Doublon", category: "stop" })).status).toBe(409);
    expect((await call("POST", cookie.admin, "/api/qhse/criteria", { code: "Mauvais Code", label: "Test", category: "stop" })).status).toBe(400);
    const stopPayload = (criterionId: number) => ({ ...payload(ownDriver.id), kind: "stop", items: [{ criterionId, conform: true }] });
    expect((await call("POST", cookie.admin, "/api/qhse/inspections", stopPayload(newCriterion.body.id))).status).toBe(201);
    const deactivated = await call("PATCH", cookie.admin, `/api/qhse/criteria/${newCriterion.body.id}`, { active: false, label: "Critère de test renommé" });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body).toMatchObject({ active: false, label: "Critère de test renommé" });
    expect((await call("POST", cookie.admin, "/api/qhse/inspections", stopPayload(newCriterion.body.id))).status).toBe(400);
    expect((await call("PATCH", cookie.admin, `/api/qhse/criteria/${newCriterion.body.id}`, {})).status).toBe(400);
    expect((await call("PATCH", cookie.admin, "/api/qhse/criteria/2147483647", { active: true })).status).toBe(404);

    // L'historique garde le libellé d'origine après le renommage.
    const history = await call("GET", cookie.admin, `/api/qhse/inspections?kind=stop&driverId=${ownDriver.id}`);
    expect(history.body.items[0].items[0].label).toBe("Critère de test");

    // Une erreur ne montre ni SQL ni trace.
    const dup = await call("POST", cookie.admin, "/api/qhse/criteria", { code, label: "Doublon", category: "stop" });
    expect(JSON.stringify(dup.body)).not.toMatch(/duplicate key|constraint|qhse_inspection_criteria/i);
  });

  it("init-database : tables créées, second démarrage sans écriture, aucun critère réécrit", async () => {
    await initializeDatabase();
    const tables = ["qhse_inspection_criteria", "qhse_inspections"];
    const counters = async () => {
      await pool.query("SELECT pg_stat_force_next_flush()").catch(() => undefined);
      const { rows } = await pool.query(
        `SELECT relname, n_tup_ins, n_tup_upd, n_tup_del FROM pg_stat_user_tables WHERE relname = ANY($1) ORDER BY relname`,
        [tables],
      );
      return rows.map((r) => `${r.relname}:${r.n_tup_ins}/${r.n_tup_upd}/${r.n_tup_del}`);
    };
    const { rows: seeded } = await pool.query(`SELECT count(*)::int AS n FROM qhse_inspection_criteria WHERE code LIKE 'cabin\\_%' OR code LIKE 'stop\\_%'`);
    expect(seeded[0].n).toBeGreaterThanOrEqual(16);
    const before = await counters();
    expect(before).toHaveLength(2);
    await initializeDatabase();
    expect(await counters()).toEqual(before);
    // Les contraintes de base refusent une nature inconnue.
    await expect(pool.query(`INSERT INTO qhse_inspection_criteria (code, label, category) VALUES ('zz_test_${Date.now()}', 'x', 'road')`)).rejects.toThrow();
  });
});
