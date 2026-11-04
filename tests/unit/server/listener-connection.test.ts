import { describe, expect, it } from "vitest";
import { resolveListenerConnectionString, sameDatabase } from "../../../server/lib/listener-connection";
import { pinListenerUrlsToTestDatabase } from "../../support/listener-env";

/** #298 : en test, listenerPool (LISTEN, verrous consultatifs) vise la base de DATABASE_URL. */
const TEST = "postgres://fleet:fleet@localhost:54320/fleet_test";
const OTHER_DB = "postgres://fleet:fleet@localhost:54320/fleet_prod_copy";
const NEON_POOLER = "postgres://u:p@ep-x-pooler.eu.aws.neon.tech/neondb";
const NEON_DIRECT = "postgres://u:p@ep-x.eu.aws.neon.tech/neondb";

describe("resolveListenerConnectionString", () => {
  it("sans variable dédiée : DATABASE_URL, suffixe -pooler retiré", () => {
    expect(resolveListenerConnectionString({ NODE_ENV: "test", DATABASE_URL: TEST })).toBe(TEST);
    expect(resolveListenerConnectionString({ NODE_ENV: "test", DATABASE_URL: NEON_POOLER })).toBe(NEON_DIRECT);
  });

  it("en test, DATABASE_URL_LISTENER ou DATABASE_URL_DIRECT vers une autre base : refus, sans URL dans le message", () => {
    for (const variable of ["DATABASE_URL_LISTENER", "DATABASE_URL_DIRECT"]) {
      const run = () => resolveListenerConnectionString({ NODE_ENV: "test", DATABASE_URL: TEST, [variable]: OTHER_DB });
      expect(run).toThrow(variable);
      expect(run).not.toThrow(/fleet:fleet|localhost/);
    }
  });

  it("en test, même base (directe ou poolée) : acceptée", () => {
    expect(resolveListenerConnectionString({ NODE_ENV: "test", DATABASE_URL: TEST, DATABASE_URL_DIRECT: TEST })).toBe(TEST);
    expect(
      resolveListenerConnectionString({ NODE_ENV: "test", DATABASE_URL: NEON_POOLER, DATABASE_URL_LISTENER: NEON_DIRECT }),
    ).toBe(NEON_DIRECT);
  });

  it("hors test, comportement inchangé : la variable dédiée l'emporte", () => {
    expect(resolveListenerConnectionString({ NODE_ENV: "development", DATABASE_URL: TEST, DATABASE_URL_DIRECT: OTHER_DB })).toBe(OTHER_DB);
  });

  it("sameDatabase compare hôte direct, port et base", () => {
    expect(sameDatabase(TEST, "postgres://autre:mdp@localhost:54320/fleet_test")).toBe(true);
    expect(sameDatabase(TEST, "postgres://fleet:fleet@localhost:5432/fleet_test")).toBe(false);
    expect(sameDatabase(TEST, OTHER_DB)).toBe(false);
    expect(sameDatabase(TEST, "pas une url")).toBe(false);
  });
});

describe("pinListenerUrlsToTestDatabase (setup-db)", () => {
  it("écrase des variables héritées par DATABASE_URL de test", () => {
    const env: NodeJS.ProcessEnv = { DATABASE_URL: TEST, DATABASE_URL_LISTENER: OTHER_DB, DATABASE_URL_DIRECT: OTHER_DB };
    pinListenerUrlsToTestDatabase(env);
    expect(env.DATABASE_URL_LISTENER).toBe(TEST);
    expect(env.DATABASE_URL_DIRECT).toBe(TEST);
    expect(resolveListenerConnectionString({ ...env, NODE_ENV: "test" })).toBe(TEST);
  });

  it("sans DATABASE_URL : erreur explicite", () => {
    expect(() => pinListenerUrlsToTestDatabase({})).toThrow("DATABASE_URL");
  });
});
