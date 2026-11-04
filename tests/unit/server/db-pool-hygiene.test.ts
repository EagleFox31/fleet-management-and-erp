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
const DRIVER_MODULE = String.raw`["'](?:@neondatabase\/serverless|pg|postgres)["']`;
const DRIVER_STATEMENT = new RegExp(
  String.raw`(?:^|\n)\s*import\s+(?!type\b)([^;]*?)from\s*${DRIVER_MODULE}[^\n]*|(?:const|let|var)\s+([^=]+?)=\s*require\(\s*${DRIVER_MODULE}\s*\)[^\n]*`,
  "g",
);

/**
 * Noms locaux liés par un import de valeur d'un driver SQL : `{ Pool as P, neon }`, `pg`, `* as pg`,
 * `{ Pool: P }` (require). Leur emploi (`new P(`, `neon(`, `new pg.Client(`) est une construction.
 */
export function driverBindings(src: string): string[] {
  const names = new Set<string>();
  for (const m of src.matchAll(DRIVER_STATEMENT)) {
    const clause = (m[1] ?? m[2] ?? "").replace(/^\s*\*\s*as\s+/, "");
    for (const part of clause.replace(/[{}]/g, ",").split(",")) {
      const name = part.trim().split(/\s+as\s+|\s*:\s*/).pop()?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name) && name !== "type") names.add(name);
    }
  }
  return [...names];
}

/** Première construction d'un nom lié au driver, hors des lignes d'import elles-mêmes (-1 si aucune). */
function firstBoundConstruction(src: string): number {
  const names = driverBindings(src);
  if (names.length === 0) return -1;
  const body = src.replace(DRIVER_STATEMENT, (m) => " ".repeat(m.length));
  const use = new RegExp(String.raw`(?:new\s+)?\b(?:${names.join("|")})(?:\.[\w$]+)*\s*\(`);
  return body.search(use);
}
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
      const driver = DRIVER_IMPORT.test(src);
      if (driver && !GUARD_IMPORT.test(src)) return true;
      // Avec un driver importé, l'emploi d'un nom qu'il lie compte, alias compris (`new P(`) :
      // le garde doit être appelé avant, pas seulement importé.
      const found = [src.search(CONSTRUCTION), driver ? firstBoundConstruction(src) : -1].filter((i) => i >= 0);
      if (found.length === 0) return false;
      const construction = Math.min(...found);
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

  it("garde importé mais jamais appelé, ou appelé après, avec un alias : signalé", () => {
    const imp = 'import { guardDatabaseConnection } from "../server/lib/production-db-guard";\nimport { Pool as P } from "@neondatabase/serverless";\n';
    expect(
      unguardedConnections({
        "never.ts": imp + "const p = new P({});",
        "late.ts": imp + 'const p = new P({});\nguardDatabaseConnection("late");',
        "ok.ts": imp + 'guardDatabaseConnection("ok");\nconst p = new P({});',
      }),
    ).toEqual(["late.ts", "never.ts"]);
  });

  it("noms liés au driver : alias, défaut, espace de noms, require ; `new Set(` n'est pas une connexion", () => {
    expect(
      driverBindings(
        'import { Pool as P, neon } from "@neondatabase/serverless";\nimport * as pg from "pg";\nconst { Client: C } = require("postgres");',
      ).sort(),
    ).toEqual(["C", "P", "neon", "pg"]);
    const imp = 'import { guardDatabaseConnection } from "../server/lib/production-db-guard";\nimport { neon } from "@neondatabase/serverless";\n';
    expect(
      unguardedConnections({ "set.ts": imp + 'const s = new Set();\nguardDatabaseConnection("s");\nconst sql = neon(u);' }),
    ).toEqual([]);
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
