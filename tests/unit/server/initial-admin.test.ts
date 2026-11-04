import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEV_INITIAL_ADMIN_PASSWORD, planInitialAdmin } from "../../../server/lib/initial-admin";
import { listMigrationFiles } from "../../../server/lib/migration-files";

describe("planInitialAdmin : jamais admin/admin123 en production", () => {
  it.each([{ NODE_ENV: "production" }, { NODE_ENV: "Production" }, { NODE_ENV: "staging" }, {}])(
    "production (%o) sans ADMIN_INITIAL_PASSWORD : aucun compte, raison actionnable",
    (env) => {
      const plan = planInitialAdmin(env);
      expect(plan.create).toBe(false);
      if (!plan.create) expect(plan.reason).toContain("ADMIN_INITIAL_PASSWORD");
    },
  );

  it("production avec un mot de passe trop court : aucun compte, la valeur n'apparaît pas", () => {
    const plan = planInitialAdmin({ NODE_ENV: "production", ADMIN_INITIAL_PASSWORD: "court-11car" });
    expect(plan.create).toBe(false);
    if (!plan.create) expect(plan.reason).not.toContain("court-11car");
  });

  it("production avec ADMIN_INITIAL_PASSWORD (12+) : compte créé avec ce mot de passe", () => {
    const plan = planInitialAdmin({ NODE_ENV: "production", ADMIN_INITIAL_PASSWORD: "un-secret-solide" });
    expect(plan).toEqual({ create: true, username: "admin", password: "un-secret-solide", source: "env" });
  });

  it.each(["development", "test"])("%s sans variable : comportement inchangé (admin/admin123)", (NODE_ENV) => {
    expect(planInitialAdmin({ NODE_ENV })).toEqual({
      create: true,
      username: "admin",
      password: DEV_INITIAL_ADMIN_PASSWORD,
      source: "dev-default",
    });
  });

  it("développement avec une variable trop courte : refus plutôt que repli silencieux", () => {
    expect(planInitialAdmin({ NODE_ENV: "development", ADMIN_INITIAL_PASSWORD: "abc" }).create).toBe(false);
  });
});

describe("listMigrationFiles : un dossier absent interrompt le démarrage", () => {
  it("lève si le dossier n'existe pas", async () => {
    await expect(listMigrationFiles(path.join(tmpdir(), "absent-migrations-xyz"))).rejects.toThrow(
      /Migrations introuvables .* le démarrage est interrompu/,
    );
  });

  it("rend les seuls .sql, triés", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "migrations-"));
    for (const name of ["b.sql", "a.sql", "notes.md"]) writeFileSync(path.join(dir, name), "");
    await expect(listMigrationFiles(dir)).resolves.toEqual(["a.sql", "b.sql"]);
  });
});
