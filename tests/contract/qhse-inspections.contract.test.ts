import { createServer, type Server } from "http";
import { inArray } from "drizzle-orm";
import type { PoolClient } from "@neondatabase/serverless";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db, pool } from "../../server/db";
import { initializeDatabase, QHSE_INSPECTIONS_SQL, reportCdcConstraintGaps } from "../../server/init-database";
import { drivers, qhseInspectionCriteria, qhseInspections } from "../../shared/schema";
import type { CreateQhseInspectionRequest } from "../../shared/contracts/qhse-inspections";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { expectStatus } from "../support/expect-status";
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
  expect(res.status, `login ${username} : ${await res.clone().text()}`).toBe(200);
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
    expectStatus(await call("GET", null, "/api/qhse/inspections"), 404);
    expectStatus(await call("GET", null, "/api/qhse/criteria"), 404);
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
    expectStatus(cabin, 200);
    expect(cabin.body.length, JSON.stringify(cabin.body)).toBeGreaterThanOrEqual(10);
    const stop = await call("GET", cookie.logistics, "/api/qhse/criteria?category=stop");
    const cabinId = cabin.body[0].id as number;
    const stopId = stop.body[0].id as number;

    const payload = (driverId: number, items: CreateQhseInspectionRequest["items"] = [{ criterionId: cabinId, conform: false, observation: "Ceinture non portée" }]) => ({
      kind: "cabin",
      location: "Aire de Douala",
      vehicleId: vehicle.id,
      driverId,
      items,
      generalObservation: "RAS par ailleurs",
    });

    // 401 sans session.
    expectStatus(await call("GET", null, "/api/qhse/inspections"), 401);
    expectStatus(await call("POST", null, "/api/qhse/inspections", payload(ownDriver.id)), 401);

    // 403 : rôles hors saisie, y compris le chauffeur en écriture et en lecture de la grille.
    for (const role of ["workshop", "client", "driverUser"]) {
      expectStatus(await call("POST", cookie[role], "/api/qhse/inspections", payload(ownDriver.id)), 403);
      expectStatus(await call("GET", cookie[role], "/api/qhse/criteria"), 403);
      expectStatus(await call("POST", cookie[role], "/api/qhse/criteria", { code: "x1", label: "Test", category: "cabin" }), 403);
    }
    expectStatus(await call("GET", cookie.workshop, "/api/qhse/inspections"), 403);
    expectStatus(await call("GET", cookie.client, "/api/qhse/inspections"), 403);
    // La logistique saisit mais ne configure pas la grille.
    expectStatus(await call("POST", cookie.logistics, "/api/qhse/criteria", { code: "x1", label: "Test", category: "cabin" }), 403);
    expectStatus(await call("PATCH", cookie.logistics, `/api/qhse/criteria/${cabinId}`, { active: true }), 403);

    // Corps invalides : 400.
    expectStatus(await call("POST", cookie.admin, "/api/qhse/inspections", { ...payload(ownDriver.id), items: [] }), 400);
    expectStatus(await call("POST", cookie.admin, "/api/qhse/inspections", { ...payload(ownDriver.id), vehicleId: 2147483648 }), 400);
    expectStatus(await call("POST", cookie.admin, "/api/qhse/inspections", payload(ownDriver.id, [
      { criterionId: cabinId, conform: true }, { criterionId: cabinId, conform: false },
    ])), 400);
    // Critère de l'autre grille, inexistant : 400. Véhicule ou chauffeur inconnu : 404.
    expectStatus(await call("POST", cookie.admin, "/api/qhse/inspections", payload(ownDriver.id, [{ criterionId: stopId, conform: true }])), 400);
    expectStatus(await call("POST", cookie.admin, "/api/qhse/inspections", payload(ownDriver.id, [{ criterionId: 2147483647, conform: true }])), 400);
    expectStatus(await call("POST", cookie.admin, "/api/qhse/inspections", { ...payload(ownDriver.id), vehicleId: 2147483647 }), 404);
    expectStatus(await call("POST", cookie.admin, "/api/qhse/inspections", payload(2147483647)), 404);

    // Saisie par les trois rôles autorisés.
    const created = await call("POST", cookie.admin, "/api/qhse/inspections", payload(ownDriver.id));
    expectStatus(created, 201);
    expect(created.body).toMatchObject({ kind: "cabin", driverId: ownDriver.id, inspectorId: admin.id, nonConformCount: 1 });
    expect(created.body.items[0]).toMatchObject({ criterionId: cabinId, conform: false, observation: "Ceinture non portée" });
    expect(typeof created.body.items[0].code).toBe("string");
    const byManagement = await call("POST", cookie.management, "/api/qhse/inspections", payload(otherDriver.id));
    expectStatus(byManagement, 201);
    expectStatus(await call("POST", cookie.logistics, "/api/qhse/inspections", payload(otherDriver.id)), 201);

    // Date du contrôle dans le futur (au-delà de la tolérance de 5 min) : 400.
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    expectStatus(await call("POST", cookie.admin, "/api/qhse/inspections", { ...payload(ownDriver.id), inspectedAt: tomorrow }), 400);

    // Filtres from/to sur le jour Africa/Douala (UTC+1) : 2026-01-14T23:30Z est le 15 janvier à 00 h 30 locale.
    const lateNight = await call("POST", cookie.admin, "/api/qhse/inspections", {
      ...payload(otherDriver.id), inspectedAt: "2026-01-14T23:30:00.000Z",
    });
    expectStatus(lateNight, 201);
    const onDay = async (from: string, to: string) =>
      (await call("GET", cookie.admin, `/api/qhse/inspections?driverId=${otherDriver.id}&from=${from}&to=${to}`)).body.items
        .map((i: { id: number }) => i.id);
    expect(await onDay("2026-01-15", "2026-01-15")).toEqual([lateNight.body.id]);
    expect(await onDay("2026-01-14", "2026-01-14")).toEqual([]);
    await db.delete(qhseInspections).where(inArray(qhseInspections.id, [lateNight.body.id]));

    // Le client ne peut pas écrire l'inspecteur ni l'audit.
    const forged = await call("POST", cookie.admin, "/api/qhse/inspections", { ...payload(ownDriver.id), inspectorId: workshop.id });
    expectStatus(forged, 201);
    expect(forged.body.inspectorId).toBe(admin.id);

    // Personnel : voit tout, filtres.
    const all = await call("GET", cookie.management, `/api/qhse/inspections?driverId=${otherDriver.id}`);
    expectStatus(all, 200);
    expect(all.body.total).toBe(2);
    expectStatus(await call("GET", cookie.management, "/api/qhse/inspections?kind=bogus"), 400);
    expectStatus(await call("GET", cookie.management, "/api/qhse/inspections?driverId=2147483648"), 400);

    // Chauffeur : ses seuls contrôles, en liste comme en détail.
    const mine = await call("GET", cookie.driverUser, "/api/qhse/inspections");
    expectStatus(mine, 200);
    expect(mine.body.items.length).toBe(2);
    expect(mine.body.items.every((i: { driverId: number }) => i.driverId === ownDriver.id)).toBe(true);
    // Un filtre sur un autre chauffeur ne contourne pas la cloison.
    const spoof = await call("GET", cookie.driverUser, `/api/qhse/inspections?driverId=${otherDriver.id}`);
    expectStatus(spoof, 200);
    expect(spoof.body.total).toBe(0);
    expectStatus(await call("GET", cookie.driverUser, `/api/qhse/inspections/${created.body.id}`), 200);
    expectStatus(await call("GET", cookie.driverUser, `/api/qhse/inspections/${byManagement.body.id}`), 403);
    expectStatus(await call("GET", cookie.driverUser, "/api/qhse/inspections/2147483647"), 403);
    // Compte chauffeur sans fiche liée : rien.
    const none = await call("GET", cookie.driverNoProfile, "/api/qhse/inspections");
    expectStatus(none, 200);
    expect(none.body.total).toBe(0);
    // Détail pour un compte chauffeur sans fiche : 403 sur un contrôle existant comme sur un id absent.
    expectStatus(await call("GET", cookie.driverNoProfile, `/api/qhse/inspections/${created.body.id}`), 403);
    expectStatus(await call("GET", cookie.driverNoProfile, "/api/qhse/inspections/2147483647"), 403);
    // Détail côté personnel : 200, absent 404.
    expectStatus(await call("GET", cookie.logistics, `/api/qhse/inspections/${byManagement.body.id}`), 200);
    expectStatus(await call("GET", cookie.logistics, "/api/qhse/inspections/2147483647"), 404);
    expectStatus(await call("GET", cookie.logistics, "/api/qhse/inspections/0"), 400);

    // Grille : création, doublon, désactivation (le critère inactif est refusé en saisie).
    const code = criterionCodes[0];
    const newCriterion = await call("POST", cookie.management, "/api/qhse/criteria", { code, label: "Critère de test", category: "stop" });
    expectStatus(newCriterion, 201);
    expectStatus(await call("POST", cookie.admin, "/api/qhse/criteria", { code, label: "Doublon", category: "stop" }), 409);
    expectStatus(await call("POST", cookie.admin, "/api/qhse/criteria", { code: "Mauvais Code", label: "Test", category: "stop" }), 400);
    const stopPayload = (criterionId: number) => ({ ...payload(ownDriver.id), kind: "stop", items: [{ criterionId, conform: true }] });
    expectStatus(await call("POST", cookie.admin, "/api/qhse/inspections", stopPayload(newCriterion.body.id)), 201);
    const deactivated = await call("PATCH", cookie.admin, `/api/qhse/criteria/${newCriterion.body.id}`, { active: false, label: "Critère de test renommé" });
    expectStatus(deactivated, 200);
    expect(deactivated.body).toMatchObject({ active: false, label: "Critère de test renommé" });
    expectStatus(await call("POST", cookie.admin, "/api/qhse/inspections", stopPayload(newCriterion.body.id)), 400);
    expectStatus(await call("PATCH", cookie.admin, `/api/qhse/criteria/${newCriterion.body.id}`, {}), 400);
    expectStatus(await call("PATCH", cookie.admin, "/api/qhse/criteria/2147483647", { active: true }), 404);

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
    // Les contraintes de base refusent une nature inconnue, sous le nom déclaré dans shared/schema.ts.
    await expect(pool.query(`INSERT INTO qhse_inspection_criteria (code, label, category) VALUES ('zz_test_${Date.now()}', 'x', 'road')`))
      .rejects.toMatchObject({ code: "23514", constraint: "qhse_inspection_criteria_category_check" });
  });

  const QHSE_CONSTRAINTS: ReadonlyArray<readonly [string, string]> = [
    ["qhse_inspection_criteria", "qhse_inspection_criteria_code_key"],
    ["qhse_inspection_criteria", "qhse_inspection_criteria_label_check"],
    ["qhse_inspection_criteria", "qhse_inspection_criteria_category_check"],
    ["qhse_inspections", "qhse_inspections_kind_check"],
    ["qhse_inspections", "qhse_inspections_location_check"],
    ["qhse_inspections", "qhse_inspections_items_check"],
  ];

  async function inTransaction(run: (client: PoolClient) => Promise<void>) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await run(client);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  }

  const definitions = async (client: PoolClient) =>
    (await client.query(
      `SELECT conname, pg_get_constraintdef(oid) AS def, convalidated FROM pg_constraint WHERE conname = ANY($1) ORDER BY conname`,
      [QHSE_CONSTRAINTS.map(([, name]) => name)],
    )).rows.map((r) => `${r.conname} ${r.def} ${r.convalidated}`);

  it("contraintes nommées : présentes et validées, reposées si un push les a retirées", async () => {
    await inTransaction(async (client) => {
      const fresh = await definitions(client);
      expect(fresh).toHaveLength(QHSE_CONSTRAINTS.length);
      expect(fresh.every((d) => d.endsWith(" true"))).toBe(true);
      for (const [table, name] of QHSE_CONSTRAINTS) await client.query(`ALTER TABLE ${table} DROP CONSTRAINT ${name}`);
      expect(await definitions(client)).toEqual([]);
      await client.query(QHSE_INSPECTIONS_SQL);
      expect(await definitions(client)).toEqual(fresh);
      // Rejeu : aucun changement.
      await client.query(QHSE_INSPECTIONS_SQL);
      expect(await definitions(client)).toEqual(fresh);
      const warn = vi.fn();
      const gaps = await reportCdcConstraintGaps(client, { warn });
      expect(gaps.missing.filter((n) => n.startsWith("qhse_"))).toEqual([]);
      expect(gaps.notValidated.filter((n) => n.startsWith("qhse_"))).toEqual([]);
    });
  });

  it("unicité du code posée par un ancien push sous un autre nom : renommée", async () => {
    await inTransaction(async (client) => {
      await client.query(`ALTER TABLE qhse_inspection_criteria DROP CONSTRAINT qhse_inspection_criteria_code_key`);
      await client.query(`ALTER TABLE qhse_inspection_criteria ADD CONSTRAINT qhse_inspection_criteria_code_unique UNIQUE (code)`);
      await client.query(QHSE_INSPECTIONS_SQL);
      const { rows } = await client.query(
        `SELECT conname FROM pg_constraint WHERE conrelid = 'qhse_inspection_criteria'::regclass AND contype = 'u'`,
      );
      expect(rows.map((r) => r.conname)).toEqual(["qhse_inspection_criteria_code_key"]);
    });
  });

  it("ligne existante hors CHECK : contrainte laissée NOT VALID sans bloquer, signalée, écritures suivantes refusées", async () => {
    await inTransaction(async (client) => {
      await client.query(`ALTER TABLE qhse_inspection_criteria DROP CONSTRAINT qhse_inspection_criteria_category_check`);
      await client.query(
        `INSERT INTO qhse_inspection_criteria (code, label, category) VALUES ('${criterionCodes[0]}_bad', 'Hors grille', 'road')`,
      );
      await client.query(QHSE_INSPECTIONS_SQL);
      const { rows } = await client.query(
        `SELECT convalidated FROM pg_constraint WHERE conname = 'qhse_inspection_criteria_category_check'`,
      );
      expect(rows).toEqual([{ convalidated: false }]);
      const warn = vi.fn();
      expect((await reportCdcConstraintGaps(client, { warn })).notValidated).toContain("qhse_inspection_criteria_category_check");
      expect(warn).toHaveBeenCalledOnce();
      await client.query("SAVEPOINT refused");
      await expect(client.query(
        `INSERT INTO qhse_inspection_criteria (code, label, category) VALUES ('${criterionCodes[0]}_bad2', 'x', 'road')`,
      )).rejects.toMatchObject({ code: "23514", constraint: "qhse_inspection_criteria_category_check" });
      await client.query("ROLLBACK TO SAVEPOINT refused");
    });
  });
});
