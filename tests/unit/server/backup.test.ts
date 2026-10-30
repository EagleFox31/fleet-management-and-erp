import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BackupCryptoError,
  decryptFile,
  encryptFile,
  parseBackupKey,
} from "../../../server/lib/backup/encrypt";
import { LocalBackupStorage } from "../../../server/lib/backup/storage";
import { parsePgDumpMajor, BackupDumpError } from "../../../server/lib/backup/dump";
import {
  isBackupDue,
  isBackupScheduleEnabled,
  retentionCutoff,
  runBackup,
  type BackupDeps,
  type BackupRunRecord,
} from "../../../server/jobs/backup";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "fm-backup-test-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("isBackupScheduleEnabled", () => {
  it("active en production seulement, sauf interrupteur explicite", () => {
    expect(isBackupScheduleEnabled({ NODE_ENV: "production" })).toBe(true);
    expect(isBackupScheduleEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(isBackupScheduleEnabled({})).toBe(false);
    expect(isBackupScheduleEnabled({ NODE_ENV: "development", BACKUP_ENABLED: "1" })).toBe(true);
    expect(isBackupScheduleEnabled({ NODE_ENV: "production", BACKUP_ENABLED: "0" })).toBe(false);
  });
});

describe("chiffrement AES-256-GCM", () => {
  const key = randomBytes(32);

  it("aller-retour identique", async () => {
    const plain = path.join(dir, "p.bin");
    const enc = path.join(dir, "p.enc");
    const back = path.join(dir, "p.out");
    const data = randomBytes(300_000);
    await writeFile(plain, data);
    const { sizeBytes, checksum } = await encryptFile(plain, enc, key);
    expect(sizeBytes).toBe(data.length + 4 + 12 + 16);
    expect(checksum).toMatch(/^[0-9a-f]{64}$/);
    await decryptFile(enc, back, key);
    expect((await readFile(back)).equals(data)).toBe(true);
    expect((await readFile(enc)).includes(data.subarray(0, 64))).toBe(false);
  });

  it("refuse un fichier falsifié ou une mauvaise clé", async () => {
    const plain = path.join(dir, "p.bin");
    const enc = path.join(dir, "p.enc");
    await writeFile(plain, randomBytes(1000));
    await encryptFile(plain, enc, key);
    const bytes = await readFile(enc);
    bytes[40] ^= 0xff;
    const tampered = path.join(dir, "t.enc");
    await writeFile(tampered, bytes);
    await expect(decryptFile(tampered, path.join(dir, "o1"), key)).rejects.toMatchObject({ code: "AUTH_FAILED" });
    await expect(decryptFile(enc, path.join(dir, "o2"), randomBytes(32))).rejects.toMatchObject({ code: "AUTH_FAILED" });
  });

  it("refuse un fichier trop court", async () => {
    const f = path.join(dir, "short");
    await writeFile(f, "abc");
    await expect(decryptFile(f, path.join(dir, "o"), key)).rejects.toBeInstanceOf(BackupCryptoError);
  });

  it("valide la clé sans la divulguer", () => {
    expect(() => parseBackupKey(undefined)).toThrow(/absente/);
    expect(() => parseBackupKey("court")).toThrow(BackupCryptoError);
    expect(parseBackupKey(key.toString("hex"))).toHaveLength(32);
    expect(parseBackupKey(key.toString("base64"))).toHaveLength(32);
    try {
      parseBackupKey("secret-trop-court");
    } catch (e) {
      expect(String((e as Error).message)).not.toContain("secret-trop-court");
    }
  });
});

describe("stockage local", () => {
  it("refuse uploads/ et les noms dangereux", async () => {
    expect(() => new LocalBackupStorage(path.resolve(process.cwd(), "uploads", "x"))).toThrow();
    const s = new LocalBackupStorage(dir);
    await expect(s.prepare("../evil")).rejects.toThrow();
    const p = await s.prepare("ok.dump.enc");
    await writeFile(p, "x");
    expect(await s.exists("ok.dump.enc")).toBe(true);
    await s.remove("ok.dump.enc");
    expect(await s.exists("ok.dump.enc")).toBe(false);
  });
});

describe("pg_dump", () => {
  it("lit la version majeure", () => {
    expect(parsePgDumpMajor("pg_dump (PostgreSQL) 16.4")).toBe(16);
    expect(parsePgDumpMajor("pg_dump (PostgreSQL) 17.0 (Debian 17.0-1)")).toBe(17);
    expect(parsePgDumpMajor("rien")).toBeNull();
  });
});

describe("décisions de planification", () => {
  const now = new Date("2026-11-02T10:00:00Z");
  it("rattrapage : due si aucune réussite ou plus de 24 h", () => {
    expect(isBackupDue(null, now)).toBe(true);
    expect(isBackupDue(new Date("2026-11-01T09:59:00Z"), now)).toBe(true);
    expect(isBackupDue(new Date("2026-11-01T10:00:00Z"), now)).toBe(false);
    expect(isBackupDue(new Date("2026-11-02T09:00:00Z"), now)).toBe(false);
  });
  it("purge au-delà de 12 mois", () => {
    expect(retentionCutoff(now).toISOString()).toBe("2025-11-02T10:00:00.000Z");
  });
});

