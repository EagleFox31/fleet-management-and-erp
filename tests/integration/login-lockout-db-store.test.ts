import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../server/db";
import { setAuditSink, type AuditEntry } from "../../server/lib/audit";
import { DbLockoutStore, storedLockoutKey } from "../../server/services/login-lockout-db-store";
import { initializeDatabase } from "../../server/init-database";

// Nom reserve a ce fichier : seule cette ligne est creee puis nettoyee.
const U = "lot-be1-lockout-probe";
const cfg = { maxAttempts: 5, lockMinutes: 15 };
const audits: AuditEntry[] = [];

describe("DbLockoutStore", { timeout: 60_000 }, () => {
  const store = new DbLockoutStore();
  beforeAll(async () => {
    await initializeDatabase();
    setAuditSink(async (e) => void audits.push(e));
    await pool.query("DELETE FROM login_attempts_by_username WHERE username_normalized = ANY($1)", [[U, storedLockoutKey(U)]]);
  }, 90_000);
  afterAll(async () => {
    setAuditSink(null);
    await pool.query("DELETE FROM login_attempts_by_username WHERE username_normalized = ANY($1)", [[U, storedLockoutKey(U)]]);
  });

  it("10 echecs simultanes : compteur exact, un seul blocage audite", async () => {
    const now = new Date();
    await Promise.all(Array.from({ length: 10 }, () => store.registerFailure(U, now, cfg)));
    const s = await store.get(U);
    expect(s.failedCount).toBe(10);
    expect(s.lockedUntil!.getTime()).toBeGreaterThan(now.getTime());
    expect(audits.filter((a) => a.action === "lock")).toHaveLength(1);
  });

  it("M3 : ni le compteur ni l'audit d'un nom inconnu ne portent le nom saisi", async () => {
    const { rows } = await pool.query(
      "SELECT username_normalized FROM login_attempts_by_username WHERE username_normalized = ANY($1)",
      [[U, `pwd:${U}`, storedLockoutKey(U)]],
    );
    expect(rows.map((r) => r.username_normalized)).toEqual([storedLockoutKey(U)]);
    expect(storedLockoutKey(U)).toMatch(/^pwdh1:[0-9a-f]{64}$/);
    expect(storedLockoutKey(`  ${U.toUpperCase()} `), "même normalisation que le garde").toBe(storedLockoutKey(U));
    const lock = audits.find((a) => a.action === "lock")!;
    expect(lock.entityId).toBe(storedLockoutKey(U));
    expect(JSON.stringify(lock)).not.toContain(U);
  });

  it("verrou expire : le prochain echec repart a 1 ; reset supprime la ligne", async () => {
    const later = new Date(Date.now() + 16 * 60_000);
    const s = await store.registerFailure(U, later, cfg);
    expect(s.failedCount).toBe(1);
    expect(s.lockedUntil).toBeNull();
    await store.reset(U);
    expect((await store.get(U)).failedCount).toBe(0);
  });
});
