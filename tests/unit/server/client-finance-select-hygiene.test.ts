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
 * `returning()` vide) ramène ces colonnes ; si le résultat atteint une réponse ou une trame, elles
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
    const write = new RegExp(`\\.(?:insert|update)\\(\\s*${table}\\s*\\)[^;]*?\\.returning\\(\\s*\\)`, "g");
    for (let m = write.exec(source); m; m = write.exec(source)) found.push(`${key}#${table}#returning#${++returning}`);
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
});
