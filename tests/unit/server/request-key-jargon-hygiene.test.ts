import { readdirSync, readFileSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Pas de « clé de requête » ni de « clé d'idempotence » dans un texte que l'utilisateur peut lire.
 * Near miss du 10 novembre 2026 (relecture de #685) : un comptable qui changeait le montant d'un avoir
 * après une coupure réseau lisait « Cette clé de requête est déjà utilisée… ». Le même terme était
 * renvoyé par les échéances, la trésorerie et la garde d'idempotence des chauffeurs. Règle de
 * docs/analysis/LESSONS_LEARNED.md : pas de libellé technique dans l'UI ; on parle de « saisie ».
 *
 * Détection (AST) dans `server/` et `shared/` : toute chaîne littérale (y compris un gabarit) qui
 * contient le terme. Les commentaires et les messages de journal (`log.warn(...)`, `logger.error(...)`)
 * ne comptent pas : ils ne sont pas affichés. Liste gelée vide : elle ne doit pas grossir.
 */
const KNOWN_JARGON: string[] = [];

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const JARGON = /cl[ée] (de requ[êe]te|d['’]idempotence)/i;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "_archive" ? [] : files(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

const LOG_METHODS = new Set(["trace", "debug", "info", "warn", "error", "fatal"]);

/** Vrai si la chaîne est un argument direct d'un appel de journal (`log.warn(..., "texte")`). */
function isLogArgument(node: ts.Node): boolean {
  const call = node.parent;
  if (!call || !ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression)) return false;
  const owner = call.expression.expression.getText();
  return LOG_METHODS.has(call.expression.name.text) && /^(log|logger|\w*Log(ger)?)$/.test(owner);
}

function jargonIn(path: string, code = readFileSync(path, "utf8")): string[] {
  const source = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true);
  const hits: string[] = [];
  const visit = (node: ts.Node) => {
    const text =
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
        ? node.text
        : ts.isTemplateExpression(node)
          ? [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join("…")
          : null;
    if (text !== null && JARGON.test(text) && !isLogArgument(node)) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      hits.push(`${relative(repoRoot, path).split("\\").join("/")}:${line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

describe("messages lisibles : pas de « clé de requête » dans un texte affiché", () => {
  it("aucune chaîne de server/ ni de shared/ ne contient le terme technique", () => {
    const hits = ["server", "shared"].flatMap((dir) => files(join(repoRoot, dir))).flatMap((path) => jargonIn(path));
    expect(hits.filter((hit) => !KNOWN_JARGON.some((known) => hit.startsWith(known)))).toEqual([]);
  });

  it("le détecteur voit le terme dans une chaîne, pas dans un commentaire", () => {
    // Passe par jargonIn lui-même : un détecteur muet ferait échouer les cas positifs.
    const probe = (code: string) => jargonIn(join(repoRoot, "probe.ts"), code).length > 0;
    expect(probe('throw new Error("Cette clé de requête est déjà utilisée.");')).toBe(true);
    expect(probe("const m = `Cette clé d'idempotence a déjà servi`;")).toBe(true);
    expect(probe("const m = `Saisie ${id} : clé de requête refusée`;")).toBe(true);
    expect(probe('res.status(409).json({ message: "Clé de requête déjà utilisée" });')).toBe(true);
    expect(probe("// Clé de requête d'un plein\nconst x = 1;")).toBe(false);
    expect(probe('log.warn({ key }, "clé de requête rejouée");')).toBe(false);
    // La garde d'idempotence journalise encore le terme (log.warn / log.error) : ignoré, non affiché.
    expect(readFileSync(join(repoRoot, "server", "middleware", "idempotency-guard.ts"), "utf8")).toMatch(JARGON);
    expect(jargonIn(join(repoRoot, "server", "middleware", "idempotency-guard.ts"))).toEqual([]);
  });
});
