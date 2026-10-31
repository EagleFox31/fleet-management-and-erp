import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../server/db";
import { setAuditSink, type AuditEntry } from "../../server/lib/audit";
import { DbLockoutStore } from "../../server/services/login-lockout-db-store";
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
    await pool.query("DELETE FROM login_attempts_by_username WHERE username_normalized = $1", [U]);
  }, 90_000);
  afterAll(async () => {
    setAuditSink(null);
    await pool.query("DELETE FROM login_attempts_by_username WHERE username_normalized = $1", [U]);
  });

  it("10 echecs simultanes : compteur exact, un seul blocage audite", async () => {
    const now = new Date();
    await Promise.all(Array.from({ length: 10 }, () => store.registerFailure(U, now, cfg)));
    const s = await store.get(U);
    expect(s.failedCount).toBe(10);
    expect(s.lockedUntil!.getTime()).toBeGreaterThan(now.getTime());
    expect(audits.filter((a) => a.action === "lock")).toHaveLength(1);
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
