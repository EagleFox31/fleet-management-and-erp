import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { deleteFile } from "../../../server/middleware/upload";

/**
 * Dette AGENTS.md §9 : `deleteFile` supprimait n'importe quel chemin. Un chemin lu en base
 * (`services/documentStorage.ts`, code mort) pouvait donc viser un fichier hors de `uploads/`.
 * Désormais : refus sans suppression, message sans le chemin.
 */

const root = mkdtempSync(path.join(tmpdir(), "fm-delete-file-"));
const inside = path.join(root, "uploads", "documents", "a.pdf");
const outside = path.join(root, "secret.txt");
const sibling = path.join(root, "uploads-x", "b.pdf");

mkdirSync(path.dirname(inside), { recursive: true });
mkdirSync(path.dirname(sibling), { recursive: true });

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("deleteFile : jamais hors de uploads/", () => {
  it("supprime un fichier sous uploads/ (chemin relatif stocké par multer)", async () => {
    writeFileSync(inside, "x");
    await deleteFile(path.join("uploads", "documents", "a.pdf"), root);
    expect(existsSync(inside)).toBe(false);
  });

  it.each([
    ["remontée relative", path.join("uploads", "..", "secret.txt")],
    ["chemin absolu hors racine", outside],
    ["dossier voisin au même préfixe", path.join("uploads-x", "b.pdf")],
    ["le dossier uploads lui-même", "uploads"],
    ["chaîne vide", ""],
  ])("refuse %s, sans rien supprimer ni exposer le chemin", async (_label, target) => {
    writeFileSync(outside, "x");
    writeFileSync(sibling, "x");
    const error = await deleteFile(target, root).then(() => null, (err: Error) => err);
    expect(error).toBeInstanceOf(Error);
    expect(error!.message).not.toContain(root);
    expect(error!.message).not.toContain("secret");
    expect(existsSync(outside)).toBe(true);
    expect(existsSync(sibling)).toBe(true);
  });
});
