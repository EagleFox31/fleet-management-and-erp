import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pool } from "../../server/db";
import { initializeDatabase } from "../../server/init-database";
import { CHANGE_PASSWORD_KEY_PREFIX, storedLockoutKey } from "../../server/services/login-lockout-db-store";
import { migrateLoginIdentifiers, pendingLoginIdentifiers } from "../../server/services/login-identifier-migration";

// Noms réservés à ce fichier : seules ces lignes sont créées puis nettoyées.
const A = "lot-m3-migration-probe-a";
const B = "lot-m3-migration-probe-b";
const C = "lot-m3-migration-probe-c";
const D = "lot-m3-migration-probe-d";
const CPW = `${CHANGE_PASSWORD_KEY_PREFIX}999999901`;
const KEYS = [A, `pwd:${A}`, storedLockoutKey(A), CPW, C, storedLockoutKey(C), `pwd:${D}`, storedLockoutKey(D)];
// Nom inconnu numerique (M-3) : un id qui n'existe pas dans users, range dans entity_id.
const NUMERIC_NAME = 987_654_321;
const auditIds: number[] = [];

async function cleanup() {
  await pool.query("DELETE FROM login_attempts_by_username WHERE username_normalized = ANY($1)", [KEYS]);
  if (auditIds.length) await pool.query("DELETE FROM activity_logs WHERE id = ANY($1)", [auditIds]);
}

