import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../server/db";
import { setAuditSink, type AuditEntry } from "../../server/lib/audit";
import { DbLockoutStore, storedLockoutKey } from "../../server/services/login-lockout-db-store";
import { initializeDatabase } from "../../server/init-database";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser } from "../support/factories";

// Nom reserve a ce fichier : seule cette ligne est creee puis nettoyee.
const U = "lot-be1-lockout-probe";
const cfg = { maxAttempts: 5, lockMinutes: 15 };
const audits: AuditEntry[] = [];
const ids = createIdBag();

describe("DbLockoutStore", { timeout: 60_000 }, () => {
  const store = new DbLockoutStore();
  beforeAll(async () => {
    await initializeDatabase();
    setAuditSink(async (e) => void audits.push(e));
    await pool.query("DELETE FROM login_attempts_by_username WHERE username_normalized = ANY($1)", [[U, storedLockoutKey(U)]]);
  }, 90_000);
  afterAll(async () => {
    setAuditSink(null);
    await cleanupCreated(ids);
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

  it("réservation : 20 en parallèle, exactement maxAttempts admises, un seul blocage audité", async () => {
    await store.reset(U);
    audits.length = 0;
    const now = new Date();
    const reservations = await Promise.all(Array.from({ length: 20 }, () => store.reserve(U, now, cfg)));
    expect(reservations.filter((r) => r.allowed)).toHaveLength(cfg.maxAttempts);
    // Les admises échouent en même temps : le verrou, déjà posé au premier dépassement, n'est pas réaudité.
    await Promise.all(Array.from({ length: cfg.maxAttempts }, () => store.confirmFailure(U, now, cfg)));
    const s = await store.get(U);
    expect(s.lockedUntil!.getTime()).toBeGreaterThan(now.getTime());
    expect(audits.filter((a) => a.action === "lock")).toHaveLength(1);
    expect((await store.reserve(U, now, cfg)).allowed).toBe(false);
  });

  it("réservation séquentielle : verrou au maxAttempts-ième échec confirmé, release rend la tentative", async () => {
    await store.reset(U);
    audits.length = 0;
    const now = new Date();
    expect((await store.reserve(U, now, cfg)).allowed).toBe(true);
    await store.release(U, now);
    expect((await store.get(U)).failedCount).toBe(0);
    for (let i = 0; i < cfg.maxAttempts; i++) {
      expect((await store.reserve(U, now, cfg)).allowed).toBe(true);
      await store.confirmFailure(U, now, cfg);
    }
    expect((await store.get(U)).lockedUntil).not.toBeNull();
    expect(audits.filter((a) => a.action === "lock")).toHaveLength(1);
    // Verrou expiré : la réservation repart de un.
    const later = new Date(now.getTime() + (cfg.lockMinutes + 1) * 60_000);
    expect(await store.reserve(U, later, cfg)).toMatchObject({ allowed: true, state: { failedCount: 1, lockedUntil: null } });
    await store.reset(U);
  });

  /**
   * Une reservation lit puis ecrit sous le verrou consultatif de la cle. Un reset (DELETE) ou un release
   * (UPDATE) hors verrou s'intercalait entre les deux : la reservation reecrivait l'ancien compteur + 1,
   * et un echec unique apres une connexion reussie etait compte deux fois.
   */
  it.each([
    ["reset", () => store.reset(U), 0],
    ["release", () => store.release(U, new Date()), 1],
  ] as const)("%s attend le verrou de la cle tenu par une reservation en cours", async (_label, write, expected) => {
    await store.reset(U);
    const now = new Date();
    await store.reserve(U, now, cfg);
    await store.reserve(U, now, cfg);
    const holder = await pool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", ["fleet-lockout:" + storedLockoutKey(U)]);
      let done = false;
      pending = write().then(() => (done = true));
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(done, "ecriture faite sans attendre le verrou").toBe(false);
      expect((await store.get(U)).failedCount).toBe(2);
    } finally {
      await holder.query("COMMIT").catch(() => undefined);
      holder.release();
      await pending;
    }
    expect((await store.get(U)).failedCount).toBe(expected);
  });
  it("deverrouillage admin : attend le verrou de la cle, compteur et miroir remis a zero ensemble", async () => {
    const user = await createTestUser({ role: "technician" });
    ids.userIds.push(user.id);
    const name = user.username.trim().toLowerCase();
    const now = new Date();
    await store.reserve(name, now, cfg);
    await store.confirmFailure(name, now, cfg);
    await store.reserve(name, now, cfg);
    await store.confirmFailure(name, now, cfg);
    const mirror = async () =>
      Number((await pool.query("SELECT failed_login_count FROM users WHERE id = $1", [user.id])).rows[0].failed_login_count);
    expect(await mirror()).toBe(2);
    const holder = await pool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", ["fleet-lockout:" + storedLockoutKey(name)]);
      let done = false;
      pending = store.unlockUser(user.id, null).then(() => (done = true));
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(done, "deverrouillage fait sans attendre le verrou").toBe(false);
      expect((await store.get(name)).failedCount).toBe(2);
      expect(await mirror(), "miroir remis a zero avant le compteur").toBe(2);
    } finally {
      await holder.query("COMMIT").catch(() => undefined);
      holder.release();
      await pending;
    }
    expect((await store.get(name)).failedCount).toBe(0);
    expect(await mirror()).toBe(0);
  });
});