function makeDeps(over: Partial<BackupDeps> = {}) {
  const rows: BackupRunRecord[] = [];
  const removed: string[] = [];
  const notified: Array<{ runId: number; errorCode: string }> = [];
  let held = false;
  let clock = new Date("2026-11-02T10:00:00Z");
  const deps: BackupDeps = {
    now: () => clock,
    tmpDir: dir,
    repo: {
      async insertRunning(startedAt) {
        const r: BackupRunRecord = { id: rows.length + 1, startedAt, finishedAt: null, status: "running", sizeBytes: null, durationMs: null, checksum: null, errorCode: null, fileName: null };
        rows.push(r);
        return { id: r.id };
      },
      async finish(id, patch) {
        Object.assign(rows.find((r) => r.id === id)!, patch);
      },
      async lastSuccessAt() {
        const ok = rows.filter((r) => r.status === "success").map((r) => r.finishedAt!.getTime());
        return ok.length ? new Date(Math.max(...ok)) : null;
      },
      async deleteOlderThan(cutoff) {
        const old = rows.filter((r) => r.startedAt < cutoff);
        for (const r of old) rows.splice(rows.indexOf(r), 1);
        return old.map((r) => r.fileName).filter((f): f is string => !!f);
      },
    },
    storage: {
      async prepare(n) { return path.join(dir, n); },
      async remove(n) { removed.push(n); },
      async exists() { return true; },
      async list() { return []; },
    },
    lock: {
      async tryAcquire() { if (held) return false; held = true; return true; },
      async release() { held = false; },
    },
    dump: async (out) => { await writeFile(out, "dump"); },
    encrypt: async (i, o) => encryptFile(i, o, randomBytes(32)),
    notifyFailure: async (i) => { notified.push(i); },
    ...over,
  };
  return { deps, rows, removed, notified, setClock: (d: Date) => (clock = d) };
}

describe("runBackup", () => {
  it("succès : ligne success, checksum, pas d'alerte", async () => {
    const { deps, rows, notified } = makeDeps();
    const r = await runBackup(deps);
    expect(r.kind).toBe("success");
    expect(rows[0]).toMatchObject({ status: "success", errorCode: null });
    expect(rows[0].checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(notified).toEqual([]);
  });

  it("n'exécute pas deux fois dans les 24 h, rattrape ensuite", async () => {
    const { deps, rows, setClock } = makeDeps();
    await runBackup(deps);
    expect((await runBackup(deps)).kind).toBe("skipped_recent");
    setClock(new Date("2026-11-05T10:00:00Z")); // instance endormie 3 jours
    expect((await runBackup(deps)).kind).toBe("success");
    expect(rows.filter((r) => r.status === "success")).toHaveLength(2);
  });

  it("verrou : une seconde exécution simultanée est ignorée", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { deps, rows } = makeDeps({ dump: async (o) => { await gate; await writeFile(o, "d"); } });
    const first = runBackup(deps);
    await new Promise((r) => setTimeout(r, 10));
    expect((await runBackup(deps, { force: true })).kind).toBe("skipped_locked");
    release();
    expect((await first).kind).toBe("success");
    expect(rows).toHaveLength(1);
  });

  it("échec : ligne failed avec code, fichier retiré, alerte envoyée", async () => {
    const { deps, rows, removed, notified } = makeDeps({
      dump: async () => { throw new BackupDumpError("PG_DUMP_MISSING", "pg_dump introuvable."); },
    });
    const r = await runBackup(deps);
    expect(r).toMatchObject({ kind: "failed", errorCode: "PG_DUMP_MISSING" });
    expect(rows[0]).toMatchObject({ status: "failed", errorCode: "PG_DUMP_MISSING" });
    expect(removed).toHaveLength(1);
    expect(notified).toEqual([{ runId: 1, errorCode: "PG_DUMP_MISSING" }]);
    expect((await runBackup(deps)).kind).toBe("failed"); // le verrou a bien été relâché
  });

  it("purge les exécutions de plus de 12 mois et leurs fichiers", async () => {
    const { deps, rows, removed } = makeDeps();
    rows.push({ id: 99, startedAt: new Date("2025-01-01T00:00:00Z"), finishedAt: new Date("2025-01-01T00:01:00Z"), status: "success", sizeBytes: 1, durationMs: 1, checksum: "x", errorCode: null, fileName: "ancien.dump.enc" });
    rows.push({ id: 98, startedAt: new Date("2026-06-01T00:00:00Z"), finishedAt: new Date("2026-06-01T00:01:00Z"), status: "success", sizeBytes: 1, durationMs: 1, checksum: "x", errorCode: null, fileName: "recent.dump.enc" });
    await runBackup(deps, { force: true });
    expect(removed).toContain("ancien.dump.enc");
    expect(removed).not.toContain("recent.dump.enc");
    expect(rows.find((r) => r.id === 99)).toBeUndefined();
    expect(rows.find((r) => r.id === 98)).toBeDefined();
  });
});

