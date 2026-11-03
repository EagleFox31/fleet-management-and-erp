import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertSafeTestDatabase,
  assertUnitDatabaseNotProduction,
} from "../../../e2e/helpers/production-guard";

const LOCAL = "postgres://fleet:fleet@postgres:5432/fleet_test";
const PROD_NEON = "postgres://u:s3cr3t@ep-x.neon.tech/db";
const env = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;

function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  return "";
}

describe("garde-fou base de test (intégration, contrat)", () => {
  it("accepte la base locale quand DATABASE_URL_TEST est seul défini", () => {
    expect(assertSafeTestDatabase(env({ DATABASE_URL_TEST: LOCAL }))).toBe(LOCAL);
  });

  it("accepte DATABASE_URL identique à DATABASE_URL_TEST", () => {
    expect(assertSafeTestDatabase(env({ DATABASE_URL_TEST: LOCAL, DATABASE_URL: LOCAL }))).toBe(LOCAL);
  });

  it("(b) refuse quand DATABASE_URL_TEST manque, sans retomber sur DATABASE_URL", () => {
    const msg = messageOf(() => assertSafeTestDatabase(env({ DATABASE_URL: PROD_NEON })));
    expect(msg).toContain("DATABASE_URL_TEST");
    expect(msg).not.toContain("s3cr3t");
  });

  it("(a) refuse quand DATABASE_URL diffère de DATABASE_URL_TEST", () => {
    const msg = messageOf(() =>
      assertSafeTestDatabase(env({ DATABASE_URL_TEST: LOCAL, DATABASE_URL: PROD_NEON })),
    );
    expect(msg).toMatch(/DATABASE_URL\b.*DATABASE_URL_TEST/s);
    expect(msg).toContain("--env-file");
    expect(msg).not.toContain("s3cr3t");
    expect(msg).not.toContain("postgres://");
  });

  it("(a) refuse DATABASE_URL_LISTENER ou DATABASE_URL_DIRECT différents (server/db.ts leur donne la priorité)", () => {
    for (const name of ["DATABASE_URL_LISTENER", "DATABASE_URL_DIRECT"]) {
      const msg = messageOf(() => assertSafeTestDatabase(env({ DATABASE_URL_TEST: LOCAL, [name]: PROD_NEON })));
      expect(msg, name).toContain(name);
      expect(msg).not.toContain("s3cr3t");
    }
    const same = env({ DATABASE_URL_TEST: LOCAL, DATABASE_URL_LISTENER: LOCAL });
    expect(() => assertSafeTestDatabase(same)).not.toThrow();
  });

  it("(c) refuse un hôte *.neon.tech sans ALLOW_NEON_TEST_DB", () => {
    const msg = messageOf(() => assertSafeTestDatabase(env({ DATABASE_URL_TEST: PROD_NEON })));
    expect(msg).toContain("neon.tech");
    expect(msg).toContain("ALLOW_NEON_TEST_DB");
    expect(msg).not.toContain("s3cr3t");
  });

  it("(c) accepte une branche Neon de test quand ALLOW_NEON_TEST_DB=1", () => {
    const e = env({ DATABASE_URL_TEST: "postgres://u:p@ep-test.neon.tech/db", ALLOW_NEON_TEST_DB: "1" });
    expect(() => assertSafeTestDatabase(e)).not.toThrow();
  });

  it("(c) ALLOW_NEON_TEST_DB ne lève pas un hôte de TEST_DB_FORBIDDEN_HOSTS", () => {
    const e = env({
      DATABASE_URL_TEST: "postgres://u:p@ep-prod-abc.neon.tech/db",
      ALLOW_NEON_TEST_DB: "1",
      TEST_DB_FORBIDDEN_HOSTS: "ep-prod-abc, autre-hote",
    });
    expect(messageOf(() => assertSafeTestDatabase(e))).toContain("ep-prod-abc");
  });

  it("(c) TEST_DB_FORBIDDEN_HOSTS s'applique aussi hors Neon", () => {
    const e = env({ DATABASE_URL_TEST: "postgres://u:p@db.interne.example/x", TEST_DB_FORBIDDEN_HOSTS: "interne.example" });
    expect(() => assertSafeTestDatabase(e)).toThrow(/interne\.example/);
  });
});

describe("garde-fou base de test (unitaires)", () => {
  it("accepte l'absence de DATABASE_URL et une base locale", () => {
    expect(() => assertUnitDatabaseNotProduction(env({}))).not.toThrow();
    expect(() => assertUnitDatabaseNotProduction(env({ DATABASE_URL: LOCAL }))).not.toThrow();
  });

  it("refuse un DATABASE_URL qui porte un marqueur de production", () => {
    const e = env({ DATABASE_URL: PROD_NEON, TEST_DB_FORBIDDEN_HOSTS: "ep-x" });
    expect(() => assertUnitDatabaseNotProduction(e)).toThrow(/ep-x/);
  });
});

describe("câblage", () => {
  it("setup-db.ts appelle le garde-fou et ne retombe plus sur DATABASE_URL", () => {
    const src = readFileSync("tests/support/setup-db.ts", "utf8");
    expect(src).toContain("assertSafeTestDatabase(");
    expect(src).not.toMatch(/DATABASE_URL_TEST\s*\|\|\s*process\.env\.DATABASE_URL/);
  });

  it("les scripts d'intégration et de contrat ne chargent pas .env", () => {
    const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts as Record<string, string>;
    for (const name of ["test:integration", "test:contract"]) {
      expect(scripts[name], name).not.toContain("--env-file");
    }
  });

  it("vitest.config.ts déclare le setup des tests unitaires", () => {
    expect(readFileSync("vitest.config.ts", "utf8")).toContain("tests/support/setup-unit.ts");
  });
});
