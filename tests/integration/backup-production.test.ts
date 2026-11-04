import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, pool } from "../../server/db";
import { BACKUP_LOCK_KEY } from "../../server/jobs/backup";
import { backupRuns } from "../../shared/schema";
import { createAdvisoryBackupLock, createDrizzleBackupRepository } from "../../server/jobs/backup-production";
import { uniqueTestToken } from "../support/ids";

/** Verrou consultatif et dépôt `backup_runs` : jamais de pg_dump ici. */

const createdIds: number[] = [];

afterAll(async () => {
  for (const id of createdIds) await db.delete(backupRuns).where(eq(backupRuns.id, id));
  // Pas de listenerPool.end() : avec isolate: false, le pool est partagé par toute la suite,
  // et un end() bloqué sur une connexion non rendue faisait échouer le fichier entier (#298).
});

describe("verrou consultatif de sauvegarde", { timeout: 30_000 }, () => {
  it("deux exécutions simultanées : une seule obtient le verrou, puis il est relâché", async () => {
    // Clé propre au passage (#298) : celle de production est commune à la base, un serveur
    // local qui sauvegarde sur la même base de test la tient et rendait le test instable.
    const key = uniqueTestToken("backup-lock");
    const a = createAdvisoryBackupLock(key);
    const b = createAdvisoryBackupLock(key);
    // Prévention #298 : un autre détenteur de la clé de production (serveur local qui
    // sauvegarde sur la même base) ne doit pas faire échouer le test.
    const other = await pool.connect();
    // try : si un autre la tient déjà, la condition du test est réunie quand même.
    await other.query("SELECT pg_try_advisory_lock(hashtext($1))", [BACKUP_LOCK_KEY]);
    try {
      expect(await a.tryAcquire()).toBe(true);
      expect(await b.tryAcquire()).toBe(false);
      await a.release();
      expect(await b.tryAcquire()).toBe(true);
    } finally {
      // Toujours rendre les connexions, même en échec : sinon le verrou et la connexion fuient.
      await a.release();
      await b.release();
      await other.query("SELECT pg_advisory_unlock(hashtext($1))", [BACKUP_LOCK_KEY]).catch(() => undefined);
      other.release();
    }
  });
});

describe("verrou consultatif de sauvegarde : clé de production", { timeout: 30_000 }, () => {
  it("sans clé, le verrou prend BACKUP_LOCK_KEY : un détenteur existant le bloque", async () => {
    const other = await pool.connect();
    const lock = createAdvisoryBackupLock();
    try {
      const { rows } = await other.query("SELECT pg_try_advisory_lock(hashtext($1)) AS ok", [BACKUP_LOCK_KEY]);
      if (rows[0]?.ok !== true) return; // déjà tenu ailleurs (serveur local) : rien à prouver ici
      expect(await lock.tryAcquire()).toBe(false);
    } finally {
      await lock.release();
      await other.query("SELECT pg_advisory_unlock(hashtext($1))", [BACKUP_LOCK_KEY]).catch(() => undefined);
      other.release();
    }
  });
});

describe("dépôt backup_runs", () => {
  it("running puis success, dernière réussite, purge", async () => {
    const exists = await db.execute(sql`SELECT to_regclass('public.backup_runs') AS t`);
    if (!(exists as any).rows?.[0]?.t) return; // schéma de db-1 pas encore appliqué sur la base de test

    const repo = createDrizzleBackupRepository();
    const before = await repo.lastSuccessAt();
    const startedAt = new Date("2001-01-01T00:00:00Z");
    const { id } = await repo.insertRunning(startedAt);
    createdIds.push(id);
    await repo.finish(id, {
      status: "success",
      finishedAt: new Date("2001-01-01T00:01:00Z"),
      sizeBytes: 10,
      checksum: "abc",
      fileName: "test-integration.dump.enc",
    });
    const [row] = await db.select().from(backupRuns).where(eq(backupRuns.id, id));
    expect(row).toMatchObject({ status: "success", sizeBytes: 10, location: "test-integration.dump.enc" });
    expect((await repo.lastSuccessAt())?.getTime() ?? 0).toBeGreaterThanOrEqual(before?.getTime() ?? 0);

    const files = await repo.deleteOlderThan(new Date("2001-06-01T00:00:00Z"));
    expect(files).toContain("test-integration.dump.enc");
    createdIds.length = 0;
  });
});
