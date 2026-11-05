import { describe, expect, it } from "vitest";
import { leakText, messageText } from "../support/api-error";
import { readRepoFiles, REPO_SCAN_TIMEOUT_MS, repoFiles } from "../support/repo-files";

/**
 * Garde-fou issu de deux échecs aléatoires (3 novembre 2026) : un contrôle de fuite technique
 * passé sur le corps entier d'une réponse d'erreur inclut le `requestId` aléatoire
 * (`nanoid(10)`). « qrSqlREDR7 » a fait échouer `/sql/i`. Un contrôle de fuite passe par
 * `leakText(body)` (tests/support/api-error.ts), qui retire cette référence.
 *
 * Angles morts fermés : `expect` écrit sur plusieurs lignes (virgule finale comprise), arguments de mise en
 * forme de `JSON.stringify`, `res.text`, contrôle en deux temps (`const t = JSON.stringify(corps)` puis
 * `expect(t).not...`), `.not.toContain` sur un mot court. Seul l'aiguille courte est dangereuse : un mot de
 * plus de 4 caractères ne tient presque jamais dans un identifiant de 10 caractères.
 * Limite : une aiguille passée par une variable (`.not.toContain(SECRET)`) n'est pas évaluée.
 */
const BODY_NAME = String.raw`[\w.]*(?:body|json|data|payload|result|answer)`;
const BODY_ARG = String.raw`(?:await\s+[\w.]+\.json\(\)|${BODY_NAME})`;
/** `body.message` d'une 5xx : « Référence : <requestId> » y figure, comme dans le corps entier. */
const MESSAGE_ARG = String.raw`${BODY_NAME}\.message`;
const TEXT_ARG = String.raw`(?:await\s+[\w.]+\.text\(\)|[\w.]*\.text)`;
const RAW_SUBJECT = String.raw`(?:JSON\.stringify\(\s*${BODY_ARG}\s*(?:,[^()]*)?\)|String\(\s*${BODY_ARG}\s*\)|${TEXT_ARG}|${MESSAGE_ARG})`;
const NEGATION = String.raw`\s*\.\s*not\s*\.\s*(?:toMatch|toContain)\(\s*`;
const NEEDLE = String.raw`(?:\/(?:[^\/\\\n]|\\.)+\/[a-z]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\x60[^\x60\n]*\x60)`;
/** Longueur à partir de laquelle une aiguille ne tient pratiquement jamais dans un `requestId` de 10 caractères. */
const SAFE_NEEDLE_LENGTH = 5;

const DIRECT = new RegExp(String.raw`expect\(\s*${RAW_SUBJECT}\s*,?\s*\)${NEGATION}(${NEEDLE})`, "gi");
const INDIRECT = new RegExp(String.raw`(?:const|let)\s+(\w+)\s*=\s*${RAW_SUBJECT}\s*;[^]{0,600}?expect\(\s*\1\s*,?\s*\)${NEGATION}(${NEEDLE})`, "gi");

/**
 * Une aiguille est risquée si elle est courte ET ne contient que des caractères d'un `requestId`
 * (lettres, chiffres, `_`, `-`) : `%PDF` ou `/secret/chemin` ne peuvent pas y tomber par hasard.
 * Pour une expression régulière, c'est sa plus courte alternative qui compte.
 */
