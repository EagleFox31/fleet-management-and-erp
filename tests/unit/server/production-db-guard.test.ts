import { describe, expect, it } from "vitest";
import { assertServerNotProductionDatabase, guardDatabaseConnection } from "../../../server/lib/production-db-guard";
import * as e2eGuard from "../../../e2e/helpers/production-guard";
import * as shared from "../../../shared/production-database";

const PROD = "postgresql://u:p%40ss@ep-bitter-term-ai6i3ey4-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require";
const LOCAL = "postgres://fleet:fleet@postgres:5432/fleet_dev";
const env = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;

describe("garde base de production au démarrage du serveur (#259)", () => {
  it("refuse DATABASE_URL de production en développement, sans divulguer l'URL", () => {
    let message = "";
    try {
      assertServerNotProductionDatabase(env({ NODE_ENV: "development", DATABASE_URL: PROD }));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/Démarrage refusé : DATABASE_URL vise la base de production/);
    expect(message).toMatch(/ALLOW_PRODUCTION_DATABASE=1/);
    expect(message).not.toContain("p%40ss");
    expect(message).not.toContain(PROD);
  });

  it("refuse aussi sans NODE_ENV et sur DATABASE_URL_LISTENER / DATABASE_URL_DIRECT", () => {
    expect(() => assertServerNotProductionDatabase(env({ DATABASE_URL: PROD }))).toThrow(/NODE_ENV=\(non défini\)/);
    for (const v of ["DATABASE_URL_LISTENER", "DATABASE_URL_DIRECT"]) {
      expect(() => assertServerNotProductionDatabase(env({ DATABASE_URL: LOCAL, [v]: PROD }))).toThrow(v);
    }
  });

  it("respecte les marqueurs ajoutés par E2E_PRODUCTION_DB_MARKERS", () => {
    const e = env({ DATABASE_URL: "postgres://u:p@db.vps.example:5432/fleet", E2E_PRODUCTION_DB_MARKERS: "db.vps.example" });
    expect(() => assertServerNotProductionDatabase(e)).toThrow(/db\.vps\.example/);
  });

  it("laisse passer une base locale", () => {
    expect(assertServerNotProductionDatabase(env({ NODE_ENV: "development", DATABASE_URL: LOCAL }))).toEqual({ status: "clear" });
  });

  it("dérogation explicite : ALLOW_PRODUCTION_DATABASE=1 seulement", () => {
    expect(
      assertServerNotProductionDatabase(env({ DATABASE_URL: PROD, ALLOW_PRODUCTION_DATABASE: "1" })),
    ).toEqual({ status: "overridden", variable: "DATABASE_URL", marker: "ep-bitter-term-ai6i3ey4" });
    for (const v of ["true", "yes", "0", ""]) {
      expect(() => assertServerNotProductionDatabase(env({ DATABASE_URL: PROD, ALLOW_PRODUCTION_DATABASE: v }))).toThrow();
    }
  });

  it("no-op en production (l'image vise sa propre base)", () => {
    expect(assertServerNotProductionDatabase(env({ NODE_ENV: "production", DATABASE_URL: PROD }))).toEqual({ status: "skipped" });
  });

  it("source unique : le garde e2e réexporte les fonctions partagées, sans copie", () => {
    expect(e2eGuard.matchProductionMarker).toBe(shared.matchProductionMarker);
    expect(e2eGuard.productionMarkers).toBe(shared.productionMarkers);
    expect(e2eGuard.hostOf).toBe(shared.hostOf);
    expect(e2eGuard.DEFAULT_PRODUCTION_MARKERS).toBe(shared.DEFAULT_PRODUCTION_MARKERS);
  });

  it("guardDatabaseConnection lève sur la base marquée et laisse passer la dérogation", () => {
    expect(() => guardDatabaseConnection("t", env({ DATABASE_URL: PROD }))).toThrow(/Démarrage refusé/);
    expect(guardDatabaseConnection("t", env({ DATABASE_URL: PROD, ALLOW_PRODUCTION_DATABASE: "1" })).status).toBe("overridden");
    expect(guardDatabaseConnection("t", env({ DATABASE_URL: LOCAL })).status).toBe("clear");
  });
});
