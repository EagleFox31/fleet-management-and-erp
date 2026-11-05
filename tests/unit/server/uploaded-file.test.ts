import fs from "fs";
import os from "os";
import { join, resolve } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isSafePathSegment, realPathStaysInside, uploadedFileCandidates } from "../../../server/lib/uploaded-file";

/**
 * Suppression d'un document de véhicule : le chemin vient de la base. On ne
 * supprime qu'un fichier situé sous `uploads/`, quelle que soit la forme stockée.
 */
const root = resolve("fleet-root");
const uploaded = (...parts: string[]) => join(root, "uploads", ...parts);

describe("uploadedFileCandidates", () => {
  it("chemin multer relatif : résolu sous uploads/", () => {
    expect(uploadedFileCandidates("uploads/documents/vehicle-1/a.pdf", root)).toEqual([uploaded("documents", "vehicle-1", "a.pdf")]);
  });

  it.runIf(process.platform === "win32")("chemin multer Windows (antislash) : résolu sous uploads/", () => {
    expect(uploadedFileCandidates("uploads\\documents\\vehicle-1\\a.pdf", root)).toContain(uploaded("documents", "vehicle-1", "a.pdf"));
  });

  it("ancien chemin « /uploads/... » : rattaché à la racine du projet", () => {
    expect(uploadedFileCandidates("/uploads/documents/vehicle-1/a.pdf", root)).toEqual([uploaded("documents", "vehicle-1", "a.pdf")]);
  });

  it("chemin absolu déjà sous uploads/ : conservé", () => {
    expect(uploadedFileCandidates(uploaded("a.pdf"), root)).toEqual([uploaded("a.pdf")]);
  });

  it.each([
    ["remontée hors de uploads/", "uploads/../.env"],
    ["fichier hors de uploads/", "server/index.ts"],
    ["absolu hors du projet", resolve("ailleurs", "secret.txt")],
    ["dossier uploads lui-même", "uploads"],
    ["préfixe trompeur", "uploads-old/a.pdf"],
  ])("%s : aucun candidat", (_label, storedPath) => {
    expect(uploadedFileCandidates(storedPath, root)).toEqual([]);
  });

  it.each([null, undefined, ""])("valeur vide (%s) : aucun candidat", (storedPath) => {
    expect(uploadedFileCandidates(storedPath, root)).toEqual([]);
  });
});

/**
 * Téléversement d'un document de workflow : l'identifiant de session et le type
 * de document viennent de la requête et deviennent des segments de chemin.
 */
describe("isSafePathSegment", () => {
  it.each(["acquisition-1730000000000-k3j9x2a1b", "carte_grise", "TEST-wf-abc"])("%s : accepté", (value) => {
    expect(isSafePathSegment(value)).toBe(true);
  });

  it.each([
    ["remontée", ".."],
    ["remontée encodée décodée par Express", "../../server"],
    ["séparateur Windows", "a\\b"],
    ["séparateur", "a/b"],
    ["vide", ""],
    ["trop long", "a".repeat(129)],
    ["non texte", 42],
  ])("%s : refusé", (_label, value) => {
    expect(isSafePathSegment(value)).toBe(false);
  });
});

/**
 * Lien symbolique ou jonction sous `uploads/` qui mène hors de `uploads/` : refusé, même si le
 * chemin stocké est lexicalement sous `uploads/`. Créer un lien de fichier demande un droit sous
 * Windows (mode développeur ou admin) : le cas est alors sauté avec sa raison ; la jonction de
 * dossier n'en demande pas et reste jouée partout.
 */
