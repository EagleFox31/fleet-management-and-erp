import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertNotProductionDatabase,
  databaseUrlFromDotenv,
  hostOf,
  matchProductionMarker,
  productionMarkers,
  resolveTargetDatabaseUrl,
} from "../../../e2e/helpers/production-guard";

const PROD = "postgresql://u:p%40ss@ep-bitter-term-ai6i3ey4-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require";
const TEST = "postgresql://u:secret@ep-plain-lake-aiwwjuv3-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require";
const noDotenv = () => undefined;
const env = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;

describe("production-guard (e2e)", () => {
  it("extrait l'hôte, même avec un mot de passe contenant des caractères spéciaux", () => {
    expect(hostOf("postgresql://u:p@ss@Host.Example:5432/db?x=1")).toBe("host.example:5432");
    expect(hostOf("pas une url")).toBe("");
  });

  it("reconnaît l'endpoint de production, pooler ou non", () => {
    const markers = productionMarkers({});
    expect(matchProductionMarker(PROD, markers)).toBe("ep-bitter-term-ai6i3ey4");
    expect(matchProductionMarker(PROD.replace("-pooler", ""), markers)).toBe("ep-bitter-term-ai6i3ey4");
  });

  it("laisse passer une branche de test, une URL vide ou absente", () => {
    const markers = productionMarkers({});
    expect(matchProductionMarker(TEST, markers)).toBeNull();
    expect(matchProductionMarker("", markers)).toBeNull();
    expect(matchProductionMarker(undefined, markers)).toBeNull();
  });

  it("ne cherche le marqueur que dans l'hôte, pas dans le mot de passe ou le chemin", () => {
    const url = "postgresql://u:ep-bitter-term-ai6i3ey4@ep-plain-lake.neon.tech/ep-bitter-term-ai6i3ey4";
    expect(matchProductionMarker(url, productionMarkers({}))).toBeNull();
  });

  it("étend la liste par E2E_PRODUCTION_DB_MARKERS sans retirer le défaut", () => {
    const markers = productionMarkers(env({ E2E_PRODUCTION_DB_MARKERS: " db.prod.example , ep-autre " }));
    expect(markers).toEqual(expect.arrayContaining(["ep-bitter-term-ai6i3ey4", "db.prod.example", "ep-autre"]));
    expect(matchProductionMarker("postgres://u:p@DB.PROD.EXAMPLE:5432/x", markers)).toBe("db.prod.example");
  });

  it("refuse la production avec un message actionnable sans URL ni mot de passe", () => {
    let message = "";
    try {
      assertNotProductionDatabase(env({ DATABASE_URL: PROD }), noDotenv);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("ep-bitter-term-ai6i3ey4");
    expect(message).toContain("DATABASE_URL");
    expect(message).toContain("E2E_PRODUCTION_DB_MARKERS");
    expect(message).not.toContain("p%40ss");
    expect(message).not.toContain("postgresql://");
  });

  it("accepte une base de test", () => {
    expect(() => assertNotProductionDatabase(env({ DATABASE_URL: TEST }), noDotenv)).not.toThrow();
  });

  it("sans variable, lit le .env que le serveur chargerait et le refuse s'il vise la production", () => {
    expect(databaseUrlFromDotenv(`SESSION_SECRET=x\nDATABASE_URL="${PROD}"\n`)).toBe(PROD);
    expect(resolveTargetDatabaseUrl(env({}), () => `DATABASE_URL=${TEST}`)).toBe(TEST);
    expect(() => assertNotProductionDatabase(env({}), () => `DATABASE_URL=${PROD}\r\n`)).toThrow(/production/);
  });

  it("la variable d'environnement prime sur le .env", () => {
    expect(() => assertNotProductionDatabase(env({ DATABASE_URL: TEST }), () => `DATABASE_URL=${PROD}`)).not.toThrow();
  });

  it("playwright.config.ts appelle le garde-fou", () => {
    expect(readFileSync("playwright.config.ts", "utf8")).toMatch(/assertNotProductionDatabase\(\)/);
  });
});
