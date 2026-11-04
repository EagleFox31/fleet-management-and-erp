import bcrypt from "bcryptjs";
import crypto from "crypto";

/**
 * Hash bcrypt (cout 10, comme les comptes) d'un secret aleatoire que personne ne connait.
 * Compare quand il n'y a pas de hash reel a verifier : la reponse prend le meme temps
 * qu'avec un compte existant, la latence ne distingue pas les cas d'echec.
 */
const DUMMY_BCRYPT_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString("hex"), 10);

/** Depense le temps d'une comparaison bcrypt ; le resultat est toujours faux et ignore. */
export async function burnBcryptTime(secret: string): Promise<void> {
  await bcrypt.compare(secret, DUMMY_BCRYPT_HASH);
}

/** Mot de passe aleatoire fort, hache : jamais communique ni journalise. */
export async function randomPasswordHash(): Promise<string> {
  return bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
}
