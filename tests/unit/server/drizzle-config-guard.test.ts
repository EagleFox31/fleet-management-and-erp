import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * #268 : `drizzle-kit push` (npm run db:push) écrit le schéma. drizzle.config.ts appelle le garde
 * base de production au chargement : une URL marquée production est refusée hors NODE_ENV=production.
 */
const saved = { ...process.env };

async function loadConfig(vars: Record<string, string | undefined>) {
  vi.resetModules();
  for (const k of ["DATABASE_URL", "DATABASE_URL_LISTENER", "DATABASE_URL_DIRECT", "NODE_ENV", "ALLOW_PRODUCTION_DATABASE", "E2E_PRODUCTION_DB_MARKERS"]) {
    delete process.env[k];
  }
  Object.assign(process.env, vars);
  return (await import("../../../drizzle.config")).default as { dbCredentials: { url: string } };
}

afterEach(() => {
  process.env = { ...saved };
});

describe("drizzle.config.ts : garde base de production (#268)", () => {
  it("refuse une URL de production (ancien Neon et prod VPS)", async () => {
    await expect(loadConfig({ DATABASE_URL: "postgres://u:p@ep-bitter-term-ai6i3ey4.invalid/db" })).rejects.toThrow(/Connexion refusée/);
    await expect(loadConfig({ DATABASE_URL: "postgres://fleet:p@db-prod:5432/fleet", NODE_ENV: "development" })).rejects.toThrow(/db-prod/);
  });

  it("accepte le Postgres local et rend l'URL à drizzle-kit", async () => {
    const local = "postgres://fleet:fleet@localhost:54320/fleet_test";
    expect((await loadConfig({ DATABASE_URL: local })).dbCredentials.url).toBe(local);
  });
});
