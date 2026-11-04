import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// L'image de #242 ne se construisait pas (attached_assets exclu du contexte) et, construite, aurait
// démarré sans migrations ni triggers : init-database les sautait sans erreur. Voir LESSONS_LEARNED,
// 4 novembre 2026. Ce garde vérifie que ce que le serveur lit depuis le cwd est bien dans l'image.
const root = path.resolve(__dirname, "../../..");
const dockerfile = readFileSync(path.join(root, "Dockerfile"), "utf-8");
const dockerignore = readFileSync(path.join(root, ".dockerignore"), "utf-8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));
const runtimeStage = dockerfile.slice(dockerfile.indexOf("AS runtime"));

describe("image Docker : fichiers lus au démarrage", () => {
  it.each(["server/db/migrations", "server/db/triggers"])("l'étape runtime copie %s", (dir) => {
    expect(runtimeStage).toMatch(new RegExp(`^COPY ${dir} \\./${dir}$`, "m"));
  });

  it("l'étape runtime copie le papier à en-tête TAY", () => {
    expect(runtimeStage).toMatch(/^COPY attached_assets\/TAY-header-final\.png .*\.\/attached_assets\/$/m);
  });

  // GET /api/documentation/:filename lit ces fichiers depuis le cwd (#285) : absents, l'aperçu admin répond 500
  it.each(["docs/guides/GUIDE_UTILISATEUR.md", "docs/qa/CAHIER_TESTS_UTILISATEUR.md"])("l'image contient %s", (file) => {
    const dir = file.slice(0, file.lastIndexOf("/") + 1);
    expect(runtimeStage).toContain(`COPY ${file} ./${dir}`);
    expect(dockerignore).toContain(`!${file}`);
    expect(readFileSync(path.join(root, "server", "routes.ts"), "utf-8")).toContain(`'${file}'`);
  });

  it.each(["attached_assets", "server", "server/db", "shared", "client"])(
    ".dockerignore n'exclut pas %s (le build ou le démarrage en dépend)",
    (entry) => {
      expect(dockerignore).not.toContain(entry);
      expect(dockerignore).not.toContain(`${entry}/`);
    },
  );

  it("le conteneur démarre sans passer par cross-env", () => {
    expect(runtimeStage).toMatch(/^CMD \["node", "dist\/index\.js"\]$/m);
  });
});
