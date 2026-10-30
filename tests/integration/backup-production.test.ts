import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, listenerPool } from "../../server/db";
import { backupRuns } from "../../shared/schema";
import { createAdvisoryBackupLock, createDrizzleBackupRepository } from "../../server/jobs/backup-production";

/** Verrou consultatif et dépôt `backup_runs` : jamais de pg_dump ici. */

const createdIds: number[] = [];

afterAll(async () => {
  for (const id of createdIds) await db.delete(backupRuns).where(eq(backupRuns.id, id));
  await (listenerPool as any).end?.();
});

describe("verrou consultatif de sauvegarde", () => {
  it("deux exécutions simultanées : une seule obtient le verrou, puis il est relâché", async () => {
    const a = createAdvisoryBackupLock();
    const b = createAdvisoryBackupLock();
    expect(await a.tryAcquire()).toBe(true);
    expect(await b.tryAcquire()).toBe(false);
    await a.release();
    expect(await b.tryAcquire()).toBe(true);
    await b.release();
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
