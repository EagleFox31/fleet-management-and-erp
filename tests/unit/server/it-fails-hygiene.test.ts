import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

/**
 * Un `it.fails(...)` ne contient que l'appel visé et l'assertion métier.
 *
 * `it.fails` passe au vert dès que le corps lève. Si la mise en place (créer un
 * véhicule, un plan, une pièce, poster une fixture, `save()`) est dans le corps,
 * un setup en 500 ou une coupure Neon fait passer le test sans prouver le défaut
 * visé. Incident répété sur les PR #67, #68, #70, #71, #72.
 *
 * Heuristique (volontairement simple) : dans le corps d'un `it.fails` / `test.fail`
 * dont le titre est un littéral, on signale
 *   1. un appel de fabrique `create*` / `seed*` / `make*` / `insert*` / `open*` /
 *      `new*` / `setup*`, `db.insert(`, `.save(`, dont le résultat n'est pas
 *      l'objet de l'assertion (`expect(res.status)`) : c'est de la mise en place.
 *      Une fabrique appelée avec un corps invalide pour en vérifier le refus
 *      (`const res = await createPart(...)` puis `expect(res.status).toBe(400)`)
 *      est l'appel visé : pas signalée ;
 *   2. plus d'une requête HTTP (`call(`, `request(`, `fetch(`, `.get/.post/…(`).
 *
 * Correction : déplacer la mise en place dans `beforeAll` (ou un `it` témoin qui
 * échoue seul), ne laisser dans l'`it.fails` que l'appel visé et l'assertion.
 *
 * Les occurrences déjà présentes sont gelées ci-dessous (clé `fichier::titre`) :
 * la liste ne peut que rétrécir. Une nouvelle occurrence fait échouer ce test.
 */
const KNOWN_SETUP_IN_IT_FAILS: string[] = [
  "tests/contract/fault-catalog-lifecycle.contract.test.ts::le valideur ne se forge pas par le corps",
  "tests/contract/fault-catalog-lifecycle.contract.test.ts::valider une panne enregistre qui l'a validée",
  "tests/contract/parts-catalog-crud.contract.test.ts::pièce déjà supprimée : pas de 500 au second appel",
  "tests/contract/parts-catalog-crud.contract.test.ts::référence déjà prise : 409 lisible, sans texte d'exception",
  "tests/contract/suppliers-crud-ratings.contract.test.ts::le chef d'atelier évalue une catégorie pièces (200)",
  "tests/contract/suppliers-crud-ratings.contract.test.ts::nom déjà pris : 409 lisible, pas une 500",
  "tests/contract/suppliers-crud-ratings.contract.test.ts::une nouvelle commande ne peut pas viser un fournisseur désactivé",
  "tests/integration/vehicle-status-sync.test.ts::annuler le dernier OT ouvert remet le véhicule en service",
];

interface ItFailsCase {
  title: string;
  body: string;
}

/** Index juste après la chaîne qui commence en `start`. */
function skipString(src: string, start: number): number {
  const quote = src[start];
  let i = start + 1;
  while (i < src.length && src[i] !== quote) i += src[i] === "\\" ? 2 : 1;
  return i + 1;
}

/** Retire les commentaires de ligne et de bloc en respectant les chaînes. */
function stripComments(src: string): string {
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const end = skipString(src, i);
      out += src.slice(i, end);
      i = end - 1;
    } else if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 1;
    } else out += c;
  }
  return out;
}

