import { readFileSync } from "node:fs";
import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it } from "vitest";
import { pool } from "../../server/db";
import { uniqueTestToken } from "../support/ids";

/**
 * Triggers d'alertes carburant (retirés de #263, réécrits) : installés puis exercés dans une
 * transaction annulée, pour ne rien laisser sur la base partagée ni déclencher d'alerte chez
 * les autres suites.
 *
 * Preuve rouge : FUEL_ALERTS_SQL=<fichiers séparés par des virgules> rejoue le test sur une autre
 * version (l'originale échouait au 2e plein : AVG(LAG() OVER), format('%.1f'), user_id = 1).
 */
const SQL_FILES = (process.env.FUEL_ALERTS_SQL ?? "server/db/triggers/fuel-alerts-triggers.sql").split(",");

async function inRolledBackTransaction(run: (client: PoolClient, notices: string[]) => Promise<void>) {
  const client = await pool.connect();
  const notices: string[] = [];
  const onNotice = (msg: { message?: string }) => notices.push(String(msg.message ?? ""));
  client.on("notice", onNotice);
  try {
    await client.query("BEGIN");
    for (const file of SQL_FILES) await client.query(readFileSync(file, "utf8"));
    await run(client, notices);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.off("notice", onNotice);
    client.release();
  }
}

async function user(client: PoolClient, role: string): Promise<number> {
  const token = uniqueTestToken("fuelalert");
  const { rows } = await client.query(
    `INSERT INTO users (username, email, name, role, password) VALUES ($1, $2, $1, $3, 'x') RETURNING id`,
    [token, `${token}@fleet.test`, role],
  );
  return rows[0].id;
}

async function vehicle(client: PoolClient): Promise<{ id: number; plate: string }> {
  const plate = uniqueTestToken("veh").slice(0, 32);
  const { rows } = await client.query(
    `INSERT INTO vehicles (registration_number, brand, model, year, mileage, last_mileage, vehicle_type, status, fuel_type)
     VALUES ($1, 'Renault', 'T480', 2021, 1000, 1000, 'porteur', 'operational', 'diesel') RETURNING id`,
    [plate],
  );
  return { id: rows[0].id, plate };
}

