import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";
import { describe, expect, it } from "vitest";
import { fileAccessKey, LINK_RESOLVING_BOUND_CALLS, scanFileAccesses } from "../../support/file-access-scan";

/**
 * AGENTS.md §9 : une route de `server/api` ne supprime un fichier téléversé que par une borne qui
 * résout aussi les liens (`uploadedFileCandidates`, `settlementProofPath`, `existingUploadedFile`).
 * `isInsideDirectory` seul est lexical : un lien sous `uploads/` qui mène dehors le passe, et la
 * suppression suivrait le lien. `stored-path-hygiene` accepte cette borne pour tout `server/` ;
 * cette garde est plus stricte pour les suppressions des routes.
 *
 * Liste gelée et stricte : chaque entrée donne sa raison et la condition pour la dégeler.
 */
const DELETE_CALLS = new Set(["unlink", "unlinkSync", "rm", "rmSync", "rmdir", "rmdirSync"]);

const DELETE_FROZEN: Record<string, { reason: string; unfreezeWhen: string }> = {
  "server/api/document-renewals.routes.ts:removeUploadedProof:unlinkSync": {
    reason: "req.file.path, chemin écrit par multer dans le dossier des preuves de la requête en cours, jamais lu en base",
    unfreezeWhen: "la suppression passe par une borne qui résout les liens sur le dossier des preuves (uploadedFileCandidates ou équivalent)",
  },
};

const root = process.cwd();
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|js|mjs|cjs)$/.test(name) ? [full] : [];
  });

const deletions = walk(join(root, "server", "api"))
  .map((full) => relative(root, full).split(sep).join("/"))
  .flatMap((file) => scanFileAccesses(file, readFileSync(join(root, file), "utf8"), LINK_RESOLVING_BOUND_CALLS))
  .filter((site) => DELETE_CALLS.has(site.call));

describe("suppression de fichier dans server/api : borne qui résout les liens (AGENTS.md §9)", () => {
  it("le scan voit les suppressions connues (il n'est pas aveugle)", () => {
    const bounded = new Set(deletions.filter((s) => s.bounded).map(fileAccessKey));
    expect(bounded).toContain("server/api/document-renewals.routes.ts:removeUploadedFile:unlink");
    expect(bounded).toContain("server/api/supplier-invoices.routes.ts:removeUploadedProof:unlinkSync");
  });

  it("toute suppression non bornée par une borne qui résout les liens figure dans la liste gelée", () => {
    const offenders = deletions.filter((s) => !s.bounded && !(fileAccessKey(s) in DELETE_FROZEN));
    expect(offenders.map((s) => `${fileAccessKey(s)} (ligne ${s.line})`)).toEqual([]);
  });

  it("liste gelée sans entrée morte, chaque entrée justifiée avec sa condition de dégel", () => {
    const live = new Set(deletions.filter((s) => !s.bounded).map(fileAccessKey));
    expect(Object.keys(DELETE_FROZEN).filter((key) => !live.has(key))).toEqual([]);
    for (const [key, { reason, unfreezeWhen }] of Object.entries(DELETE_FROZEN)) {
      expect(reason.length, key).toBeGreaterThan(20);
      expect(unfreezeWhen.length, key).toBeGreaterThan(20);
    }
  });

  it("isInsideDirectory seul ne suffit pas ; les bornes qui résolvent les liens suffisent", () => {
    const sample = `
      function lexical(p) { if (!isInsideDirectory(path.join(process.cwd(), "uploads"), p)) return; fs.unlinkSync(p); }
      function candidates(p) { for (const c of uploadedFileCandidates(p)) fs.unlink(c, () => {}); }
      function proof(r) { const f = settlementProofPath(r); if (f) fs.rmSync(f); }
    `;
    const strict = Object.fromEntries(scanFileAccesses("s.ts", sample, LINK_RESOLVING_BOUND_CALLS).map((s) => [fileAccessKey(s), s.bounded]));
    expect(strict).toEqual({ "s.ts:lexical:unlinkSync": false, "s.ts:candidates:unlink": true, "s.ts:proof:rmSync": true });
    // Le mode par défaut (stored-path-hygiene) accepte toujours la borne lexicale.
    const loose = scanFileAccesses("s.ts", sample).find((s) => s.scope === "lexical");
    expect(loose?.bounded).toBe(true);
  });
});
