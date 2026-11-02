import {
  PART_ID_MAX,
  PART_SCAN_CODE_MAX_LENGTH,
  PART_SCAN_CODE_VERSION,
  PART_SCAN_QUERY_KEY,
  PART_SCAN_SCREEN_PATH,
} from "@shared/contracts/part-scans";

/**
 * Charge utile et lecture des codes de pièces (CDC-3). Fonctions pures, sans base ni horloge.
 *
 * Charge utile d'une étiquette : `/inventory/scan?c=FM1:<partId>`.
 * - URL relative : aucun hôte codé en dur ; le client peut la préfixer de son origine ;
 * - `FM1` : format FleetMaster, version 1 ; un changement de forme créera `FM2`, et les
 *   étiquettes déjà collées continueront d'être lues par leur version ;
 * - rien d'autre que l'identifiant : ni prix, ni fournisseur, ni stock.
 *
 * Lecture : une liste de formats, essayés dans l'ordre. Ajouter un format (EAN fabricant, par
 * exemple) = écrire un `ScanCodeFormat`, l'ajouter à `SCAN_CODE_FORMATS` et lui donner sa
 * recherche dans `server/services/part-scans-service.ts` : aucune ligne existante ne change.
 */

/** Code reconnu. Une union par format : le service n'a qu'à ajouter une recherche par nouvelle variante. */
export type ScannedCode =
  | { format: "fleetmaster"; version: number; partId: number }
  | { format: "reference"; reference: string };

export interface ScanCodeFormat {
  readonly id: ScannedCode["format"];
  /** `null` si le texte n'est pas de ce format. Ne lève jamais. */
  parse(raw: string): ScannedCode | null;
}

/** Contenu du QR d'une pièce. */
export function buildPartScanPayload(partId: number): string {
  if (!Number.isSafeInteger(partId) || partId < 1 || partId > PART_ID_MAX) {
    throw new RangeError("Identifiant de pièce hors bornes.");
  }
  return `${PART_SCAN_SCREEN_PATH}?${PART_SCAN_QUERY_KEY}=FM${PART_SCAN_CODE_VERSION}:${partId}`;
}

const FLEETMASTER_TOKEN = /^FM(\d{1,3})\s*:\s*(\d{1,10})$/i;
/** Forme canonique : pas de zéro en tête, pour qu'une pièce n'ait qu'un seul code. */
const CANONICAL_ID = /^[1-9]\d{0,9}$/;
const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//i;
/** Début d'une charge utile FleetMaster, de n'importe quelle version : jamais lu comme une référence. */
const RESERVED_PREFIX = /^FM\d+\s*:/i;
/** Caractères de contrôle (Cc), séparateurs de ligne (Zl) et de paragraphe (Zp) Unicode. */
const CONTROL_CHARS = /[\p{Cc}\p{Zl}\p{Zp}]/u;

/** Longueur maximale d'une référence interne lue sur un code. */
const REFERENCE_MAX_LENGTH = 100;

/**
 * Valeur de la clé `c` d'une URL de scan, ou `null`. Accepte une URL relative, absolue ou sans
 * protocole, de n'importe quel hôte, y compris derrière un préfixe de chemin
 * (`https://exemple.test/app/inventory/scan?c=FM1:12`). Refuse tout autre protocole que http(s),
 * toute autre page, et une clé répétée.
 */
function tokenFromUrl(text: string): string | null {
  if (!text.startsWith("/") && !ABSOLUTE_URL.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text, "http://hote.invalide");
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const path = url.pathname.replace(/\/+$/, "").toLowerCase();
  if (!path.endsWith(PART_SCAN_SCREEN_PATH)) return null;
  const values: string[] = [];
  url.searchParams.forEach((value, key) => {
    if (key.toLowerCase() === PART_SCAN_QUERY_KEY) values.push(value);
  });
  return values.length === 1 ? values[0] : null;
}

/** Format FleetMaster : `FM1:12`, ou l'URL du scan qui le porte. Tolère espaces, casse, chiffres pleine chasse. */
export const fleetmasterFormat: ScanCodeFormat = {
  id: "fleetmaster",
  parse(raw) {
    const text = raw.trim();
    const token = (tokenFromUrl(text) ?? text).normalize("NFKC").trim();
    const match = FLEETMASTER_TOKEN.exec(token);
    if (!match) return null;
    const version = Number(match[1]);
    if (version !== PART_SCAN_CODE_VERSION) return null;
    if (!CANONICAL_ID.test(match[2])) return null;
    const partId = Number(match[2]);
    if (!Number.isSafeInteger(partId) || partId > PART_ID_MAX) return null;
    return { format: "fleetmaster", version, partId };
  },
};

/**
 * Référence interne saisie ou scannée telle quelle (code-barres du magasin). Dernier recours :
 * refuse les URL, les charges utiles FleetMaster d'une version inconnue et les caractères de contrôle.
 */
export const referenceFormat: ScanCodeFormat = {
  id: "reference",
  parse(raw) {
    const reference = raw.trim();
    if (reference.length === 0 || reference.length > REFERENCE_MAX_LENGTH) return null;
    if (CONTROL_CHARS.test(reference)) return null;
    if (reference.startsWith("/") || reference.includes("://") || RESERVED_PREFIX.test(reference.normalize("NFKC"))) return null;
    return { format: "reference", reference };
  },
};

/** Ordre d'essai. Les formats précis passent avant la référence libre. */
export const SCAN_CODE_FORMATS: readonly ScanCodeFormat[] = [fleetmasterFormat, referenceFormat];

/** Code reconnu, ou `null` : texte vide, trop long, URL étrangère, version inconnue. Ne lève jamais. */
export function parseScanCode(raw: unknown, formats: readonly ScanCodeFormat[] = SCAN_CODE_FORMATS): ScannedCode | null {
  if (typeof raw !== "string" || raw.length > PART_SCAN_CODE_MAX_LENGTH * 2) return null;
  for (const format of formats) {
    const code = format.parse(raw);
    if (code) return code;
  }
  return null;
}