describe("reprise M3 : identifiants de connexion en clair vers leur empreinte", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    await initializeDatabase();
    await cleanup();
  }, 90_000);
  afterAll(async () => {
    vi.restoreAllMocks();
    await cleanup();
  });

  it("fusionne les deux clés en clair d'un même nom (maximum), réécrit l'audit du nom inconnu", async () => {
    const later = new Date(Date.now() + 10 * 60_000);
    const t0 = new Date(Date.now() - 60_000);
    await pool.query(
      `INSERT INTO login_attempts_by_username (username_normalized, failed_count, locked_until, last_failed_at, updated_at)
       VALUES ($1, 2, NULL, $3, $3), ($2, 5, $4, $3, $3), ($5, 1, NULL, $3, $3)`,
      [A, `pwd:${A}`, t0, later, CPW],
    );
    const audit = await pool.query(
      `INSERT INTO activity_logs (user_id, action, entity_type, entity_ref, details)
       VALUES (NULL, 'lock', 'user', $1, '{}'::jsonb), (NULL, 'unlock', 'user', $1, '{}'::jsonb) RETURNING id`,
      [`pwd:${B}`],
    );
    auditIds.push(...audit.rows.map((r) => Number(r.id)));

    const result = await migrateLoginIdentifiers();
    expect(result.attempts).toBeGreaterThanOrEqual(2);
    expect(result.audits).toBeGreaterThanOrEqual(1);

    const { rows } = await pool.query(
      "SELECT username_normalized, failed_count, locked_until FROM login_attempts_by_username WHERE username_normalized = ANY($1)",
      [KEYS],
    );
    const byKey = new Map(rows.map((r) => [r.username_normalized, r]));
    expect([...byKey.keys()].sort()).toEqual([storedLockoutKey(A), CPW].sort());
    expect(byKey.get(storedLockoutKey(A)).failed_count).toBe(5);
    expect(new Date(byKey.get(storedLockoutKey(A)).locked_until).getTime()).toBe(later.getTime());
    // Clé d'essais de change-password (par id, aucun nom saisi) : jamais convertie en empreinte.
    expect(byKey.get(CPW).failed_count).toBe(1);

    const refs = await pool.query("SELECT action, entity_ref FROM activity_logs WHERE id = ANY($1) ORDER BY action", [auditIds]);
    expect(refs.rows).toEqual([
      { action: "lock", entity_ref: storedLockoutKey(B) },
      // Seul le blocage d'un nom inconnu est réécrit : l'historique des autres actions ne bouge pas.
      { action: "unlock", entity_ref: `pwd:${B}` },
    ]);
  });

  it("second démarrage : rien à reprendre, aucune transaction ni écriture", async () => {
    const query = vi.spyOn(pool, "query");
    const connect = vi.spyOn(pool, "connect");

    expect(await migrateLoginIdentifiers()).toEqual({ attempts: 0, audits: 0 });

    // pool.query emprunte une connexion en interne : toute connexion de plus serait la transaction.
    expect(connect).toHaveBeenCalledTimes(query.mock.calls.length);
    const statements = query.mock.calls.map(([sql]) => String(typeof sql === "string" ? sql : (sql as { text?: string }).text));
    expect(statements).toHaveLength(1);
    expect(statements.filter((sql) => /\b(INSERT|UPDATE|DELETE)\b/i.test(sql))).toEqual([]);
    vi.restoreAllMocks();
  });

  it("M-3 : un nom inconnu numérique rangé dans entity_id est repris, un compte connu ne bouge pas", async () => {
    const known = await pool.query("SELECT id FROM users ORDER BY id LIMIT 1");
    const audit = await pool.query(
      `INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details)
       VALUES (NULL, 'lock', 'user', $1, '{}'::jsonb), ($2, 'lock', 'user', $2, '{}'::jsonb) RETURNING id`,
      [NUMERIC_NAME, known.rows[0].id],
    );
    const [unknownId, knownId] = audit.rows.map((r) => Number(r.id));
    auditIds.push(unknownId, knownId);

    expect((await migrateLoginIdentifiers()).audits).toBeGreaterThanOrEqual(1);
    const rows = await pool.query("SELECT id, user_id, entity_id, entity_ref FROM activity_logs WHERE id = ANY($1) ORDER BY id", [
      [unknownId, knownId],
    ]);
    expect(rows.rows).toEqual([
      { id: unknownId, user_id: null, entity_id: null, entity_ref: storedLockoutKey(String(NUMERIC_NAME)) },
      { id: knownId, user_id: known.rows[0].id, entity_id: known.rows[0].id, entity_ref: null },
    ]);
  });

  it("panne en cours de reprise : rollback, rien n'est écrit, la reprise suivante aboutit", async () => {
    const t0 = new Date(Date.now() - 60_000);
    await pool.query(
      `INSERT INTO login_attempts_by_username (username_normalized, failed_count, locked_until, last_failed_at, updated_at)
       VALUES ($1, 3, NULL, $2, $2)`,
      [C, t0],
    );
    const audit = await pool.query(
      `INSERT INTO activity_logs (user_id, action, entity_type, entity_ref, details) VALUES (NULL, 'lock', 'user', $1, '{}'::jsonb) RETURNING id`,
      [C],
    );
    const auditId = Number(audit.rows[0].id);
    auditIds.push(auditId);

    // Panne simulée sur la réécriture d'audit, après la reprise des compteurs dans la même transaction.
    const failing = {
      query: pool.query.bind(pool),
      connect: async () => {
        const client = await pool.connect();
        const real = client.query.bind(client) as (...a: unknown[]) => Promise<unknown>;
        (client as { query: unknown }).query = (sql: unknown, ...rest: unknown[]) =>
          typeof sql === "string" && sql.startsWith("UPDATE activity_logs") ? Promise.reject(new Error("panne simulée")) : real(sql, ...rest);
        // Le client retourne au pool : il n'y retourne pas piégé.
        const release = client.release.bind(client);
        client.release = ((...args: Parameters<typeof release>) => {
          (client as { query: unknown }).query = real;
          client.release = release;
          return release(...args);
        }) as typeof release;
        return client;
      },
    } as unknown as typeof pool;
    await expect(migrateLoginIdentifiers(failing)).rejects.toThrow("panne simulée");

    const keys = await pool.query("SELECT username_normalized FROM login_attempts_by_username WHERE username_normalized = ANY($1)", [
      [C, storedLockoutKey(C)],
    ]);
    expect(keys.rows.map((r) => r.username_normalized), "compteur intact").toEqual([C]);
    expect((await pool.query("SELECT entity_ref FROM activity_logs WHERE id = $1", [auditId])).rows[0].entity_ref).toBe(C);
    expect((await pendingLoginIdentifiers()).attempts).toBeGreaterThanOrEqual(1);

    await migrateLoginIdentifiers();
    const after = await pool.query("SELECT username_normalized FROM login_attempts_by_username WHERE username_normalized = ANY($1)", [
      [C, storedLockoutKey(C)],
    ]);
    expect(after.rows.map((r) => r.username_normalized)).toEqual([storedLockoutKey(C)]);
  });

  it("deux reprises simultanées : chaque ligne n'est reprise qu'une fois, sans erreur", async () => {
    const t0 = new Date(Date.now() - 60_000);
    await pool.query(
      `INSERT INTO login_attempts_by_username (username_normalized, failed_count, locked_until, last_failed_at, updated_at)
       VALUES ($1, 4, NULL, $2, $2)`,
      [`pwd:${D}`, t0],
    );
    const audit = await pool.query(
      `INSERT INTO activity_logs (user_id, action, entity_type, entity_ref, details) VALUES (NULL, 'lock', 'user', $1, '{}'::jsonb) RETURNING id`,
      [`pwd:${D}`],
    );
    const auditId = Number(audit.rows[0].id);
    auditIds.push(auditId);

    const results = await Promise.all([migrateLoginIdentifiers(), migrateLoginIdentifiers()]);
    expect(results.reduce((n, r) => n + r.attempts, 0)).toBeGreaterThanOrEqual(1);

    const rows = await pool.query(
      "SELECT username_normalized, failed_count FROM login_attempts_by_username WHERE username_normalized = ANY($1)",
      [[`pwd:${D}`, storedLockoutKey(D)]],
    );
    expect(rows.rows).toEqual([{ username_normalized: storedLockoutKey(D), failed_count: 4 }]);
    expect((await pool.query("SELECT entity_ref FROM activity_logs WHERE id = $1", [auditId])).rows[0].entity_ref).toBe(storedLockoutKey(`pwd:${D}`));
    expect(await pendingLoginIdentifiers()).toEqual({ attempts: 0, audits: 0 });
  });
});
