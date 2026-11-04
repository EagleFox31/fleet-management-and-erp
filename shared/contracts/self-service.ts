import { z } from "zod";

/**
 * Corps des écritures en libre-service (l'utilisateur connecté agit sur ses propres données) :
 * onboarding et changement de mot de passe. Validés par `validateBody` sur les routes.
 */
export const onboardingStepRequestSchema = z.object({
  currentStep: z.number().int().min(0),
  stepsCompleted: z.array(z.string()),
});

export const onboardingMascotRequestSchema = z.object({
  mascotHidden: z.boolean(),
});

export const PASSWORD_MIN_LENGTH = 6;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string({ required_error: "Le mot de passe actuel est requis." }).min(1, "Le mot de passe actuel est requis."),
  newPassword: z
    .string({ required_error: "Le nouveau mot de passe est requis." })
    .min(PASSWORD_MIN_LENGTH, `Le nouveau mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`),
});
