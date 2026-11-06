import { Pool } from "@neondatabase/serverless";
import { afterAll, describe, expect, it, vi } from "vitest";
import { logPoolErrors } from "../../../server/lib/db-pool-errors";

/**
 * Erreur d'une connexion au repos (`server/db.ts`).
 *
 * pg-pool émet `error` sur le pool quand une connexion inactive casse. Sans écouteur, Node lève
 * l'erreur et le processus s'arrête : un redémarrage de la base suffisait à faire tomber le serveur.
 */
describe("logPoolErrors", () => {
  it("sans écouteur, l'erreur d'un pool est levée (ce qui arrêterait le processus)", () => {
    const pool = new Pool({ connectionString: "postgres://u:p@db:5432/x" });
    expect(() => pool.emit("error", new Error("terminating connection"))).toThrow(/terminating connection/);
  });

  it("journalise l'erreur avec le nom du pool, sans la lever", () => {
    const pool = new Pool({ connectionString: "postgres://u:p@db:5432/x" });
    const log = { error: vi.fn() };
    logPoolErrors(pool, "pool", log);

    const err = new Error("terminating connection due to administrator command");
    expect(() => pool.emit("error", err, {})).not.toThrow();
    expect(log.error).toHaveBeenCalledOnce();
    expect(log.error.mock.calls[0][0]).toEqual({ err, pool: "pool" });
  });
});

describe("server/db", () => {
  vi.stubEnv("DATABASE_URL", "postgres://u:p@db:5432/x");
  afterAll(() => vi.unstubAllEnvs());

  it("écoute l'erreur sur les deux pools : une émission ne fait pas tomber le processus", async () => {
    const { pool, listenerPool } = await import("../../../server/db");
    for (const p of [pool, listenerPool]) {
      expect(p.listenerCount("error")).toBe(1);
      expect(() => p.emit("error", new Error("connexion au repos perdue"), {})).not.toThrow();
    }
  });
});