/** Insère un plein ; lève si l'INSERT échoue (c'est ce qui cassait la saisie). */
async function fill(client: PoolClient, vehicleId: number, date: string, mileage: number, quantity: number, cost = 0) {
  const { rows } = await client.query(
    `INSERT INTO fuel_records (vehicle_id, date, mileage, quantity, cost) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [vehicleId, date, mileage, quantity, cost],
  );
  return rows[0].id as number;
}

/** Trois intervalles à 8 L/100 km, puis un plein à 16 L/100 km (+100 %). */
async function anomalousSeries(client: PoolClient, vehicleId: number) {
  await fill(client, vehicleId, "2026-01-05", 1000, 40);
  await fill(client, vehicleId, "2026-01-15", 1500, 40);
  await fill(client, vehicleId, "2026-01-25", 2000, 40);
  await fill(client, vehicleId, "2026-02-04", 2500, 40);
  return fill(client, vehicleId, "2026-02-14", 3000, 80);
}

async function alertsOf(client: PoolClient, userIds: number[]) {
  const { rows } = await client.query(
    `SELECT user_id, title, message, priority, link, topic, dedupe_key FROM alerts WHERE user_id = ANY($1) ORDER BY id`,
    [userIds],
  );
  return rows as Array<{ user_id: number; title: string; message: string; priority: string; link: string; topic: string; dedupe_key: string }>;
}

describe("triggers d'alertes carburant", { timeout: 120_000 }, () => {
  it("installés, chaque plein s'insère et une consommation anormale alerte les rôles configurés, une fois", async () => {
    await inRolledBackTransaction(async (client) => {
      const logistics = await user(client, "logistics");
      const technician = await user(client, "technician");
      const v = await vehicle(client);

      const lastId = await anomalousSeries(client, v.id);

      const { rows: count } = await client.query(`SELECT count(*)::int AS n FROM fuel_records WHERE vehicle_id = $1`, [v.id]);
      expect(count[0].n).toBe(5);
      const alerts = await alertsOf(client, [logistics, technician]);
      expect(alerts).toEqual([
        {
          user_id: logistics,
          title: "Consommation carburant élevée",
          message: `Véhicule ${v.plate} - Consommation +100% vs moyenne (16.0 L/100 km)`,
          priority: "high",
          link: `/vehicles/${v.id}/fuel`,
          topic: "fuel",
          dedupe_key: `fuel-consumption:${lastId}`,
        },
      ]);
    });
  });

  it("le destinataire vient de alert_recipient_settings, et une préférence coupée est respectée", async () => {
    await inRolledBackTransaction(async (client) => {
      const logistics = await user(client, "logistics");
      const technician = await user(client, "technician");
      const muted = await user(client, "technician");
      await client.query(`INSERT INTO notification_preferences (user_id, topic, in_app) VALUES ($1, 'fuel', false)`, [muted]);
      await client.query(`UPDATE alert_recipient_settings SET recipient_roles = ARRAY['technician'] WHERE alert_type = 'fuel'`);
      const v = await vehicle(client);

      await anomalousSeries(client, v.id);

      expect((await alertsOf(client, [logistics, technician, muted])).map((a) => a.user_id)).toEqual([technician]);
    });
  });

  it("une alerte en échec ne casse pas l'INSERT du plein : il est enregistré et l'échec est journalisé", async () => {
    await inRolledBackTransaction(async (client, notices) => {
      const logistics = await user(client, "logistics");
      await client.query(`ALTER TABLE alerts ADD CONSTRAINT c7_fuel_alert_block CHECK (false) NOT VALID`);
      const v = await vehicle(client);

      await anomalousSeries(client, v.id);

      const { rows } = await client.query(`SELECT count(*)::int AS n FROM fuel_records WHERE vehicle_id = $1`, [v.id]);
      expect(rows[0].n).toBe(5);
      expect(await alertsOf(client, [logistics])).toEqual([]);
      expect(notices.some((n) => n.includes("alerte non créée"))).toBe(true);
    });
  });

  it("budget du mois du plein : approche à 80 %, puis dépassement, chacun une fois ; montants arrondis", async () => {
    await inRolledBackTransaction(async (client) => {
      const logistics = await user(client, "logistics");
      const v = await vehicle(client);

      await fill(client, v.id, "2026-03-02", 1000, 10, 450000.4);
      await fill(client, v.id, "2026-03-03", 1100, 10, 1000);
      await fill(client, v.id, "2026-03-04", 1200, 10, 100000);

      const alerts = await alertsOf(client, [logistics]);
      expect(alerts.map((a) => [a.title, a.dedupe_key])).toEqual([
        ["Budget carburant en approche", `fuel-budget:${v.id}:2026-03:80`],
        ["Budget carburant dépassé", `fuel-budget:${v.id}:2026-03:exceeded`],
      ]);
      expect(alerts[0].message).toBe(`Véhicule ${v.plate} - 80% du budget mensuel atteint : 450000 F CFA / 500000 F CFA`);
      expect(alerts[1].message).toBe(`Véhicule ${v.plate} - Budget mensuel dépassé : 551000 F CFA / 500000 F CFA`);
    });
  });

  it("reprise d'historique sous suppress_side_effects : aucune alerte, puis les alertes sauvegardées s'insèrent sans 23505", async () => {
    await inRolledBackTransaction(async (client) => {
      const logistics = await user(client, "logistics");
      await client.query(`SELECT set_config('fleetos.suppress_side_effects', 'on', true)`);
      const v = await vehicle(client);

      const lastId = await anomalousSeries(client, v.id);
      expect(await alertsOf(client, [logistics])).toEqual([]);

      // Ce que fait la restauration de sauvegarde : réinsérer l'alerte déjà émise à l'origine.
      await client.query(
        `INSERT INTO alerts (user_id, title, message, type, priority, link, topic, dedupe_key)
         VALUES ($1, 'Consommation carburant élevée', 'sauvegarde', 'fuel', 'high', $2, 'fuel', $3)`,
        [logistics, `/vehicles/${v.id}`, `fuel-consumption:${lastId}`],
      );
      expect((await alertsOf(client, [logistics])).map((a) => a.message)).toEqual(["sauvegarde"]);
    });
  });

  it("délai dépassé pendant l'alerte (query_canceled, 57014) : le plein est enregistré, l'échec journalisé", async () => {
    await inRolledBackTransaction(async (client, notices) => {
      await user(client, "logistics");
      await client.query(`CREATE FUNCTION c7_cancel_alert() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'délai dépassé' USING ERRCODE = 'query_canceled'; END; $$ LANGUAGE plpgsql`);
      await client.query(`CREATE TRIGGER c7_cancel_alert BEFORE INSERT ON alerts FOR EACH ROW EXECUTE FUNCTION c7_cancel_alert()`);
      const v = await vehicle(client);

      await anomalousSeries(client, v.id);

      const { rows } = await client.query(`SELECT count(*)::int AS n FROM fuel_records WHERE vehicle_id = $1`, [v.id]);
      expect(rows[0].n).toBe(5);
      expect(notices.some((n) => n.includes("alerte non créée") && n.includes("57014"))).toBe(true);
    });
  });

  it("réinstallation idempotente : rejouer le fichier n'écrase pas le réglage des destinataires", async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query(`UPDATE alert_recipient_settings SET recipient_roles = ARRAY['technician'] WHERE alert_type = 'fuel'`);
      for (const file of SQL_FILES) await client.query(readFileSync(file, "utf8"));
      const { rows } = await client.query(`SELECT recipient_roles FROM alert_recipient_settings WHERE alert_type = 'fuel'`);
      expect(rows).toEqual([{ recipient_roles: ["technician"] }]);
    });
  });
});
