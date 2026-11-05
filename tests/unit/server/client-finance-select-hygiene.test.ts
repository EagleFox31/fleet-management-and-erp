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
 * Une lecture entière de ces tables (`select()` / `selectDistinct()` vides, `{ client: clients }` ou
 * `{ clients }`, `getTableColumns(...)`, un `alias(clients, ...)` lu entier, `returning()` vide après
 * insert, update ou delete, `db.query.clients`, `with: { client: true }`, `SELECT *` / `c.*` /
 * `row_to_json(c)` en SQL brut, table nommée ou interpolée `${clients}`) ramène ces colonnes ; si le résultat atteint une réponse ou une trame, elles
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
  "server/lib/client-public-columns.ts#clients#getTableColumns#1": "source de publicClientColumns : omitKeys retire les taux",
  "server/lib/client-public-columns.ts#clientInvoices#getTableColumns#1": "source de publicClientInvoiceColumns : omitKeys retire retenues et net",
};

const TABLES = ["clients", "clientInvoices"] as const;

/** `clients` ou `schema.clients` (import en espace de noms) : même table. */
const ref = (table: string) => `(?:[A-Za-z_$][\\w$]*\\.)?${table}`;

const root = fileURLToPath(new URL("../../..", import.meta.url));

function serverSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "_archive" || name === "node_modules") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return serverSources(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

const SELECT_METHODS = [".select(", ".selectDistinct(", ".selectDistinctOn("] as const;

/** Projection du dernier `select` / `selectDistinct` / `selectDistinctOn` avant `position`. */
function selectArgument(source: string, position: number): string | null {
  const [start, method] = SELECT_METHODS.map((m) => [source.lastIndexOf(m, position), m] as const).sort((a, b) => b[0] - a[0])[0];
  if (start < 0) return null;
  let depth = 0;
  for (let i = start + method.length - 1; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")") {
      depth--;
      if (depth !== 0) continue;
      const argument = source.slice(start + method.length, i);
      // `selectDistinctOn([colonnes], projection?)` : seule la projection compte.
      return method === ".selectDistinctOn(" ? argument.replace(/^\s*\[[^\]]*\]\s*,?/, "") : argument;
    }
  }
  return null;
}

