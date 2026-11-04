import bcrypt from "bcryptjs";
import { z } from "zod";
import { PIN_BCRYPT_COST } from "./pin-hash-migration";

/**
 * PIN chauffeur fourni à la création d'un compte : 4 chiffres, haché avant l'écriture
 * (users.pin n'accepte qu'un hash bcrypt, CHECK users_pin_bcrypt_check). Vide ou absent : NULL.
 */
export async function hashNewUserPin(pin: unknown): Promise<string | null> {
  if (pin === undefined || pin === null || String(pin).trim() === "") return null;
  if (!/^\d{4}$/.test(String(pin))) // ZodError : les routes de création le traduisent déjà en 400 « Données d'utilisateur invalides ».
    throw new z.ZodError([{ code: "custom", path: ["pin"], message: "Le PIN doit comporter exactement 4 chiffres." }]);
  return bcrypt.hash(String(pin), PIN_BCRYPT_COST);
}
