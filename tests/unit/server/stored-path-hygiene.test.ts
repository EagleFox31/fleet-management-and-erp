import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";
import { describe, expect, it } from "vitest";
import { fileAccessKey, renamedAccessImports, scanFileAccesses, type FileAccessSite } from "../../support/file-access-scan";

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
  "server/services/workflow-document-service.ts:transferDocumentsToVehicle:copyFileSync":
    "source bornée par uploadedFileCandidates ; destination sous uploads/documents/vehicle-<vehicleId>, vehicleId entier (signature number), gardée par isInsideDirectory",
  "server/init-database.ts:applySqlFile:readFile": "fichiers de migration SQL livrés avec le code",
  "server/lib/tay-header-asset.ts:readTayHeaderImage:readFile": "image d'en-tête livrée avec le code",
  "server/routes.ts:GET /api/documentation/:filename:readFile": "liste blanche de noms de fichiers de documentation",
  "server/routes.ts:POST /api/admin/import-backup:readFileSync": "fichier choisi parmi le listage du dossier backup/",
  "server/lib/backup/encrypt.ts:encryptFile:createReadStream": "fichier temporaire de sauvegarde produit par le job",
  "server/lib/backup/encrypt.ts:decryptFile:createReadStream": "fichier de sauvegarde du dossier de sauvegarde configuré",
  "server/lib/backup/encrypt.ts:decryptFile:open": "même fichier de sauvegarde, ouvert pour lire l'en-tête et l'étiquette",
  "server/lib/backup/storage.ts:remove:rm":
    "nom lu en base (backup_runs) mais contrôlé par SAFE_NAME (aucun séparateur ni ..), résolu sous BACKUP_DIR",
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
    return /\.(ts|js|mjs|cjs)$/.test(name) ? [full] : [];
  });

const files = walk(join(root, "server"))
  .map((full) => relative(root, full).split(sep).join("/"))
  .filter((file) => !DEAD_CODE.some((pattern) => pattern.test(file)));
const sites: FileAccessSite[] = files.flatMap((file) => scanFileAccesses(file, readFileSync(join(root, file), "utf8")));

