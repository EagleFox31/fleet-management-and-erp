import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import {
  CLIENT_FINANCE_FIELDS,
  CLIENT_INVOICE_FINANCE_FIELDS,
  publicClientColumns,
  publicClientInvoiceColumns,
} from "../../../server/lib/client-public-columns";

/**
 * Champs finance (lot F1) : taux de retenue de `clients`, retenues et net figés de `client_invoices`.
 *
 * Une lecture entière de ces tables (`select()` vide, `{ client: clients }`, `getTableColumns(...)`,
 * `returning()` vide après insert, update ou delete, `db.query.clients`, `with: { client: true }`,
 * `SELECT *` / `c.*` en SQL brut) ramène ces colonnes ; si le résultat atteint une réponse ou une trame, elles
 * fuient vers des rôles sans lecture finance. Passer par `publicClientColumns` /
 * `publicClientInvoiceColumns` (`server/lib/client-public-columns.ts`).
 *
 * Liste blanche : chaque entrée justifiée. Elle doit rester strictement égale (nouvelle occurrence
 * ou entrée périmée : échec).
 */
const ALLOWED: Record<string, string> = {
  "server/api/clients.routes.ts#clients#1": "fiche client : forViewer retire les taux hors lecture finance, la diffusion les retire toujours",
  "server/api/clients.routes.ts#clients#2": "liste des clients : forViewer retire les taux hors lecture finance",
  "server/api/clients.routes.ts#clients#3": "liste complète : forViewer retire les taux hors lecture finance",
  "server/api/clients.routes.ts#clients#returning#1": "création : forViewer sur la réponse, diffusion sans les taux",
  "server/api/clients.routes.ts#clients#returning#2": "modification : forViewer sur la réponse, diffusion sans les taux",
  "server/api/clients.routes.ts#clients#returning#3": "désactivation : forViewer sur la réponse, diffusion sans les taux",
  "server/api/clients.routes.ts#clients#returning#4": "restauration : forViewer sur la réponse, diffusion sans les taux",
};

const TABLES = ["clients", "clientInvoices"] as const;

const root = fileURLToPath(new URL("../../..", import.meta.url));

function serverSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "_archive" || name === "node_modules") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return serverSources(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

function selectArgument(source: string, position: number): string | null {
  const start = source.lastIndexOf(".select(", position);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start + ".select".length; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")") {
      depth--;
      if (depth === 0) return source.slice(start + ".select(".length, i);
    }
  }
  return null;
}

const isWholeRow = (argument: string, table: string) =>
  argument.trim() === "" ||
  new RegExp(`:\\s*${table}\\s*[,}\\n]`).test(argument) ||
  new RegExp(`getTableColumns\\(\\s*${table}\\s*\\)`).test(argument);

export function findWholeReads(source: string, key: string): string[] {
  const found: string[] = [];
  for (const table of TABLES) {
    let ordinal = 0;
    const fromTable = new RegExp(`\\.(?:from|leftJoin|innerJoin|rightJoin)\\(\\s*${table}\\s*[,)]`, "g");
    for (let m = fromTable.exec(source); m; m = fromTable.exec(source)) {
      const argument = selectArgument(source, m.index);
      if (argument !== null && isWholeRow(argument, table)) found.push(`${key}#${table}#${++ordinal}`);
    }
    let returning = 0;
    const write = new RegExp(`\\.(?:insert|update|delete)\\(\\s*${table}\\s*\\)[^;]*?\\.returning\\(\\s*\\)`, "g");
    for (let m = write.exec(source); m; m = write.exec(source)) found.push(`${key}#${table}#returning#${++returning}`);
    // API relationnelle : `db.query.clients` ramène la ligne entière sauf `columns` explicite.
    let query = 0;
    const relational = new RegExp(`\\.query\\.${table}\\b`, "g");
    for (let m = relational.exec(source); m; m = relational.exec(source)) found.push(`${key}#${table}#query#${++query}`);
  }
  // Relation chargée entière : `with: { client: true }` (ou `clients`, `clientInvoice(s)`).
  let relation = 0;
  const withWhole = /\bwith\s*:\s*\{[^}]*\b(?:clients?|clientInvoices?)\s*:\s*true\b/g;
  for (let m = withWhole.exec(source); m; m = withWhole.exec(source)) found.push(`${key}#with#${++relation}`);
  found.push(...findWholeSqlReads(source, key));
  return found;
}

const SQL_TABLES = ["clients", "client_invoices"] as const;
const NOT_ALIAS = new Set(["where", "on", "join", "left", "right", "inner", "full", "cross", "group", "order", "limit", "for", "as", "using"]);

