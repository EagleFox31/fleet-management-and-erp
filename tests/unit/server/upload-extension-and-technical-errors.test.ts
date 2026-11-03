import { describe, expect, it } from "vitest";
import { looksTechnical } from "../../../shared/errors";
import { isAllowedUpload } from "../../../server/middleware/upload";

/** P3-2 lot 2b, M2 et M3 : erreurs disque jamais affichées, extension confrontée au MIME. */
describe("M2 : looksTechnical reconnaît les codes d'erreur disque", () => {
  it.each(["EACCES: permission denied, mkdir '/app/uploads'", "ENOSPC: no space left on device", "EPERM: operation not permitted"])(
    "%s est technique",
    (text) => {
      expect(looksTechnical(text)).toBe(true);
    },
  );

  it("une phrase utilisateur ne l'est pas", () => {
    expect(looksTechnical("Le fichier dépasse la taille maximale autorisée.")).toBe(false);
  });
});

describe("M3 : l'extension doit correspondre au MIME déclaré", () => {
  it.each([
    ["application/pdf", "carte.pdf"],
    ["application/pdf", "CARTE.PDF"],
    ["image/jpeg", "photo.jpg"],
    ["image/jpeg", "photo.jpeg"],
    ["image/png", "scan.png"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "lettre.docx"],
    ["application/vnd.ms-excel", "tableau.xls"],
  ])("%s + %s : accepté", (mime, name) => {
    expect(isAllowedUpload(mime, name)).toBe(true);
  });

  it.each([
    ["application/pdf", "script.exe"],
    ["application/pdf", "page.html"],
    ["image/png", "photo.jpg"],
    ["application/pdf", "sans-extension"],
    ["text/plain", "note.txt"],
  ])("%s + %s : refusé", (mime, name) => {
    expect(isAllowedUpload(mime, name)).toBe(false);
  });
});
