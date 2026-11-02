import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * `initializeDatabase()` peut tourner deux fois en même temps (serveur de dev relancé par
 * `tsx watch` pendant le setup d'une suite de contrat, deux instances au déploiement).
 * Un `DROP TRIGGER` suivi d'un `CREATE TRIGGER` laisse alors l'une des deux échouer
 * (« trigger already exists ») : chaque trigger se crée en une instruction atomique.
 */
describe("init-database : créations sûres en concurrence", () => {
  const source = readFileSync(join(process.cwd(), "server", "init-database.ts"), "utf8");

  it("aucun CREATE TRIGGER sans OR REPLACE", () => {
    expect(source.match(/CREATE\s+TRIGGER/gi) ?? []).toEqual([]);
  });

  it("aucune paire DROP TRIGGER puis CREATE TRIGGER", () => {
    expect(source.match(/DROP\s+TRIGGER/gi) ?? []).toEqual([]);
  });
});
