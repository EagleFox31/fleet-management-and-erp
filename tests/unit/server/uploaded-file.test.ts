import { join, resolve } from "path";
import { describe, expect, it } from "vitest";
import { uploadedFileCandidates } from "../../../server/lib/uploaded-file";

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
