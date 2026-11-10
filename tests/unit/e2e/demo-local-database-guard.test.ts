import { describe, expect, it } from "vitest";
import { assertLocalDatabase } from "../../../e2e/demo/local-database-guard";

describe("assertLocalDatabase (seed de démo)", () => {
  it.each([
    "postgres://fleet:fleet@localhost:54320/fleet_test",
    "postgres://fleet:fleet@postgres:5432/fleet_test",
    "postgres://fleet:fleet@127.0.0.1:54320/fleet_test_demo_compta",
    "postgres://fleet:fleet@postgres:5432/fleet_test_v5b1",
  ])("accepte la base locale %s", (url) => {
    expect(() => assertLocalDatabase(url)).not.toThrow();
  });

  it.each([
    ["hôte distant", "postgres://u:p@ep-cool-name.eu-central-1.aws.neon.tech/fleet_test"],
    ["base de prod sur hôte local", "postgres://fleet:fleet@localhost:54320/neondb"],
    ["préfixe sans séparateur", "postgres://fleet:fleet@localhost:54320/fleet_testprod"],
    ["suffixe en majuscules", "postgres://fleet:fleet@localhost:54320/fleet_test_PROD"],
    ["sous-chemin", "postgres://fleet:fleet@localhost:54320/fleet_test/x"],
    ["URL absente", undefined],
    ["URL invalide", "pas une url"],
  ])("refuse : %s", (_label, url) => {
    expect(() => assertLocalDatabase(url)).toThrow(/Seed de démo refusé/);
  });
});