describe("accès disque : chemin borné à uploads/ ou exception justifiée (AGENTS.md §9)", () => {
  it("le scan voit les accès bornés connus (il n'est pas aveugle)", () => {
    const bounded = new Set(sites.filter((s) => s.bounded).map(fileAccessKey));
    for (const key of [
      "server/routes.ts:GET /api/documents/:id/download:download",
      "server/routes.ts:GET /api/workflows/documents/:documentId:createReadStream",
      "server/middleware/upload.ts:deleteFile:unlink",
      "server/services/workflow-document-service.ts:deleteWorkflowDocument:unlinkSync",
    ]) {
      expect(bounded, key).toContain(key);
    }
  });

  it("tout accès non borné figure dans la liste gelée", () => {
    const unbounded = sites.filter((s) => !s.bounded && !(fileAccessKey(s) in UNBOUNDED_FROZEN));
    expect(unbounded.map((s) => `${fileAccessKey(s)} (ligne ${s.line})`)).toEqual([]);
  });

  it("une exception couvre un seul appel (un second appel dans la même portée se justifie à part)", () => {
    const counts = new Map<string, number>();
    for (const site of sites.filter((s) => !s.bounded)) counts.set(fileAccessKey(site), (counts.get(fileAccessKey(site)) ?? 0) + 1);
    expect([...counts].filter(([, count]) => count > 1)).toEqual([]);
  });

  it("aucun appel disque importé sous un autre nom (il échapperait au scan)", () => {
    expect(files.flatMap((file) => renamedAccessImports(file, readFileSync(join(root, file), "utf8")))).toEqual([]);
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

  it("borné par chaîne de déclarations ou par garde sur la même variable", () => {
    const text = `
      function chain(p) { const all = uploadedFileCandidates(p); const hit = all.find((c) => fs.existsSync(c)); res.download(hit); }
      function guard(p) { if (!isInsideDirectory(path.join(process.cwd(), "uploads"), p)) throw new Error("x"); fs.rmSync(p); }
      function loop(p) { for (const c of uploadedFileCandidates(p)) fs.unlink(c, () => {}); }
    `;
    expect(scanFileAccesses("c.ts", text).map((s) => s.bounded)).toEqual([true, true, true]);
  });

  it("une borne sur une autre variable, en commentaire ou via path ne compte pas", () => {
    const text = `
      router.get("/a", (req, res) => { const ok = uploadedFileCandidates(req.query.a); res.sendFile(req.query.p); });
      router.get("/b", (req, res) => { /* uploadedFileCandidates(p) */ const p = req.query.p; res.sendFile(p); });
      function viaPath(root, p) { isInsideDirectory(path.resolve(root, "uploads"), root); const t = path.resolve(p); fs.unlinkSync(t); }
      router.post("/c", (req, res) => { const p = req.body.p; if (!isInsideDirectory(dir, req.query.x)) return; fs.unlinkSync(p); });
      function fallback(p) { const t = uploadedFileCandidates(p)[0] ?? p; fs.unlinkSync(t); }
      function inlineFallback(p) { fs.unlinkSync(uploadedFileCandidates(p)[0] || p); }
    `;
    expect(scanFileAccesses("d.ts", text).map((s) => s.bounded)).toEqual([false, false, false, false, false, false]);
  });

  it("copie ou déplacement : la destination doit être bornée elle aussi", () => {
    const text = `
      function copyOut(p, dest) { const src = uploadedFileCandidates(p)[0]; fs.copyFileSync(src, dest); }
      function copyIn(p, q) { const src = uploadedFileCandidates(p)[0]; const dst = uploadedFileCandidates(q)[0]; fs.renameSync(src, dst); }
      function bothBranches(p, q) { fs.unlinkSync(uploadedFileCandidates(p)[0] ?? uploadedFileCandidates(q)[0]); }
    `;
    expect(scanFileAccesses("g.ts", text).map((s) => s.bounded)).toEqual([false, true, true]);
  });

  it("un rappel anonyme dans registerRoutes ne profite pas d'une borne de la fonction", () => {
    const text = `
      async function registerRoutes(app) {
        app.get("/x", (req, res) => { const f = uploadedFileCandidates(req.params.f)[0]; res.sendFile(f); });
        setInterval(() => { fs.unlinkSync(stored.path); }, 1000);
      }
    `;
    expect(scanFileAccesses("e.ts", text).map((s) => [fileAccessKey(s), s.bounded])).toEqual([
      ["e.ts:GET /x:sendFile", true],
      ["e.ts:registerRoutes:unlinkSync", false],
    ]);
  });

  it("détecte un appel disque importé sous un autre nom", () => {
    expect(renamedAccessImports("f.ts", `import { unlink as del, existsSync } from "fs";`)).toEqual(["f.ts:unlink as del"]);
    expect(renamedAccessImports("f.ts", `const { unlink: del, existsSync } = fs;`)).toEqual(["f.ts:unlink as del"]);
    expect(renamedAccessImports("f.ts", `const del = fs.unlinkSync; const ok = fs.existsSync;`)).toEqual(["f.ts:unlinkSync as del"]);
  });

  it("une borne hors de la portée ne compte pas", () => {
    const text = `
      function guard(p) { return isInsideDirectory("uploads", p); }
      function ko(p) { fs.rmSync(p); }
    `;
    expect(scanFileAccesses("b.ts", text).map((s) => s.bounded)).toEqual([false]);
  });

  it("garde : second argument seulement, avant l'accès, dans la même fonction", () => {
    const text = `
      function asDirectory(p) { if (!isInsideDirectory(p, "/tmp/x")) return; fs.rmSync(p); }
      function after(p) { fs.rmSync(p); if (!isInsideDirectory(path.join(process.cwd(), "uploads"), p)) throw new Error("x"); }
      function nested(p) { const check = () => isInsideDirectory(path.join(process.cwd(), "uploads"), p); fs.rmSync(p); }
      function before(p) { if (!isInsideDirectory(path.join(process.cwd(), "uploads"), p)) return; fs.rmSync(p); }
      const ROOT = "./uploads/documents";
      function viaConstant(p) { if (!isInsideDirectory(ROOT, p)) return; fs.rmSync(p); }
      function dirnameOfItself(p) { if (!isInsideDirectory(path.dirname(p), p)) return; fs.rmSync(p); }
      router.post("/d", (req, res) => { const p = req.body.p; if (!isInsideDirectory(req.body.dir, p)) return; fs.rmSync(p); });
      router.post("/e", (req, res) => { const p = req.body.p; if (!isInsideDirectory(path.join(req.body.dir, "uploads"), p)) return; fs.rmSync(p); });
      router.post("/f", (req, res) => { const p = req.body.p; if (!isInsideDirectory(path.resolve("uploads", req.body.dir), p)) return; fs.rmSync(p); });
      function dotDot(p) { if (!isInsideDirectory(path.join(process.cwd(), "uploads", ".."), p)) return; fs.rmSync(p); }
      function viaDirname(p) { if (!isInsideDirectory(path.join(__dirname, "..", "uploads"), p)) return; fs.rmSync(p); }
    `;
    expect(scanFileAccesses("h.ts", text).map((s) => [s.scope, s.bounded])).toEqual([
      ["asDirectory", false],
      ["after", false],
      ["nested", false],
      ["before", true],
      ["viaConstant", true],
      ["dirnameOfItself", false],
      ["POST /d", false],
      ["POST /e", false],
      ["POST /f", false],
      ["dotDot", false],
      ["viaDirname", true],
    ]);
  });

  it("méthode sur une valeur bornée : concat (ou toute méthode hors liste) perd la borne", () => {
    const text = `
      function concat(p, q) { const all = uploadedFileCandidates(p).concat([q]); fs.unlinkSync(all[1]); }
      function inlineConcat(p, q) { fs.unlinkSync(uploadedFileCandidates(p).concat(q)[0]); }
      function map(p, q) { fs.unlinkSync(uploadedFileCandidates(p).map(() => q)[0]); }
      function filtered(p) { fs.unlinkSync(uploadedFileCandidates(p).filter((c) => fs.existsSync(c))[0]); }
    `;
    expect(scanFileAccesses("i.ts", text).map((s) => s.bounded)).toEqual([false, false, false, true]);
  });

  it("alias : accès par crochets, bind, affectation ou passage en valeur", () => {
    expect(renamedAccessImports("j.ts", `const del = fs["unlinkSync"];`)).toEqual(["j.ts:unlinkSync as del"]);
    expect(renamedAccessImports("j.ts", `const del = fs.unlinkSync.bind(fs);`)).toEqual(["j.ts:unlinkSync as del"]);
    expect(renamedAccessImports("j.ts", `let del; del = fs.unlinkSync;`)).toEqual(["j.ts:unlinkSync as del"]);
    expect(renamedAccessImports("j.ts", `const del = promisify(fs.unlink);`)).toEqual(["j.ts:unlink as <valeur>"]);
    expect(renamedAccessImports("j.ts", `fs.unlinkSync(p); fs["rmSync"](p);`)).toEqual([]);
    expect(renamedAccessImports("j.ts", `const k = pick(); fs[k](p);`)).toEqual(["j.ts:fs[k]"]);
    expect(renamedAccessImports("j.ts", `fs.promises[method](p);`)).toEqual(["j.ts:fs.promises[method]"]);
    expect(renamedAccessImports("j.ts", `const x = items[i];`)).toEqual([]);
  });
});
