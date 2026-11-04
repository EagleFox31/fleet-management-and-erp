import { test } from "@playwright/test";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../server/db";
import { users, vehicles } from "../../shared/schema";
import type { E2ECredentials } from "./auth";

/**
 * Comptes de recette (`scripts/recette-seed.ts`) pour les specs de profil.
 *
 * Le mot de passe vient de `RECETTE_PASSWORD_<ROLE>` ou de `RECETTE_PASSWORD`, comme au seed. Il n'est jamais
 * écrit dans le dépôt ni dans un message de test. Sans lui, la spec est sautée avec une raison explicite.
 */

export type RecetteAccount = E2ECredentials & { id: number; role: string };

function recettePassword(role: string): string | undefined {
  return process.env[`RECETTE_PASSWORD_${role.toUpperCase()}`] ?? process.env.RECETTE_PASSWORD;
}

/** Saute le fichier de spec si le mot de passe de recette n'est pas fourni. */
export function requireRecettePassword(...roles: string[]): void {
  const missing = roles.filter((role) => !recettePassword(role));
  test.skip(
    missing.length > 0,
    `Mot de passe de recette absent (RECETTE_PASSWORD) pour : ${missing.join(", ")}. Lancer avec le .env de la base de recette.`,
  );
}

/** Charge un compte de recette existant en base. Lève une erreur lisible s'il manque ou n'a pas le rôle attendu. */
export async function recetteAccount(username: string, role: string, label: string): Promise<RecetteAccount> {
  const [row] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.username, username));
  if (!row) throw new Error(`Compte de recette ${username} absent : lancer scripts/recette-seed.ts sur cette base.`);
  if (row.role !== role) throw new Error(`Compte de recette ${username} : rôle ${row.role}, ${role} attendu.`);
  return { id: row.id, role, username, password: recettePassword(role) ?? "", label };
}

/** Véhicules actifs dont le client est propriétaire (`vehicles.ownerId`). */
export async function vehiclesOwnedBy(ownerId: number): Promise<{ id: number; registrationNumber: string }[]> {
  return db
    .select({ id: vehicles.id, registrationNumber: vehicles.registrationNumber })
    .from(vehicles)
    .where(and(eq(vehicles.ownerId, ownerId), isNull(vehicles.deletedAt)));
}