/** Extrait les `it.fails("titre", …)` et `test.fail("titre", …)` d'un source. */
function extractItFails(rawSource: string): ItFailsCase[] {
  const src = stripComments(rawSource);
  const cases: ItFailsCase[] = [];
  const opener = /\b(?:it\.fails|test\.fail)\(\s*(["'`])/g;
  for (let m = opener.exec(src); m; m = opener.exec(src)) {
    const titleStart = m.index + m[0].length - 1;
    const titleEnd = skipString(src, titleStart);
    const title = src.slice(titleStart + 1, titleEnd - 1);
    let depth = 1;
    let i = titleEnd;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '"' || c === "'" || c === "`") i = skipString(src, i);
      else {
        if (c === "(") depth++;
        else if (c === ")") depth--;
        i++;
      }
    }
    cases.push({ title, body: src.slice(titleEnd, i - 1) });
  }
  return cases;
}

const FACTORY = /\b(?:(?:create|seed|make|insert|open|new|setup)\w*|db\.insert|\w+\.save)\s*\(/g;
const HTTP = /\b(?:call|request|fetch)\s*\(|\.(?:get|post|put|patch|delete)\s*\(/g;

/** Raisons pour lesquelles le corps contient de la mise en place ; vide = propre. */
function setupReasonsIn(body: string): string[] {
  const reasons: string[] = [];
  for (const m of body.matchAll(FACTORY)) {
    const before = body.slice(0, m.index);
    const bound = /(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?$/.exec(before);
    const asserted = bound && new RegExp(String.raw`expect\(\s*\(?\s*${bound[1]}\.status\b`).test(body);
    if (!asserted) reasons.push(`mise en place : ${m[0].replace(/\s*\($/, "()")}`);
  }
  const httpCalls = [...body.matchAll(HTTP)].length;
  if (httpCalls > 1) reasons.push(`${httpCalls} requêtes HTTP dans le corps`);
  return reasons;
}

const rootDir = fileURLToPath(new URL("../../..", import.meta.url));
const SELF = "tests/unit/server/it-fails-hygiene.test.ts";

function sources(dir: string, suffix: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    if (name === "node_modules") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path, suffix);
    return path.endsWith(suffix) ? [path] : [];
  });
}

function scannedFiles(): string[] {
  return [...sources(join(rootDir, "tests"), ".test.ts"), ...sources(join(rootDir, "e2e"), ".spec.ts")].filter(
    (f) => relative(rootDir, f).replace(/\\/g, "/") !== SELF,
  );
}

function offendersOnDisk(): string[] {
  const found: string[] = [];
  for (const file of scannedFiles()) {
    const rel = relative(rootDir, file).replace(/\\/g, "/");
    for (const c of extractItFails(readFileSync(file, "utf8"))) {
      if (setupReasonsIn(c.body).length > 0) found.push(`${rel}::${c.title}`);
    }
  }
  return found.sort();
}

describe("it.fails : pas de mise en place dans le corps", () => {
  it("l'extraction trouve bien des it.fails", () => {
    const total = scannedFiles().flatMap((f) => extractItFails(readFileSync(f, "utf8"))).length;
    expect(total).toBeGreaterThan(0);
  });

  it("un it.fails fautif fabriqué est signalé", () => {
    const faulty = `
      it.fails("défaut visé (200)", async () => {
        const vehicle = await createVehicle();
        const res = await call("PATCH", \`/api/vehicles/\${vehicle.id}\`, { body: {} });
        expect(res.status).toBe(400);
      });`;
    const [c] = extractItFails(faulty);
    expect(c.title).toBe("défaut visé (200)");
    expect(setupReasonsIn(c.body).length).toBeGreaterThan(0);
  });

  it("un it.fails propre fabriqué n'est pas signalé", () => {
    const clean = `
      it.fails("prix non numérique : 400", async () => {
        // la mise en place est en beforeAll
        const res = await createPart("admin", { unitPrice: "beaucoup" });
        expect(res.status).toBe(400);
      });
      it.fails("id inconnu : 404", async () => {
        const res = await call("PATCH", "/api/x/1", { body: {} });
        expect(res.status).toBe(404);
      });`;
    const cases = extractItFails(clean);
    expect(cases).toHaveLength(2);
    for (const c of cases) expect(setupReasonsIn(c.body)).toEqual([]);
  });

  it("aucun nouvel it.fails ne porte sa mise en place", () => {
    const fresh = offendersOnDisk().filter((k) => !KNOWN_SETUP_IN_IT_FAILS.includes(k));
    expect(
      fresh,
      "Règle : un it.fails ne contient que l'appel visé et l'assertion métier. " +
        "Déplacer la création / le POST de fixture dans beforeAll (ou un it témoin), " +
        "sinon un setup en 500 ou une coupure base fait passer le test au vert.",
    ).toEqual([]);
  });

  it("la liste gelée ne contient que des occurrences encore présentes", () => {
    const present = offendersOnDisk();
    expect(KNOWN_SETUP_IN_IT_FAILS.filter((k) => !present.includes(k))).toEqual([]);
  });
});