describe("uploadedFileCandidates : liens résolus", () => {
  let tmp = "";
  let uploads = "";
  let outside = "";
  let fileLink: string | null = null;

  beforeAll(() => {
    tmp = fs.mkdtempSync(join(os.tmpdir(), "fleet-realpath-"));
    uploads = join(tmp, "uploads");
    outside = join(tmp, "outside");
    fs.mkdirSync(join(uploads, "docs"), { recursive: true });
    fs.mkdirSync(outside);
    fs.writeFileSync(join(outside, "secret.txt"), "secret");
    fs.writeFileSync(join(uploads, "docs", "a.pdf"), "pdf");
    fs.symlinkSync(outside, join(uploads, "dir-link"), "junction");
    try {
      fs.symlinkSync(join(outside, "secret.txt"), join(uploads, "file-link.txt"), "file");
      fs.symlinkSync(join(uploads, "docs", "a.pdf"), join(uploads, "inner-link.pdf"), "file");
      fileLink = "ok";
    } catch (error) {
      fileLink = null;
      expect((error as NodeJS.ErrnoException).code).toMatch(/^(EPERM|EACCES)$/);
    }
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("fichier réel sous uploads/ : conservé", () => {
    expect(uploadedFileCandidates("/uploads/docs/a.pdf", tmp)).toEqual([join(uploads, "docs", "a.pdf")]);
  });

  it("jonction de dossier sous uploads/ qui mène dehors : refusée", () => {
    expect(uploadedFileCandidates("/uploads/dir-link/secret.txt", tmp)).toEqual([]);
  });

  it("lien de fichier sous uploads/ qui mène dehors : refusé", (ctx) => {
    if (!fileLink) ctx.skip("création de lien symbolique de fichier refusée par l'OS (droit absent)");
    expect(uploadedFileCandidates("/uploads/file-link.txt", tmp)).toEqual([]);
  });

  it("lien de fichier qui reste sous uploads/ : conservé", (ctx) => {
    if (!fileLink) ctx.skip("création de lien symbolique de fichier refusée par l'OS (droit absent)");
    expect(uploadedFileCandidates("/uploads/inner-link.pdf", tmp)).toEqual([join(uploads, "inner-link.pdf")]);
  });

  it("fichier absent : la comparaison lexicale suffit (rien à lire ni supprimer)", () => {
    expect(uploadedFileCandidates("/uploads/docs/absent.pdf", tmp)).toEqual([join(uploads, "docs", "absent.pdf")]);
  });

  it("fichier absent derrière une jonction qui mène dehors : refusé (une écriture sortirait)", () => {
    expect(uploadedFileCandidates("/uploads/dir-link/nouveau.pdf", tmp)).toEqual([]);
  });

  it("lien pendant sous uploads/ : refusé, lui comme ce qui serait écrit dessous", () => {
    const gone = join(tmp, "gone");
    fs.mkdirSync(gone);
    fs.symlinkSync(gone, join(uploads, "dangling"), "junction");
    fs.rmdirSync(gone);
    expect(uploadedFileCandidates("/uploads/dangling", tmp)).toEqual([]);
    expect(uploadedFileCandidates("/uploads/dangling/x.pdf", tmp)).toEqual([]);
  });

  it("uploads/ absent : la comparaison lexicale suffit", () => {
    const fresh = join(tmp, "fresh");
    fs.mkdirSync(fresh);
    expect(uploadedFileCandidates("/uploads/docs/a.pdf", fresh)).toEqual([join(fresh, "uploads", "docs", "a.pdf")]);
  });

  it("uploads/ lui-même monté par jonction : ses fichiers restent valides", () => {
    const mounted = join(tmp, "mounted");
    fs.mkdirSync(mounted);
    fs.symlinkSync(uploads, join(mounted, "uploads"), "junction");
    expect(realPathStaysInside(join(mounted, "uploads"), join(mounted, "uploads", "docs", "a.pdf"))).toBe(true);
    expect(realPathStaysInside(join(mounted, "uploads"), join(mounted, "uploads", "dir-link", "secret.txt"))).toBe(false);
    // Par l'entrée publique, racine du projet `mounted` : réel conservé, jonction sortante et absent derrière elle refusés.
    expect(uploadedFileCandidates("/uploads/docs/a.pdf", mounted)).toEqual([join(mounted, "uploads", "docs", "a.pdf")]);
    expect(uploadedFileCandidates("/uploads/docs/absent.pdf", mounted)).toEqual([join(mounted, "uploads", "docs", "absent.pdf")]);
    expect(uploadedFileCandidates("/uploads/dir-link/secret.txt", mounted)).toEqual([]);
    expect(uploadedFileCandidates("/uploads/dir-link/nouveau.pdf", mounted)).toEqual([]);
  });
});
