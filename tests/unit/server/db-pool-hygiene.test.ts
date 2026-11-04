import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * #264 : toute connexion SQL hors des tests passe par le garde base de production.
 * Un fichier qui construit un pool ou un client (`new Pool(`, `neon(`, `new Client(`) ou importe
 * un driver SQL (@neondatabase/serverless, pg, postgres) est soit `server/db.ts`, soit un fichier
 * qui importe production-db-guard et appelle `guardDatabaseConnection(` avant toute construction.
 * Les tests (tests/) ont leur propre garde (assertSafeTestDatabase).
 *
 * Liste gelée : exceptions existantes, qui ne peuvent que disparaître.
 */
const FROZEN: Record<string, string> = {
  // .js racine lancé par `node`, ne peut pas importer le garde TypeScript ; non référencé.
  "test-workflow-reminders.js": "script historique, à supprimer ou porter en .ts",
};

const CONSTRUCTION = /new\s+(?:pg\.)?Pool\s*\(|\bneon\s*\(|new\s+(?:pg\.)?Client\s*\(/;
const GUARD = "guardDatabaseConnection(";
/** Import de valeur (pas `import type`) d'un driver SQL, alias compris : `import { Pool as P }`. */
const DRIVER_IMPORT =
  /(?:^|\n)\s*import\s+(?!type\b)[^;]*?from\s*["'](?:@neondatabase\/serverless|pg|postgres)["']|require\(\s*["'](?:@neondatabase\/serverless|pg|postgres)["']\s*\)/;
const GUARD_IMPORT = /from\s*["'][^"']*production-db-guard(?:\.ts|\.js)?["']/;

/** Retire commentaires de bloc et de ligne (sans toucher à `://` dans une chaîne d'URL). */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

/**
 * Fichiers qui ouvrent une connexion sans garde préalable : construction avant (ou sans) appel
 * du garde, ou import de valeur d'un driver SQL sans import de production-db-guard (alias inclus).
 * Les commentaires sont retirés avant la recherche : un garde commenté ne compte pas.
 */
export function unguardedConnections(files: Record<string, string>): string[] {
  return Object.entries(files)
    .filter(([file, raw]) => {
      if (file === "server/db.ts") return false;
      const src = stripComments(raw);
      if (DRIVER_IMPORT.test(src) && !GUARD_IMPORT.test(src)) return true;
      const construction = src.search(CONSTRUCTION);
      if (construction < 0) return false;
      const guard = src.indexOf(GUARD);
      return guard < 0 || guard > construction;
    })
    .map(([file]) => file)
    .sort();
}

function trackedSources(): Record<string, string> {
  const out = execFileSync("git", ["ls-files", "*.ts", "*.tsx", "*.js", "*.mjs", "*.cjs"], { encoding: "utf8" });
  const files: Record<string, string> = {};
  for (const file of out.split(/\r?\n/).filter(Boolean)) {
    if (file.startsWith("tests/") || !existsSync(file)) continue;
    files[file] = readFileSync(file, "utf8");
  }
  return files;
}

describe("connexions SQL : garde base de production (#264)", () => {
  const sources = trackedSources();

  it("aucune connexion sans guardDatabaseConnection hors server/db.ts et la liste gelée", () => {
    expect(unguardedConnections(sources).filter((f) => !(f in FROZEN))).toEqual([]);
  });

  it("la liste gelée ne contient que des écarts encore présents (elle ne peut que rétrécir)", () => {
    const stillUnguarded = new Set(unguardedConnections(sources));
    for (const file of Object.keys(FROZEN)) expect(stillUnguarded.has(file), file).toBe(true);
  });

  it("server/db.ts appelle le garde avant de construire ses pools", () => {
    const src = sources["server/db.ts"];
    const guard = src.indexOf('guardDatabaseConnection("db")');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(src.search(CONSTRUCTION));
  });

  it("détecte un pool sans garde, un garde placé après, et accepte un garde placé avant", () => {
    expect(
      unguardedConnections({
        "a.ts": 'const p = new Pool({ connectionString: process.env.DATABASE_URL });',
        "b.ts": 'const sql = neon(url);\nguardDatabaseConnection("b");',
        "c.ts": 'guardDatabaseConnection("c");\nconst sql = neon(url);',
        "d.ts": "const c = new pg.Client(url);",
        "server/db.ts": "const p = new Pool({});",
      }),
    ).toEqual(["a.ts", "b.ts", "d.ts"]);
  });

  it("un import aliasé du driver sans import du garde est signalé (`import { Pool as P }` puis `new P(`)", () => {
    const guarded = 'import { guardDatabaseConnection } from "../server/lib/production-db-guard";\n';
    expect(
      unguardedConnections({
        "alias.ts": 'import { Pool as P } from "@neondatabase/serverless";\nconst p = new P({});',
        "pg.ts": 'import pg from "pg";\nconst C = pg.Client;\nnew C(url);',
        "req.cjs": 'const { Pool: P } = require("postgres");\nnew P();',
        "types.ts": 'import type { PoolClient } from "@neondatabase/serverless";',
        "ok.ts": guarded + 'import { Pool as P } from "@neondatabase/serverless";\nguardDatabaseConnection("ok");\nnew P({});',
      }),
    ).toEqual(["alias.ts", "pg.ts", "req.cjs"]);
  });

  it("un garde en commentaire ne compte pas", () => {
    expect(
      unguardedConnections({
        "line.ts": '// guardDatabaseConnection("x");\nconst sql = neon(url);',
        "block.ts": '/* guardDatabaseConnection("x"); */\nconst sql = neon(url);',
        "url.ts": 'guardDatabaseConnection("u");\nconst u = "postgres://h/db";\nconst sql = neon(u);',
      }),
    ).toEqual(["block.ts", "line.ts"]);
  });
});
