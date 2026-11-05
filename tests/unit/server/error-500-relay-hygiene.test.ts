import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou issu de #172 (3 novembre 2026) : ces routeurs journalisaient
 * l'erreur puis répondaient 500 eux-mêmes. Résultat : deux traces par erreur,
 * pas de `requestId` dans la réponse, et `details: error.message` côté
 * fournisseurs (AGENTS.md §10). Ils relaient désormais au gestionnaire central
 * par `next(withLogContext(new AppError(500, …, { cause }), { event }))`.
 * Toute réponse 500 locale ou tout `console.*` réintroduit ici est une régression.
 */
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const ROUTERS = ["billing", "clients", "document-renewals", "operations", "supplier-invoices", "suppliers", "vehicles"];

const sourceOf = (name: string) =>
  readFileSync(join(ROOT, "server", "api", `${name}.routes.ts`), "utf-8");

describe.each(ROUTERS)("server/api/%s.routes.ts relaie ses 500", (name) => {
  const lines = sourceOf(name).split(/\r?\n/);

  it("ne répond jamais 500 lui-même", () => {
    // \s couvre aussi un appel coupé sur plusieurs lignes : `.status(\n 500)`.
    const hits = [...sourceOf(name).matchAll(/\.(?:status|sendStatus)\s*\(\s*500\s*\)/g)].map(
      (m) => `${sourceOf(name).slice(0, m.index).split("\n").length}: ${m[0]}`,
    );
    expect(hits).toEqual([]);
  });

  it("ne journalise pas par console.*", () => {
    const hits = lines.flatMap((l, i) => (/\bconsole\.\w+\(/.test(l) ? [`${i + 1}: ${l.trim()}`] : []));
    expect(hits).toEqual([]);
  });

  it("n'expose pas error.message dans une réponse", () => {
    const hits = lines.flatMap((l, i) => (/details:\s*(?:\w+ instanceof Error|[\w.]*\.message\b)/.test(l) ? [`${i + 1}: ${l.trim()}`] : []));
    expect(hits).toEqual([]);
  });

  it("pas de ternaire instanceof AppError juste après la garde qui relaie déjà l'AppError", () => {
    const hits = lines.flatMap((l, i) => {
      const guard = /^\s*if \((\w+) instanceof AppError\) return next\(\1\);\s*$/.exec(lines[i - 1] ?? "");
      return guard && new RegExp(`${guard[1]} instanceof AppError \\?`).test(l) ? [`${i + 1}: ${l.trim()}`] : [];
    });
    expect(hits).toEqual([]);
  });
});

describe("POST /api/admin/import-backup (server/api/admin-import-backup.routes.ts)", () => {
  it("ne renvoie pas le listage du dossier backup/ dans sa 404", () => {
    for (const file of [["server", "api", "admin-import-backup.routes.ts"], ["server", "services", "backup-import-service.ts"]]) {
      expect(readFileSync(join(ROOT, ...file), "utf-8")).not.toMatch(/availableFiles/);
    }
  });

  it("relaie son erreur au gestionnaire central, sans message brut ni console.*", () => {
    const source = readFileSync(join(ROOT, "server", "api", "admin-import-backup.routes.ts"), "utf-8");
    const start = source.indexOf('router.post("/admin/import-backup"');
    expect(start).toBeGreaterThan(-1);
    const handler = source.slice(start, source.indexOf("\n});", start));
    expect(handler).not.toMatch(/\bconsole\.\w+\(/);
    expect(handler).not.toMatch(/\.status\s*\(\s*500\s*\)/);
    expect(handler).not.toMatch(/errorMessage|error\.message/);
    expect(handler).toMatch(/next\(\s*withLogContext\(/);
  });
});