/** SQL brut (`sql\`...\``, `pool.query("...")`) : `SELECT *`, `c.*` ou `clients.*` sur ces tables. */
export function findWholeSqlReads(source: string, key: string): string[] {
  const found: string[] = [];
  const counts: Record<string, number> = {};
  const literals = source.match(/`[^`]*`|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g) ?? [];
  for (const literal of literals) {
    for (const table of SQL_TABLES) {
      const from = new RegExp(`\\b(?:FROM|JOIN)\\s+"?${table}"?(?:\\s+(?:AS\\s+)?([a-z_][a-z0-9_]*))?`, "gi");
      const names = new Set<string>([table]);
      let mentioned = false;
      for (let m = from.exec(literal); m; m = from.exec(literal)) {
        mentioned = true;
        if (m[1] && !NOT_ALIAS.has(m[1].toLowerCase())) names.add(m[1]);
      }
      if (!mentioned) continue;
      const star = /\bSELECT\s+(?:DISTINCT\s+)?\*/i.test(literal) ||
        [...names].some((n) => new RegExp(`(?:^|[^\\w.])"?${n}"?\\.\\*`).test(literal));
      if (star) found.push(`${key}#sql:${table}#${(counts[table] = (counts[table] ?? 0) + 1)}`);
    }
  }
  return found;
}

describe("lectures entières de clients / client_invoices (champs finance)", () => {
  const found = serverSources(join(root, "server")).flatMap((path) =>
    findWholeReads(readFileSync(path, "utf8"), relative(root, path).replace(/\\/g, "/")),
  );

  it("aucune occurrence hors de la liste blanche, et aucune entrée périmée", () => {
    expect([...found].sort()).toEqual(Object.keys(ALLOWED).sort());
  });

  it("les projections publiques ne portent aucun champ finance", () => {
    for (const field of CLIENT_FINANCE_FIELDS) expect(publicClientColumns).not.toHaveProperty(field);
    for (const field of CLIENT_INVOICE_FINANCE_FIELDS) expect(publicClientInvoiceColumns).not.toHaveProperty(field);
    expect(publicClientColumns).toHaveProperty("name");
    expect(publicClientInvoiceColumns).toHaveProperty("amountTTC");
  });

  it("le détecteur repère les lectures entières et ignore une projection", () => {
    expect(findWholeReads("db.select().from(clients).where(x);", "a")).toEqual(["a#clients#1"]);
    expect(findWholeReads("db.select({ invoice: clientInvoices, n: x }).from(clientInvoices)", "a")).toEqual(["a#clientInvoices#1"]);
    expect(findWholeReads("db.select({ c: clients }).from(missions).leftJoin(clients, eq(a, b))", "a")).toEqual(["a#clients#1"]);
    expect(findWholeReads("db.insert(clients).values({ name }).returning();", "a")).toEqual(["a#clients#returning#1"]);
    expect(findWholeReads("db.select(publicClientColumns).from(clients)", "a")).toEqual([]);
    expect(findWholeReads("db.insert(clients).values({ name }).returning(publicClientColumns);", "a")).toEqual([]);
    expect(findWholeReads("db.select({ id: clientInvoices.id }).from(clientInvoices)", "a")).toEqual([]);
  });

  it("le détecteur repère SQL brut, API relationnelle et suppression renvoyée", () => {
    expect(findWholeReads("db.execute(sql`SELECT * FROM clients WHERE id = ${id}`)", "a")).toEqual(["a#sql:clients#1"]);
    expect(findWholeReads("sql`SELECT c.*, m.id FROM missions m JOIN clients c ON c.id = m.client_id`", "a")).toEqual(["a#sql:clients#1"]);
    expect(findWholeReads("sql`SELECT client_invoices.* FROM client_invoices`", "a")).toEqual(["a#sql:client_invoices#1"]);
    expect(findWholeReads("pool.query('SELECT * FROM client_invoices i WHERE i.id = $1')", "a")).toEqual(["a#sql:client_invoices#1"]);
    expect(findWholeReads("db.query.clients.findFirst({ where: eq(clients.id, id) })", "a")).toEqual(["a#clients#query#1"]);
    expect(findWholeReads("db.query.missions.findMany({ with: { client: true } })", "a")).toEqual(["a#with#1"]);
    expect(findWholeReads("db.delete(clients).where(eq(clients.id, id)).returning();", "a")).toEqual(["a#clients#returning#1"]);
    // Projections nommées : sans effet.
    expect(findWholeReads("sql`SELECT c.id, c.name FROM clients c`", "a")).toEqual([]);
    expect(findWholeReads("sql`SELECT count(*) FROM client_invoices i`", "a")).toEqual([]);
    expect(findWholeReads("sql`SELECT m.* FROM missions m JOIN clients c ON c.id = m.client_id`", "a")).toEqual([]);
    expect(findWholeReads("db.query.missions.findMany({ with: { client: { columns: { id: true } } } })", "a")).toEqual([]);
  });
});
