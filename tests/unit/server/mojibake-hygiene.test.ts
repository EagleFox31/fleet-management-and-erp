import { describe, expect, it } from "vitest";
import { readRepoFile, repoFiles, REPO_SCAN_TIMEOUT_MS } from "../../support/repo-files";

/**
 * Garde-fou : aucune chaîne UTF-8 relue comme Latin-1 puis réenregistrée (« mojibake »)
 * dans le code source. Une telle chaîne arrive telle quelle à l'écran (« Mission non trouvÃ©e »).
 *
 * Signatures détectées :
 * - `Ã` ou `Â` suivi d'un caractère de U+0080 à U+00BF (é → « Ã© », espace insécable → « Â ») ;
 * - `â€` (apostrophe typographique, tirets, guillemets : « â€™ », « â€” ») ;
 * - U+FFFD, caractère de remplacement d'un octet illisible.
 *
 * `Â` suivi d'une lettre (« Âge ») est du français correct et n'est pas visé.
 * Un terminal Windows qui affiche un fichier UTF-8 en code page 1252 montre la même chose :
 * vérifier les octets du fichier (ce test) avant de « corriger » un affichage.
 */
const MOJIBAKE = /[\u00C3\u00C2][\u0080-\u00BF]|\u00E2\u20AC|\uFFFD/;

function findMojibake(source: string): string[] {
  return source
    .split("\n")
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => MOJIBAKE.test(line))
    .map(({ n }) => `l.${n}`);
}

describe("encodage : pas de mojibake dans le code source", { timeout: REPO_SCAN_TIMEOUT_MS }, () => {
  it("reconnaît les signatures et épargne le français correct", () => {
    expect(findMojibake("Mission non trouv\u00C3\u00A9e")).toEqual(["l.1"]);
    expect(findMojibake("l\u00E2\u20AC\u2122ordre")).toEqual(["l.1"]);
    expect(findMojibake("prix\u00C2\u00A0HT")).toEqual(["l.1"]);
    expect(findMojibake("\uFFFD")).toEqual(["l.1"]);
    expect(findMojibake("Âge estimé : « trouvée » — l’ordre")).toEqual([]);
  });

  it("aucun fichier de server/, shared/ ni client/src/ ne contient de mojibake", async () => {
    const offenders: string[] = [];
    for (const file of repoFiles({ under: ["server", "shared", "client/src"], match: /\.(ts|tsx)$/ })) {
      const hits = findMojibake(await readRepoFile(file));
      if (hits.length) offenders.push(`${file} ${hits.slice(0, 3).join(",")}`);
    }
    expect(offenders).toEqual([]);
  });
});
