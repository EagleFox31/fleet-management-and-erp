import { describe, expect, it } from "vitest";
import { assertRecetteEnvironment, RecetteGuardError } from "../../../scripts/lib/recette-guard";
import { passwordFor, RECETTE_ACCOUNTS } from "../../../scripts/recette-seed";

const base = { APP_ENV: "recette", DATABASE_URL: "postgres://u:p@db.recette.example/x", RECETTE_DB_HOST_ALLOW: "db.recette.example" };

describe("garde du seed et du reset de recette", () => {
  it("accepte recette sur un hôte autorisé", () => {
    expect(assertRecetteEnvironment(base).host).toBe("db.recette.example");
  });
  it("refuse hors recette", () => {
    expect(() => assertRecetteEnvironment({ ...base, APP_ENV: "production" })).toThrow(RecetteGuardError);
    expect(() => assertRecetteEnvironment({ ...base, APP_ENV: undefined })).toThrow(RecetteGuardError);
  });
  it("refuse un hôte hors liste ou une liste vide", () => {
    expect(() => assertRecetteEnvironment({ ...base, DATABASE_URL: "postgres://u:p@prod.example/x" })).toThrow(/RECETTE_DB_HOST_ALLOW/);
    expect(() => assertRecetteEnvironment({ ...base, RECETTE_DB_HOST_ALLOW: "" })).toThrow(RecetteGuardError);
  });
  it("lit les mots de passe dans l'environnement seulement", () => {
    expect(() => passwordFor("admin", {})).toThrow();
    expect(passwordFor("admin", { RECETTE_PASSWORD: "x".repeat(12) })).toHaveLength(12);
    expect(new Set(RECETTE_ACCOUNTS.map((a) => a.role)).size).toBe(9);
  });
});
