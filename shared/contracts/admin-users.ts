import { z } from "zod";

/** Corps de PATCH /api/admin/users/:id/toggle : `isActive` booléen obligatoire (vrai = réactiver). */
export const toggleUserRequestSchema = z.object({
  isActive: z.boolean({ required_error: "Indiquez si le compte doit être actif.", invalid_type_error: "Indiquez si le compte doit être actif." }),
});

export type ToggleUserRequest = z.infer<typeof toggleUserRequestSchema>;
