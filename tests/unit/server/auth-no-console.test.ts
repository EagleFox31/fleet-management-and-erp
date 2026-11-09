import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou (AGENTS.md section 10) : le middleware d'authentification journalise par
 * `moduleLogger("auth")` (pino, champs structurés, masque des secrets), jamais par `console.*`.
 * Un `console.log` y affichait à chaque requête la méthode, le chemin et l'identifiant de session.
 */
const SOURCE = readFileSync(new URL("../../../server/middleware/auth.ts", import.meta.url), "utf8");

/** Retire commentaires et littéraux de chaîne simples pour ne juger que le code. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("server/middleware/auth.ts : journalisation", () => {
  it("n'appelle aucun console.*", () => {
    const calls = codeOnly(SOURCE).match(/\bconsole\s*\.\s*\w+/g) ?? [];
    expect(calls).toEqual([]);
  });

  it("passe par moduleLogger(\"auth\")", () => {
    expect(codeOnly(SOURCE)).toMatch(/moduleLogger\("auth"\)\.(debug|info)\(/);
  });

  it("ne journalise ni cookie, ni jeton, ni en-tête d'autorisation, ni session entière", () => {
    // Appel sur plusieurs lignes : de `(` en fin de ligne jusqu'à la première ligne qui ne contient que `)`.
    // Appel sur une ligne : limité à cette ligne (jamais d'avalement du code qui suit).
    const logged = codeOnly(SOURCE).match(/moduleLogger\("auth"\)\.\w+\(\s*?\n[\s\S]*?\n\s*\)|moduleLogger\("auth"\)\.\w+\([^\n]*\)/g) ?? [];
    expect(logged.length).toBeGreaterThan(0);
    for (const call of logged) {
      expect(call, call).not.toMatch(/cookie|\.headers|token|password|\bsession:\s*req\.session\b(?![.?])|sessionID|email/i);
    }
  });
});
