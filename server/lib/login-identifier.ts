import { createHmac } from "crypto";
import { moduleLogger } from "./logger";
import { resolveSessionSecret } from "./session-secret";

/**
 * Empreinte d'un identifiant de connexion (nom saisi), pour les compteurs d'échecs, l'audit et les logs.
 * Aucun nom saisi n'est stocké ni journalisé en clair : un nom inconnu peut être un mot de passe tapé
 * dans le mauvais champ.
 *
 * HMAC-SHA256 sous une sous-clé dérivée du secret de session (séparation des domaines : le secret brut
 * ne sert qu'à signer les cookies). `LOGIN_IDENTIFIER_DOMAIN` porte la version : changer de domaine ou
 * de secret remet les compteurs à zéro, ce qui est accepté (un verrou dure 15 minutes).
 */
export const LOGIN_IDENTIFIER_DOMAIN = "fleet:login-identifier:v1";

/** Préfixe des clés de compteur par empreinte (`login_attempts_by_username.username_normalized`). */
export const PASSWORD_DIGEST_KEY_PREFIX = "pwdh1:";

let subkey: Buffer | null = null;

function loginIdentifierKey(): Buffer {
  if (!subkey) {
    const secret = resolveSessionSecret(process.env, (message) => moduleLogger("login-identifier").warn(message));
    subkey = createHmac("sha256", secret).update(LOGIN_IDENTIFIER_DOMAIN).digest();
  }
  return subkey;
}

/** Même normalisation que le garde de verrouillage : rogné, en minuscules. */
export function normalizeLoginIdentifier(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}

/** Empreinte hexadécimale (64 caractères) du nom normalisé. */
export function loginIdentifierDigest(raw: unknown): string {
  return createHmac("sha256", loginIdentifierKey()).update(normalizeLoginIdentifier(raw)).digest("hex");
}

/** Référence courte pour les logs : relie les lignes d'une même tentative sans révéler le nom. */
export function loginUsernameRef(raw: unknown): string {
  return loginIdentifierDigest(raw).slice(0, 12);
}
