import { describe, expect, it } from "vitest";
import { apiErrorProblems } from "../../support/api-error";

describe("apiErrorProblems (contrôle ApiErrorBody partagé contrats / e2e)", () => {
  const ok = { message: "Accès refusé.", code: "FORBIDDEN", requestId: "r1" };

  it("aucun écart pour un corps conforme, décodé ou texte brut", () => {
    expect(apiErrorProblems(403, ok, 403)).toEqual([]);
    expect(apiErrorProblems(403, JSON.stringify(ok), 403)).toEqual([]);
  });

  it("le code par défaut suit codeForStatus, un code explicite le remplace", () => {
    expect(apiErrorProblems(403, ok, 403, "CONFLICT")).toHaveLength(1);
    expect(apiErrorProblems(409, { message: "Déjà soldée.", code: "CONFLICT", requestId: "r2" }, 409)).toEqual([]);
  });

  it("signale statut, message vide, code faux et détail technique", () => {
    const problems = apiErrorProblems(500, { message: "", code: "INTERNAL", detail: 'violates foreign key "fk"' }, 400);
    expect(problems.join("\n")).toMatch(/statut 500 au lieu de 400/);
    expect(problems.join("\n")).toMatch(/message absent ou vide/);
    expect(problems.join("\n")).toMatch(/code INTERNAL au lieu de VALIDATION/);
    expect(problems.join("\n")).toMatch(/détail technique/);
  });

  it("corps non JSON ou absent : écart, jamais d'exception", () => {
    expect(apiErrorProblems(404, "<html>Cannot GET</html>", 404).join()).toMatch(/corps non JSON/);
    expect(apiErrorProblems(404, undefined, 404).join()).toMatch(/corps absent/);
    expect(apiErrorProblems(404, "null", 404).join()).toMatch(/corps absent/);
  });

  it("requestId exigé dans le corps : absent, vide ou non textuel est un écart", () => {
    for (const requestId of [undefined, "", "  ", 42, null]) {
      expect(apiErrorProblems(403, { message: "Accès refusé.", code: "FORBIDDEN", requestId }, 403).join()).toMatch(/requestId absent ou vide/);
    }
  });

  it("requestId comparé à l'en-tête X-Request-Id quand l'appelant le fournit", () => {
    expect(apiErrorProblems(403, ok, 403, undefined, "r1")).toEqual([]);
    expect(apiErrorProblems(403, ok, 403, undefined, "r9").join()).toMatch(/différent de l'en-tête X-Request-Id r9/);
    expect(apiErrorProblems(403, ok, 403, undefined, null).join()).toMatch(/en-tête X-Request-Id absent/);
  });
});