/** `const c = alias(clients, "c")` : `c` se lit comme la table. */
function aliasesOf(source: string): [string, string][] {
  const found: [string, string][] = [];
  const declared = /\b([A-Za-z_$][\w$]*)\s*=\s*alias\(\s*(?:[A-Za-z_$][\w$]*\.)?(clients|clientInvoices)\s*,/g;
  for (let m = declared.exec(source); m; m = declared.exec(source)) found.push([m[1], `alias:${m[2]}`]);
  return found;
}

const isWholeRow = (argument: string, table: string) =>
  argument.trim() === "" ||
  new RegExp(`:\\s*${ref(table)}\\s*[,}\\n]`).test(argument) ||
  // Forme abrégée : `{ m: missions, c }` vaut `{ c: c }`.
  new RegExp(`(?:^|[{,])\\s*${table}\\s*(?:[,}]|$)`).test(argument) ||
  new RegExp(`getTableColumns\\(\\s*${ref(table)}\\s*\\)`).test(argument);

export function findWholeReads(source: string, key: string): string[] {
  const found: string[] = [];
  const targets: [string, string][] = [...TABLES.map((t): [string, string] => [t, t]), ...aliasesOf(source)];
  for (const [table, label] of targets) {
    let ordinal = 0;
    const fromTable = new RegExp(`\\.(?:from|leftJoin|innerJoin|rightJoin|fullJoin)\\(\\s*${ref(table)}\\s*[,)]`, "g");
    for (let m = fromTable.exec(source); m; m = fromTable.exec(source)) {
      const argument = selectArgument(source, m.index);
      if (argument !== null && isWholeRow(argument, table)) found.push(`${key}#${label}#${++ordinal}`);
    }
    // Colonnes de la table entière, même hors projection : `const cols = getTableColumns(clients)` relu ailleurs.
    let columns = 0;
    const allColumns = new RegExp(`getTableColumns\\(\\s*${ref(table)}\\s*\\)`, "g");
    for (let m = allColumns.exec(source); m; m = allColumns.exec(source)) found.push(`${key}#${label}#getTableColumns#${++columns}`);
    if (label !== table) continue;
    let returning = 0;
    const write = new RegExp(`\\.(?:insert|update|delete)\\(\\s*${ref(table)}\\s*\\)[^;]*?\\.returning\\(\\s*\\)`, "g");
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
  found.push(...findHiddenTableNames(source, key));
  return found;
}

/**
 * Noms qui masqueraient la table au détecteur, interdits sans exception : import renommé
 * (`import { clients as c }`), accès par crochets (`schema["clients"]`) et copie locale
 * (`const t = clients;`, `= schema.clients;`). `alias(clients, "c")` reste la seule forme suivie.
 */
export function findHiddenTableNames(source: string, key: string): string[] {
  const found: string[] = [];
  // `import * as schema from "@shared/schema"` : `schema.clients` vaut `clients`.
  const namespaces = [...source.matchAll(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["'][^"']*shared\/schema["']/g)].map((m) => m[1]);
  const prefix = namespaces.length ? `(?:(?:${namespaces.join("|")})\\.)?` : "";
  const patterns: [string, RegExp][] = [
    ["rename", /\bimport\s+(?:type\s+)?\{[^}]*\b(?:clients|clientInvoices)\s+as\s+[A-Za-z_$]/g],
    ["bracket", /\[\s*["'`](?:clients|clientInvoices|client_invoices)["'`]\s*\]/g],
    ["copy", new RegExp(`=\\s*${prefix}(?:clients|clientInvoices)\\s*[;\\n]`, "g")],
  ];
  for (const [kind, pattern] of patterns) {
    let n = 0;
    for (let m = pattern.exec(source); m; m = pattern.exec(source)) found.push(`${key}#${kind}#${++n}`);
  }
  return found;
}

const SQL_TABLES = ["clients", "client_invoices"] as const;
const NOT_ALIAS = new Set(["where", "on", "join", "left", "right", "inner", "full", "cross", "group", "order", "limit", "for", "as", "using"]);

/**
 * SQL brut (`sql\`...\``, `pool.query("...")`) sur ces tables, nommées en clair ou interpolées
 * (`${clients}`) : `SELECT *`, `c.*` / `clients.*`, ou la ligne entière passée à `row_to_json`,
 * `to_json(b)` ou `json(b)_agg`.
 */
export function findWholeSqlReads(source: string, key: string): string[] {
  const found: string[] = [];
  const counts: Record<string, number> = {};
  const literals = source.match(/`[^`]*`|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g) ?? [];
  for (const raw of literals) {
    const literal = raw
      .replace(/\$\{\s*(?:[A-Za-z_$][\w$]*\.)?clients\s*\}/g, "clients")
      .replace(/\$\{\s*(?:[A-Za-z_$][\w$]*\.)?clientInvoices\s*\}/g, "client_invoices");
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
        [...names].some(
          (n) =>
            new RegExp(`(?:^|[^\\w.])"?${n}"?\\.\\*`).test(literal) ||
            new RegExp(`\\b(?:row_to_json|to_jsonb?|jsonb?_agg)\\(\\s*"?${n}"?\\s*[,)]`, "i").test(literal),
        );
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

  it("le détecteur repère table interpolée, selectDistinct, alias et ligne passée à row_to_json", () => {
    expect(findWholeReads("db.execute(sql`SELECT * FROM ${clients} WHERE id = ${id}`)", "a")).toEqual(["a#sql:clients#1"]);
    expect(findWholeReads("sql`SELECT ${clientInvoices}.* FROM ${clientInvoices}`", "a")).toEqual(["a#sql:client_invoices#1"]);
    expect(findWholeReads("db.selectDistinct().from(clients)", "a")).toEqual(["a#clients#1"]);
    expect(findWholeReads("db.selectDistinct({ c: clients }).from(clients)", "a")).toEqual(["a#clients#1"]);
    expect(findWholeReads("db.selectDistinctOn([clients.name]).from(clients)", "a")).toEqual(["a#clients#1"]);
    expect(findWholeReads("const c = alias(clients, \"c\");\ndb.select().from(missions).leftJoin(c, eq(c.id, x))", "a")).toEqual([
      "a#alias:clients#1",
    ]);
    expect(findWholeReads("const c = alias(clients, \"c\");\ndb.select({ m: missions, c }).from(missions).innerJoin(c, eq(c.id, x))", "a")).toEqual([
      "a#alias:clients#1",
    ]);
    expect(findWholeReads("db.select({ clients }).from(clients)", "a")).toEqual(["a#clients#1"]);
    expect(findWholeReads("sql`SELECT row_to_json(c) FROM clients c`", "a")).toEqual(["a#sql:clients#1"]);
    expect(findWholeReads("sql`SELECT json_agg(i) FROM client_invoices i`", "a")).toEqual(["a#sql:client_invoices#1"]);
    // Projections nommées : sans effet.
    expect(findWholeReads("sql`SELECT ${clients.id}, ${clients.name} FROM ${clients}`", "a")).toEqual([]);
    expect(findWholeReads("db.selectDistinctOn([clients.name], { id: clients.id }).from(clients)", "a")).toEqual([]);
    expect(findWholeReads("const c = alias(clients, \"c\");\ndb.select({ id: c.id }).from(c)", "a")).toEqual([]);
    expect(findWholeReads("sql`SELECT json_build_object('id', c.id) FROM clients c`", "a")).toEqual([]);
  });

  it("le détecteur repère getTableColumns hors projection et la table lue par espace de noms", () => {
    expect(findWholeReads("const cols = getTableColumns(clients);\ndb.select(cols).from(missions)", "a")).toEqual([
      "a#clients#getTableColumns#1",
    ]);
    expect(findWholeReads("db.select({ ...getTableColumns(clients) }).from(clients)", "a")).toEqual([
      "a#clients#1",
      "a#clients#getTableColumns#1",
    ]);
    expect(findWholeReads("db.select().from(schema.clients)", "a")).toEqual(["a#clients#1"]);
    expect(findWholeReads("db.select({ c: schema.clients }).from(missions).leftJoin(schema.clients, eq(a, b))", "a")).toEqual([
      "a#clients#1",
    ]);
    expect(findWholeReads("db.update(schema.clientInvoices).set({ x }).returning();", "a")).toEqual(["a#clientInvoices#returning#1"]);
    expect(findWholeReads("const c = alias(schema.clients, \"c\");\ndb.select().from(c)", "a")).toEqual(["a#alias:clients#1"]);
    expect(findWholeReads("sql`SELECT * FROM ${schema.clients}`", "a")).toEqual(["a#sql:clients#1"]);
    // Projections nommées par espace de noms : sans effet.
    expect(findWholeReads("db.select({ id: schema.clients.id }).from(schema.clients)", "a")).toEqual([]);
  });

  it("le détecteur interdit les noms qui masquent la table : import renommé, crochets, copie locale", () => {
    expect(findWholeReads("import { clients as c } from \"@shared/schema\";\ndb.select({ id: c.id }).from(c)", "a")).toEqual(["a#rename#1"]);
    expect(findWholeReads("import { users, clientInvoices as inv } from \"@shared/schema\";", "a")).toEqual(["a#rename#1"]);
    expect(findWholeReads("db.select().from(schema[\"clients\"])", "a")).toEqual(["a#bracket#1"]);
    expect(findWholeReads("const t = schema['clientInvoices'];", "a")).toEqual(["a#bracket#1"]);
    // Copie locale : `t` échapperait au suivi des lectures entières, elle est donc refusée.
    expect(findWholeReads("const t = clients;\ndb.select().from(t)", "a")).toEqual(["a#copy#1"]);
    expect(findWholeReads("import * as schema from \"@shared/schema\";\nconst t = schema.clientInvoices;", "a")).toEqual(["a#copy#1"]);
    // Usages ordinaires : sans effet.
    expect(findWholeReads("import { clients, clientInvoices } from \"@shared/schema\";", "a")).toEqual([]);
    expect(findWholeReads("const id = clients.id;\nconst n = row.clients;", "a")).toEqual([]);
    expect(findWholeReads("sql`SELECT c.id FROM clients as c`", "a")).toEqual([]);
  });
});
