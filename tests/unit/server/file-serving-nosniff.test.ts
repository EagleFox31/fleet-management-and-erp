import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou issu de LESSONS_LEARNED (5 novembre 2026, fichier téléversé servi en ligne).
 *
 * Un fichier serveur qui renvoie un fichier (`res.sendFile`, `res.download`, flux redirigé vers
 * `res`) doit poser `X-Content-Type-Options: nosniff`, sinon le navigateur peut réinterpréter le
 * type du contenu. Les fichiers qui ne le font pas encore sont gelés ci-dessous : la liste ne peut
 * que rétrécir, et tout nouveau fichier qui sert un fichier sans `nosniff` fait échouer ce test.
 */

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const SERVER = join(ROOT, "server");

/** Non revus (AGENTS.md §9). Retirer une entrée dès que le fichier pose `nosniff`. */
const FROZEN_WITHOUT_NOSNIFF = new Set<string>([
  // GET /api/documents/:id/download et GET /api/workflows/documents/:documentId
  "server/routes.ts",
  // index.html de l'application compilée, pas un fichier téléversé
  "server/vite.ts",
]);

const SERVES_FILE = /res\.sendFile\(|res\.download\(|\.pipe\(\s*res\s*\)/;

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "_archive" ? [] : tsFiles(full);
    return name.endsWith(".ts") ? [full] : [];
  });
}

function filesServingWithoutNosniff(): string[] {
  return tsFiles(SERVER)
    .filter((file) => {
      const source = readFileSync(file, "utf8");
      return SERVES_FILE.test(source) && !/nosniff/i.test(source);
    })
    .map((file) => relative(ROOT, file).split("\\").join("/"))
    .sort();
}

describe("fichiers servis : nosniff obligatoire", () => {
  it("aucun nouveau fichier serveur ne sert un fichier sans nosniff", () => {
    const offenders = filesServingWithoutNosniff().filter((file) => !FROZEN_WITHOUT_NOSNIFF.has(file));
    expect(offenders).toEqual([]);
  });

  it("la liste gelée ne garde que des fichiers encore en défaut", () => {
    const stillFailing = new Set(filesServingWithoutNosniff());
    expect([...FROZEN_WITHOUT_NOSNIFF].filter((file) => !stillFailing.has(file))).toEqual([]);
  });

  it("le justificatif de règlement fournisseur pose nosniff", () => {
    const source = readFileSync(join(SERVER, "api/supplier-invoices.routes.ts"), "utf8");
    expect(SERVES_FILE.test(source)).toBe(true);
    expect(source).toMatch(/X-Content-Type-Options["'],\s*["']nosniff/);
  });
});
