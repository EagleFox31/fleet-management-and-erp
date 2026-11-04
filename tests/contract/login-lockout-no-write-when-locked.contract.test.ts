import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setAuditSink } from "../../server/lib/audit";
import { dbAuditSink } from "../../server/lib/audit-db-sink";
import { pool } from "../../server/db";
import { DbLockoutStore, storedLockoutKey } from "../../server/services/login-lockout-db-store";
import { lockoutConfigFromEnv } from "../../server/services/login-lockout-service";

/** Compte verrouillé : les refus (429) n'écrivent rien ; le verrou, l'audit « lock » et la remise à zéro restent inchangés. */

const cfg = lockoutConfigFromEnv();
const store = new DbLockoutStore();
const names: string[] = [];
const fresh = () => {
  const n = `nowrite-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  names.push(n);
  return n;
};
const row = async (name: string) =>
  (await pool.query("SELECT xmin::text AS xmin, failed_count, locked_until FROM login_attempts_by_username WHERE username_normalized = $1", [storedLockoutKey(name)])).rows[0];
const locks = async (name: string) =>
  (await pool.query("SELECT count(*)::int AS n FROM activity_logs WHERE action = 'lock' AND entity_ref = $1", [storedLockoutKey(name)])).rows[0].n as number;

beforeAll(() => setAuditSink(dbAuditSink));

afterAll(async () => {
  setAuditSink(null);
  for (const n of names) {
    await pool.query("DELETE FROM login_attempts_by_username WHERE username_normalized = $1", [storedLockoutKey(n)]);
    await pool.query("DELETE FROM activity_logs WHERE action = 'lock' AND entity_ref = $1", [storedLockoutKey(n)]);
  }
});

describe("verrou actif : refus sans écriture", () => {
  it("50 réservations refusées ne modifient pas la ligne ; un seul audit lock", async () => {
    const name = fresh();
    const now = new Date();
    for (let i = 0; i < cfg.maxAttempts; i++) expect((await store.reserve(name, now, cfg)).allowed).toBe(true);
    const locking = await store.reserve(name, now, cfg); // dépasse le seuil : pose le verrou
    expect(locking.allowed).toBe(false);
    const before = await row(name);
    expect(before.locked_until).not.toBeNull();

    const results = await Promise.all(Array.from({ length: 50 }, () => store.reserve(name, new Date(now.getTime() + 1000), cfg)));
    expect(results.every((r) => !r.allowed)).toBe(true);

    const after = await row(name);
    expect(after.xmin).toBe(before.xmin); // aucune version de ligne écrite
    expect(after.failed_count).toBe(before.failed_count);
    expect(await locks(name)).toBe(1);
  });

  it("fenêtre expirée : repart de zéro et ré-autorise", async () => {
    const name = fresh();
    const now = new Date();
    for (let i = 0; i <= cfg.maxAttempts; i++) await store.reserve(name, now, cfg);
    const later = new Date(now.getTime() + (cfg.lockMinutes + 1) * 60_000);
    const r = await store.reserve(name, later, cfg);
    expect(r.allowed).toBe(true);
    expect(r.state.failedCount).toBe(1);
    expect(r.state.lockedUntil).toBeNull();
  });
});
