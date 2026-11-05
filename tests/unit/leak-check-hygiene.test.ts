import { describe, expect, it } from "vitest";
import { leakText } from "../support/api-error";
import { readRepoFiles, REPO_SCAN_TIMEOUT_MS, repoFiles } from "../support/repo-files";

/**
 * Garde-fou issu de deux échecs aléatoires (3 novembre 2026) : un contrôle de fuite technique
 * passé sur le corps entier d'une réponse d'erreur inclut le `requestId` aléatoire
 * (`nanoid(10)`). « qrSqlREDR7 » a fait échouer `/sql/i`. Un contrôle de fuite passe par
 * `leakText(body)` (tests/support/api-error.ts), qui retire cette référence.
 *
 * Angles morts connus du motif : `expect` écrit sur plusieurs lignes, `res.text()`, `.not.toContain` sur un
 * mot court. Les ajouter ici si un faux rouge en révèle un.
 */
const RAW_BODY_LEAK_CHECK = /JSON\.stringify\(\s*(?:await\s+[\w.]+\.json\(\)|[\w.]*(?:body|json))\s*\)\s*\)\s*\.not\.toMatch/i;
const SELF = "tests/unit/leak-check-hygiene.test.ts";

describe("contrôles de fuite dans les réponses d'erreur", () => {
  it("aucun test ne contrôle une fuite sur le corps brut (requestId compris)", async () => {
    const files = repoFiles().filter((f) => (f.startsWith("tests/") || f.startsWith("e2e/")) && /\.(test|spec)\.ts$/.test(f) && f !== SELF);
    expect(files.length).toBeGreaterThan(50);
    const offenders = (await readRepoFiles(files)).filter(([, text]) => RAW_BODY_LEAK_CHECK.test(text)).map(([f]) => f);
    expect(offenders).toEqual([]);
  }, REPO_SCAN_TIMEOUT_MS);

  it("le motif reconnaît l'ancien contrôle, quel que soit le nom de la réponse", () => {
    expect(RAW_BODY_LEAK_CHECK.test("expect(JSON.stringify(second.body)).not.toMatch(/sql/i)")).toBe(true);
    expect(RAW_BODY_LEAK_CHECK.test("expect(JSON.stringify(res.body)).not.toMatch(/sql/i)")).toBe(true);
    expect(RAW_BODY_LEAK_CHECK.test("expect(JSON.stringify(await res.json())).not.toMatch(/sql/i)")).toBe(true);
    expect(RAW_BODY_LEAK_CHECK.test("expect(JSON.stringify(json)).not.toMatch(/form/i)")).toBe(true);
    expect(RAW_BODY_LEAK_CHECK.test("expect(JSON.stringify(data.payload)).not.toMatch(/FilePath/)")).toBe(false);
    expect(RAW_BODY_LEAK_CHECK.test("expect(leakText(res.body)).not.toMatch(/sql/i)")).toBe(false);
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
