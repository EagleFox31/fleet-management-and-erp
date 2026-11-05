import bcrypt from "bcryptjs";
import { PASSWORD_MIN_LENGTH } from "@shared/contracts/self-service";
import { randomPasswordHash } from "./dummy-hash";

/** Hash bcrypt complet : préfixe, coût sur 2 chiffres, 53 caractères de l'alphabet bcrypt (60 au total). */
export const BCRYPT_HASH_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
/** SHA-256 hérité, tel que l'écrit l'ancien code (digest hex minuscule) : le login le migre en bcrypt. */
export const LEGACY_SHA256_RE = /^[a-f0-9]{64}$/;

/**
 * Mot de passe d'une sauvegarde importée. Hash bcrypt ou SHA-256 hérité : repris tel quel.
 * Clair conforme (au moins PASSWORD_MIN_LENGTH caractères) : haché. Vide, absent, trop court ou
 * non textuel : hash aléatoire inutilisable (colonne NOT NULL), le compte passe par une
 * réinitialisation admin. `onInvalid` ne reçoit rien : ni la valeur, ni sa longueur.
 */
export async function passwordForRestore(password: unknown, onInvalid?: () => void): Promise<string> {
  if (typeof password === "string") {
    if (BCRYPT_HASH_RE.test(password) || LEGACY_SHA256_RE.test(password)) return password;
    if (password.length >= PASSWORD_MIN_LENGTH) return bcrypt.hash(password, 10);
  }
  onInvalid?.();
  return randomPasswordHash();
}
