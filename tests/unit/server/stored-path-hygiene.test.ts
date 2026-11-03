import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";
import { describe, expect, it } from "vitest";
import { fileAccessKey, scanFileAccesses, type FileAccessSite } from "../../support/file-access-scan";

/**
 * AGENTS.md §9 : un chemin lu en base n'ouvre, ne sert, ne copie ni ne supprime un fichier
 * qu'après `uploadedFileCandidates`, `existingUploadedFile` ou `isInsideDirectory`.
 *
 * Tout appel disque de `server/` dont la portée ne passe par aucune de ces bornes doit figurer
 * ci-dessous, avec la raison pour laquelle son chemin ne vient pas de la base. Liste gelée et
 * stricte : une nouvelle entrée se justifie en relecture, une entrée morte fait échouer le test.
 */
const UNBOUNDED_FROZEN: Record<string, string> = {
  "server/api/document-renewals.routes.ts:removeUploadedProof:unlinkSync":
    "req.file.path : fichier que multer vient d'écrire pour cette requête, jamais une valeur de la base",
  "server/api/supplier-invoices.routes.ts:removeUploadedProof:unlinkSync":
    "req.file.path : fichier que multer vient d'écrire pour cette requête, jamais une valeur de la base",
  "server/services/workflow-document-service.ts:saveWorkflowDocument:rmSync":
    "nettoie le fichier que la même fonction vient d'écrire (sessionId contrôlé par isSafePathSegment)",
  "server/services/workflow-document-service.ts:cleanupAbandonedWorkflowDocuments:rmSync":
    "dossier uploads/workflows/<sessionId> construit en dur, sessionId contrôlé par isSafePathSegment",
  "server/init-database.ts:applySqlFile:readFile": "fichiers de migration SQL livrés avec le code",
  "server/lib/tay-header-asset.ts:readTayHeaderImage:readFile": "image d'en-tête livrée avec le code",
  "server/routes.ts:GET /api/documentation/:filename:readFile": "liste blanche de noms de fichiers de documentation",
  "server/routes.ts:POST /api/admin/import-backup:readFileSync": "fichier choisi parmi le listage du dossier backup/",
  "server/lib/backup/encrypt.ts:encryptFile:createReadStream": "fichier temporaire de sauvegarde produit par le job",
  "server/lib/backup/encrypt.ts:decryptFile:createReadStream": "fichier de sauvegarde du dossier de sauvegarde configuré",
  "server/lib/backup/storage.ts:remove:rm": "nom résolu sous le dossier de sauvegarde configuré",
  "server/jobs/backup.ts:runBackup:rm": "fichier temporaire créé par le job lui-même",
  "server/vite.ts:USE *:readFile": "index.html du client (développement)",
  "server/vite.ts:USE *:sendFile": "index.html du build client (production)",
};

/** Code mort, exclu du scan (AGENTS.md §9). */
const DEAD_CODE = [/^server\/_archive\//, /vehicle-activation-service-.*\.ts$/, /vehicle-deletion-service-.*\.ts$/];

const root = process.cwd();
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return name.endsWith(".ts") ? [full] : [];
  });

const sites: FileAccessSite[] = walk(join(root, "server"))
  .map((full) => relative(root, full).split(sep).join("/"))
  .filter((file) => !DEAD_CODE.some((pattern) => pattern.test(file)))
  .flatMap((file) => scanFileAccesses(file, readFileSync(join(root, file), "utf8")));

describe("accès disque : chemin borné à uploads/ ou exception justifiée (AGENTS.md §9)", () => {
  it("le scan voit les accès bornés connus (il n'est pas aveugle)", () => {
    const bounded = new Set(sites.filter((s) => s.bounded).map(fileAccessKey));
    for (const key of [
      "server/routes.ts:GET /api/documents/:id/download:download",
      "server/routes.ts:GET /api/workflows/documents/:documentId:createReadStream",
      "server/middleware/upload.ts:deleteFile:unlink",
      "server/services/workflow-document-service.ts:deleteWorkflowDocument:unlinkSync",
      "server/services/workflow-document-service.ts:transferDocumentsToVehicle:copyFileSync",
    ]) {
      expect(bounded, key).toContain(key);
    }
  });

  it("tout accès non borné figure dans la liste gelée", () => {
    const unbounded = sites.filter((s) => !s.bounded && !(fileAccessKey(s) in UNBOUNDED_FROZEN));
    expect(unbounded.map((s) => `${fileAccessKey(s)} (ligne ${s.line})`)).toEqual([]);
  });

  it("aucune exception n'est morte ni devenue bornée", () => {
    const live = new Set(sites.filter((s) => !s.bounded).map(fileAccessKey));
    expect(Object.keys(UNBOUNDED_FROZEN).filter((key) => !live.has(key))).toEqual([]);
  });

  it("chaque exception porte une justification", () => {
    for (const [key, reason] of Object.entries(UNBOUNDED_FROZEN)) expect(reason.length, key).toBeGreaterThan(20);
  });
});

describe("scanFileAccesses", () => {
  it("borné si la portée appelle une borne, non borné sinon", () => {
    const text = `
      function ok(p) { const f = uploadedFileCandidates(p)[0]; fs.unlinkSync(f); }
      function ko(p) { fs.unlinkSync(p); }
      router.get("/x/:id", (req, res) => { res.sendFile(req.query.p); });
    `;
    expect(scanFileAccesses("a.ts", text).map((s) => [fileAccessKey(s), s.bounded])).toEqual([
      ["a.ts:ok:unlinkSync", true],
      ["a.ts:ko:unlinkSync", false],
      ["a.ts:GET /x/:id:sendFile", false],
    ]);
  });

  it("une borne hors de la portée ne compte pas", () => {
    const text = `
      function guard(p) { return isInsideDirectory("uploads", p); }
      function ko(p) { fs.rmSync(p); }
    `;
    expect(scanFileAccesses("b.ts", text).map((s) => s.bounded)).toEqual([false]);
  });
});
