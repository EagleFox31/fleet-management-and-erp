import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { findFixedWaitsBeforeLockAssertion } from "../support/fixed-wait-scan";

/**
 * Leçon #549 : un test de concurrence qui tient un verrou puis attend N ms avant d'affirmer que
 * l'autre écriture attend ne prouve rien de façon fiable. Il doit attendre que Postgres voie la
 * requête bloquée (`pg_stat_activity` avec `wait_event_type = 'Lock'`, ou `pg_blocking_pids`),
 * comme `supplier-settlement-disputed`, `mission-planning-stale-read` ou `part-requirements-idempotence`.
 *
 * Cliquet à zéro : les quatre occurrences d'origine passent par `waitForBlockedBy`
 * (`tests/support/lock-wait.ts`). Toute nouvelle occurrence fait échouer le test.
 */
const FROZEN: Record<string, string> = {};

const root = fileURLToPath(new URL("../..", import.meta.url));
const SCANNED = ["tests/contract", "tests/integration", "e2e"];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

describe("tests de concurrence : pas d'attente à délai fixe avant une assertion de verrou", () => {
  const found = SCANNED.flatMap((dir) => sources(join(root, dir))).flatMap((path) => {
    const key = relative(root, path).split("\\").join("/");
    return findFixedWaitsBeforeLockAssertion(readFileSync(path, "utf8"), key);
  });

  it("aucune occurrence hors de la liste gelée, et aucune entrée périmée", () => {
    expect([...found].sort()).toEqual(Object.keys(FROZEN).sort());
  });

  it("chaque entrée gelée porte une justification", () => {
    for (const [entry, reason] of Object.entries(FROZEN)) expect(reason.length, entry).toBeGreaterThan(15);
  });

  it("le détecteur repère un délai fixe avant assertion et accepte une sonde Postgres", () => {
    const lock = `await tx.select().from(t).for("update");\n`;
    const fixed = `${lock}const p = write();\nawait new Promise((r) => setTimeout(r, 300));\nexpect(done).toBe(false);`;
    const helper = `const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));\n${lock}await sleep(500);\nexpect(done).toBe(false);`;
    const probed = `${lock}for (;;) {\n  await new Promise((r) => setTimeout(r, 25));\n  const n = await q("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock'");\n  if (n) break;\n}\nexpect(done).toBe(false);`;
    const noLock = `await new Promise((r) => setTimeout(r, 300));\nexpect(x).toBe(1);`;
    expect(findFixedWaitsBeforeLockAssertion(fixed, "f")).toEqual(["f#1"]);
    expect(findFixedWaitsBeforeLockAssertion(helper, "f")).toEqual(["f#1"]);
    expect(findFixedWaitsBeforeLockAssertion(probed, "f")).toEqual([]);
    expect(findFixedWaitsBeforeLockAssertion(noLock, "f")).toEqual([]);
  });
});
