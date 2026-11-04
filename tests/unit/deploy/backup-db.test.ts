import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// deploy/backup-db.sh tourne par cron sur le VPS. Une compose factice remplace Docker :
// pg_dump écrit un contenu marqué, pg_restore --list ne le lit que s'il commence par PGDMP.
const root = path.resolve(__dirname, "../../..");
const script = path.join(root, "deploy/backup-db.sh");
const hasBash = spawnSync("bash", ["-c", "date -d '-1 days' +%Y%m%d"]).status === 0;

const STUB = `#!/usr/bin/env bash
case "$*" in
  *pg_dump*) [ -n "$STUB_EMPTY" ] || printf 'PGDMP%s' "$STUB_TAG" ;;
  *"pg_restore --list"*) if head -c5 | grep -q PGDMP; then printf ';\\n; Archive\\n1; 0 0 TABLE public vehicles fleet\\n'; fi ;;
esac
`;

function dayOffset(days: number): string {
  return execFileSync("bash", ["-c", `date -d '${days} days' +%Y%m%d`], { encoding: "utf-8" }).trim();
}

describe.skipIf(!hasBash)("deploy/backup-db.sh", () => {
  let dir: string;
  let backups: string;
  let stub: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "backup-db-"));
    backups = path.join(dir, "backups");
    stub = path.join(dir, "compose-stub.sh");
    writeFileSync(stub, STUB, { mode: 0o755 });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const run = (env: Record<string, string> = {}) =>
    spawnSync("bash", [script], {
      encoding: "utf-8",
      env: { ...process.env, BACKUP_DIR: backups, COMPOSE_CMD: `bash ${stub}`, ...env },
    });
  const today = () => path.join(backups, `fleet-${dayOffset(0)}.dump`);

  it("écrit le dump du jour et le valide par pg_restore --list", () => {
    const r = run({ STUB_TAG: "-a" });
    expect(r.status, r.stderr + r.stdout).toBe(0);
    expect(readFileSync(today(), "utf-8")).toBe("PGDMP-a");
    expect(r.stdout).toContain("1 entrées de catalogue");
  });

  it("relancé le même jour, remplace le dump sans doublon", () => {
    run({ STUB_TAG: "-a" });
    expect(run({ STUB_TAG: "-b" }).status).toBe(0);
    expect(readFileSync(today(), "utf-8")).toBe("PGDMP-b");
    expect(readdirSync(backups).filter((f) => f.endsWith(".dump"))).toHaveLength(1);
  });

  it("un dump vide échoue et conserve le dump précédent", () => {
    run({ STUB_TAG: "-a" });
    const r = run({ STUB_EMPTY: "1" });
    expect(r.status).not.toBe(0);
    expect(readFileSync(today(), "utf-8")).toBe("PGDMP-a");
    expect(readdirSync(backups).some((f) => f.endsWith(".partial"))).toBe(false);
  });

  it("supprime les dumps quotidiens trop vieux, jamais les autres sauvegardes", () => {
    run();
    const old = `fleet-${dayOffset(-15)}.dump`;
    const kept = `fleet-${dayOffset(-13)}.dump`;
    for (const f of [old, kept, "fleet-pre-import-20261104.dump", "autre.dump"]) {
      writeFileSync(path.join(backups, f), "x");
    }
    expect(run().status).toBe(0);
    expect(existsSync(path.join(backups, old))).toBe(false);
    for (const f of [kept, "fleet-pre-import-20261104.dump", "autre.dump"]) {
      expect(existsSync(path.join(backups, f)), f).toBe(true);
    }
  });
});
