import { z } from "zod";

/**
 * Corps de POST /api/auth/login : chaînes non vides et bornées. Validé avant le compteur d'essais
 * (server/api/index.ts) et avant la recherche du compte (server/routes.ts) : un corps invalide ne
 * crée aucune ligne de compteur et reçoit la même réponse 400 pour un compte connu et inconnu.
 */
export const loginRequestSchema = z.object({
  username: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(1024),
  rememberMe: z.unknown().optional(),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** Message du 400 d'un corps de connexion invalide, identique sur les deux points de validation. */
export const LOGIN_BODY_INVALID_MESSAGE = "Nom d'utilisateur et mot de passe requis";
