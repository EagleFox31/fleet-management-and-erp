import { describe, expect, it } from "vitest";
import { readRepoFiles, REPO_SCAN_TIMEOUT_MS, repoFiles } from "../../support/repo-files";

/**
 * Garde-fou issu de LESSONS_LEARNED (5 novembre 2026, compteur de verrouillage puis déverrouillage
 * admin) : une écriture du compteur hors du verrou de clé perd une mise à jour concurrente.
 *
 * 1. Le verrou de clé (`fleet-lockout:`) n'est pris qu'à un seul endroit : `underKeyLock` du store
 *    base. Un second site pourrait verrouiller dans un autre ordre (interblocage) ou sous une autre
 *    forme de clé (verrou sans effet).
 * 2. Seul le store écrit `login_attempts_by_username`. Exception nommée : la reprise M3 au démarrage
 *    (`login-identifier-migration.ts`), une seule transaction en `FOR UPDATE`, lancée avant le trafic.
 *    La liste ne peut que rétrécir.
 */

const STORE = "server/services/login-lockout-db-store.ts";
const KEY_LOCK_MARKER = "fleet-lockout:";
const TOLERATED_WRITERS = new Set<string>([STORE, "server/services/login-identifier-migration.ts"]);
const WRITES_COUNTER = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+login_attempts_by_username\b/i;

async function serverSources(): Promise<Array<[string, string]>> {
  return readRepoFiles(repoFiles({ under: ["server"], match: /\.ts$/, skipSegments: ["_archive"] }));
}

describe("verrou de clé du compteur de verrouillage", { timeout: REPO_SCAN_TIMEOUT_MS }, () => {
  it("la clé fleet-lockout: n'apparaît qu'une fois dans server/, dans underKeyLock", async () => {
    const sites = (await serverSources()).flatMap(([file, source]) =>
      source
        .split(/\r?\n/)
        .map((line, index) => ({ file, line: index + 1, text: line }))
        .filter((l) => l.text.includes(KEY_LOCK_MARKER)),
    );
    expect(sites.map((s) => `${s.file}:${s.line}`)).toHaveLength(1);
    const [site] = sites;
    expect(site.file).toBe(STORE);
    expect(site.text).toMatch(/pg_advisory_xact_lock\(/);
    const store = (await readRepoFiles([STORE]))[0][1].split(/\r?\n/);
    const enclosing = store
      .slice(0, site.line)
      .reverse()
      .find((l) => /^\s{2}(?:private\s+)?(?:async\s+)?\w+\s*[<(]/.test(l));
    expect(enclosing, "méthode qui prend le verrou").toMatch(/\bunderKeyLock\b/);
  });

  it("seul le store écrit login_attempts_by_username (liste tolérée qui ne peut que rétrécir)", async () => {
    const writers = (await serverSources()).filter(([, source]) => WRITES_COUNTER.test(source)).map(([file]) => file);
    expect(writers.filter((f) => !TOLERATED_WRITERS.has(f))).toEqual([]);
    expect([...TOLERATED_WRITERS].filter((f) => !writers.includes(f)), "tolérance devenue inutile").toEqual([]);
  });
});
