import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../../server/db";
import { uniqueTestToken } from "../support/ids";
import { deleteFuelRecordsByVehiclesRaw } from "../support/money-override";

/**
 * Réserve 5 de #287 : une alerte créée par un trigger carburant produit une notification
 * `fleet_events` (`alert_created`, ids des alertes), relayée en trame par db-event-relay.
 * La notification ne part qu'au commit : ce test commite, puis supprime ce qu'il a créé.
 * Les fonctions sont celles posées par le bootstrap de la suite (fichier de la branche).
 */
const created = { users: [] as number[], vehicles: [] as number[] };

afterAll(async () => {
  if (created.users.length) await pool.query(`DELETE FROM alerts WHERE user_id = ANY($1)`, [created.users]);
  if (created.vehicles.length) {
    await pool.query(`DELETE FROM alerts WHERE link = ANY($1)`, [created.vehicles.map((id) => `/vehicles/${id}`)]);
    await deleteFuelRecordsByVehiclesRaw(pool, created.vehicles);
    await pool.query(`DELETE FROM vehicles WHERE id = ANY($1)`, [created.vehicles]);
  }
  if (created.users.length) await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [created.users]);
});

describe("triggers d'alertes carburant : temps réel", { timeout: 120_000 }, () => {
  it("alerte du trigger : notification alert_created au commit, avec les ids des alertes créées", async () => {
    const listener = await pool.connect();
    const received: Array<{ eventType?: string; payload?: { alertIds?: number[] } }> = [];
    listener.on("notification", (msg: { channel: string; payload?: string }) => {
      if (msg.channel === "fleet_events" && msg.payload) received.push(JSON.parse(msg.payload));
    });
    try {
      await listener.query("LISTEN fleet_events");

      const token = uniqueTestToken("fuelrt");
      const { rows: u } = await pool.query(
        `INSERT INTO users (username, email, name, role, password) VALUES ($1, $2, $1, 'logistics', 'x') RETURNING id`,
        [token, `${token}@fleet.test`],
      );
      created.users.push(u[0].id);
      const { rows: v } = await pool.query(
        `INSERT INTO vehicles (registration_number, brand, model, year, mileage, last_mileage, vehicle_type, status, fuel_type)
         VALUES ($1, 'Renault', 'T480', 2021, 1000, 1000, 'porteur', 'operational', 'diesel') RETURNING id`,
        [token.slice(0, 32)],
      );
      const vehicleId = v[0].id as number;
      created.vehicles.push(vehicleId);

      // Trois intervalles à 8 L/100 km puis un à 16 : une alerte de consommation.
      for (const [date, mileage, quantity] of [
        ["2026-01-05", 1000, 40],
        ["2026-01-15", 1500, 40],
        ["2026-01-25", 2000, 40],
        ["2026-02-04", 2500, 40],
        ["2026-02-14", 3000, 80],
      ] as const) {
        await pool.query(`INSERT INTO fuel_records (vehicle_id, date, mileage, quantity, cost) VALUES ($1, $2, $3, $4, 0)`, [
          vehicleId,
          date,
          mileage,
          quantity,
        ]);
      }

      const { rows: mine } = await pool.query(`SELECT id FROM alerts WHERE user_id = $1 ORDER BY id`, [u[0].id]);
      expect(mine).toHaveLength(1);
      const alertId = mine[0].id as number;

      const deadline = Date.now() + 10_000;
      const hit = () => received.find((m) => m.eventType === "alert_created" && m.payload?.alertIds?.includes(alertId));
      while (!hit() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
      expect(hit(), "notification alert_created portant l'alerte créée").toBeTruthy();
    } finally {
      await listener.query("UNLISTEN fleet_events").catch(() => undefined);
      listener.release();
    }
  });
});
