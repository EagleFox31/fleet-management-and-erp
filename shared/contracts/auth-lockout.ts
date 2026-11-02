/**
 * Verrouillage de compte après échecs de connexion (P-03).
 *
 * Le compteur porte sur le nom d'utilisateur saisi, même inconnu : la réponse
 * ne révèle pas si un compte existe. Compte verrouillé : 429 `RATE_LIMITED`
 * avec l'heure de fin du verrou. Seuil et durée en configuration
 * (défaut D-06 : 5 échecs, 15 minutes).
 */
import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./common";

export const LOCKOUT_DEFAULTS = { maxAttempts: 5, lockMinutes: 15 } as const;

export type LockoutConfig = { maxAttempts: number; lockMinutes: number };

export const LOCKED_USERS_PATH = "/api/admin/users/locked";
export const unlockUserPath = (id: number) => `/api/admin/users/${id}/unlock`;
export const unlockUserParamsSchema = z.object({ id: idSchema });

/** Corps de la réponse 429 : le contrat d'erreur commun, plus `lockedUntil`. */
export const lockedResponseSchema = z.object({
  message: z.string(),
  code: z.literal("RATE_LIMITED"),
  requestId: z.string().optional(),
  lockedUntil: isoDateTimeSchema,
});

export const lockedUserSchema = z.object({
  id: z.number().int(),
  username: z.string(),
  name: z.string(),
  role: z.string(),
  failedLoginCount: z.number().int().min(0),
  lockedUntil: isoDateTimeSchema,
  lastFailedLoginAt: isoDateTimeSchema.nullable(),
});

export const lockedUsersResponseSchema = z.array(lockedUserSchema);

export const unlockUserResponseSchema = z.object({ id: z.number().int(), unlocked: z.literal(true) });

export type LockedResponse = z.infer<typeof lockedResponseSchema>;
export type LockedUser = z.infer<typeof lockedUserSchema>;
export type UnlockUserResponse = z.infer<typeof unlockUserResponseSchema>;
