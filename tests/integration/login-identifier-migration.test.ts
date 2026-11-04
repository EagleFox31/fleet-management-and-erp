import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pool } from "../../server/db";
import { initializeDatabase } from "../../server/init-database";
import { CHANGE_PASSWORD_KEY_PREFIX, storedLockoutKey } from "../../server/services/login-lockout-db-store";
import { migrateLoginIdentifiers } from "../../server/services/login-identifier-migration";

// Noms réservés à ce fichier : seules ces lignes sont créées puis nettoyées.
const A = "lot-m3-migration-probe-a";
const B = "lot-m3-migration-probe-b";
const CPW = `${CHANGE_PASSWORD_KEY_PREFIX}999999901`;
const KEYS = [A, `pwd:${A}`, storedLockoutKey(A), CPW];
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
});
