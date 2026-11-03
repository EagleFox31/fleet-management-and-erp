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
    expect(apiErrorProblems(409, { message: "Déjà soldée.", code: "CONFLICT" }, 409)).toEqual([]);
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
});