function isRiskyNeedle(needle: string): boolean {
  const alternatives = needle.startsWith("/")
    ? needle
        .slice(1, needle.lastIndexOf("/"))
        .split("|")
        .map((alt) => alt.replace(/\\b/g, "").replace(/\(\?:|[()^$*+?]/g, "").replace(/\\\w|\./g, "x").replace(/\\./g, "!"))
    : [needle.slice(1, -1)];
  // classe ou quantificateur (`/\d{4}/`, `/[a-z]+/`) : peut tomber sur un identifiant quelle que soit la longueur écrite
  if (needle.startsWith("/") && /[\[\]{}+*]|\\[dws]/.test(needle.slice(1, needle.lastIndexOf("/")))) return true;
  return alternatives.some((alt) => alt.length < SAFE_NEEDLE_LENGTH && !/[^A-Za-z0-9_-]/.test(alt));
}

/** Contrôles négatifs sur le corps brut (requestId compris) dont l'aiguille est assez courte pour y tomber par hasard. */
function rawBodyLeakChecks(text: string): string[] {
  const out: string[] = [];
  for (const re of [DIRECT, INDIRECT]) {
    for (const m of text.matchAll(re)) if (isRiskyNeedle(m[m.length - 1])) out.push(m[0].replace(/\s+/g, " ").slice(0, 120));
  }
  return out;
}
const SELF = "tests/unit/leak-check-hygiene.test.ts";

describe("contrôles de fuite dans les réponses d'erreur", () => {
  it("aucun test ne contrôle une fuite sur le corps brut (requestId compris)", async () => {
    const files = repoFiles().filter((f) => (f.startsWith("tests/") || f.startsWith("e2e/")) && /\.(test|spec)\.ts$/.test(f) && f !== SELF);
    expect(files.length).toBeGreaterThan(50);
    const offenders = (await readRepoFiles(files)).flatMap(([f, text]) => rawBodyLeakChecks(text).map((c) => `${f} : ${c}`));
    expect(offenders).toEqual([]);
  }, REPO_SCAN_TIMEOUT_MS);

  it("le motif reconnaît l'ancien contrôle, quel que soit le nom de la réponse", () => {
    const flagged = (code: string) => rawBodyLeakChecks(code).length > 0;
    expect(flagged("expect(JSON.stringify(second.body)).not.toMatch(/sql/i)")).toBe(true);
    expect(flagged("expect(JSON.stringify(res.body)).not.toMatch(/sql/i)")).toBe(true);
    expect(flagged("expect(JSON.stringify(await res.json())).not.toMatch(/sql/i)")).toBe(true);
    expect(flagged("expect(JSON.stringify(json)).not.toMatch(/form/i)")).toBe(true);
    expect(flagged("expect(JSON.stringify(data.payload)).not.toMatch(/FilePath/)")).toBe(false);
    expect(flagged("expect(leakText(res.body)).not.toMatch(/sql/i)")).toBe(false);
  });

  it("le motif voit les angles morts : plusieurs lignes, mise en forme, texte brut, deux temps, mot court", () => {
    const flagged = (code: string) => rawBodyLeakChecks(code).length > 0;
    expect(flagged("expect(\n  JSON.stringify(\n    res.body,\n  ),\n)\n  .not.toMatch(/sql/i)")).toBe(true);
    expect(flagged("expect(JSON.stringify(res.body, null, 2)).not.toMatch(/sql/i)")).toBe(true);
    expect(flagged('expect(JSON.stringify(res.body)).not.toContain("at")')).toBe(true);
    expect(flagged("expect(res.text).not.toMatch(/stack/i)")).toBe(false);
    expect(flagged("expect(res.text).not.toMatch(/pg|stack/i)")).toBe(true);
    expect(flagged("expect(await res.text()).not.toContain('SELECT')")).toBe(false);
    expect(flagged("expect(await res.text()).not.toContain('pg')")).toBe(true);
    expect(flagged("expect(String(res.body)).not.toMatch(/sql/i)")).toBe(true);
    expect(flagged("const raw = JSON.stringify(res.body);\n  expect(res.status).toBe(500);\n  expect(raw).not.toMatch(/sql/i);")).toBe(true);
    expect(flagged("const raw = await res.text();\nexpect(raw).not.toContain('pg');")).toBe(true);
  });

  it("le motif voit le message seul d'une 5xx, une classe ou un quantificateur, d'autres noms de réponse", () => {
    const flagged = (code: string) => rawBodyLeakChecks(code).length > 0;
    expect(flagged("expect(body.message).not.toMatch(/TEST|synchro/)")).toBe(true);
    expect(flagged("expect(res.body.message).not.toMatch(/sql/i)")).toBe(true);
    expect(flagged("expect(JSON.stringify(res.body)).not.toMatch(/\\d{4}/)")).toBe(true);
    expect(flagged("expect(JSON.stringify(res.body)).not.toMatch(/[a-z]+Error/)")).toBe(true);
    expect(flagged("expect(JSON.stringify(payload)).not.toMatch(/sql/i)")).toBe(true);
    expect(flagged("expect(messageText(res.body)).not.toMatch(/sql/i)")).toBe(false);
  });

  it("messageText retire le requestId du message", () => {
    const body = { message: "Erreur interne. Référence : qrSqlREDR7", requestId: "qrSqlREDR7" };
    expect(messageText(body)).not.toMatch(/sql/i);
    expect(messageText({ message: "SQLSTATE 23505", requestId: "abc" })).toMatch(/SQLSTATE/);
    expect(messageText(undefined)).toBe("");
  });

  it("le motif laisse passer les contrôles sûrs, les mots longs et les assertions positives", () => {
    const flagged = (code: string) => rawBodyLeakChecks(code).length > 0;
    expect(flagged("const raw = leakText(res.body);\nexpect(raw).not.toMatch(/sql/i);")).toBe(false);
    expect(flagged("expect(JSON.stringify(res.body)).toContain('Acces refuse')")).toBe(false);
    expect(flagged("expect(res.text).toContain('ok')")).toBe(false);
    expect(flagged("const raw = JSON.stringify(res.body);\nexpect(other).not.toMatch(/sql/i);")).toBe(false);
    expect(flagged("expect(JSON.stringify(res.body.message)).not.toMatch(/sql/i)")).toBe(false);
    expect(flagged('expect(JSON.stringify(res.body)).not.toContain("orderNumber")')).toBe(false);
    expect(flagged("expect(JSON.stringify(res.body)).not.toMatch(/SQLSTATE/)")).toBe(false);
  });

  it("leakText retire le requestId, y compris dans « Référence : … »", () => {
    const body = { message: "Erreur interne. Référence : qrSqlREDR7", code: "INTERNAL", requestId: "qrSqlREDR7" };
    expect(JSON.stringify(body)).toMatch(/sql/i);
    expect(leakText(body)).not.toMatch(/sql/i);
    expect(leakText(JSON.stringify(body))).not.toMatch(/sql/i);
    expect(leakText({ message: "SQLSTATE 23505", requestId: "abcdef" })).toMatch(/SQLSTATE/);
    expect(leakText("texte brut")).toBe("texte brut");
  });
});
