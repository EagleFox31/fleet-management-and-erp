import { z } from "zod";

/**
 * Corps de POST /api/auth/pin-login. Validé avant toute recherche de compte : un type inattendu
 * reçoit la même réponse 400 pour un compte connu et inconnu (aucun canal d'énumération).
 * `userId` accepte un entier ou sa forme en chaîne, `pin` une chaîne ou un entier, comme avant
 * la validation (le serveur appliquait `Number(userId)` et `String(pin)`).
 */
export const pinLoginRequestSchema = z.object({
  userId: z.union([
    z.number().int().positive().max(2147483647), // borne de la colonne integer : au-delà, 400 et non 500
    z.string().trim().regex(/^[1-9]\d{0,8}$/, "Identifiant du chauffeur invalide."),
  ]),
  pin: z.union([z.string().min(1, "PIN requis.").max(64), z.number().int().nonnegative()]),
});

export type PinLoginRequest = z.infer<typeof pinLoginRequestSchema>;
