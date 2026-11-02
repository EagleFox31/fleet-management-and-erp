import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { users, type User } from "@shared/schema";

/**
 * Relit le compte porté par une session.
 *
 * - Un compte supprimé (`deleted_at` renseigné) est filtré en SQL : il n'existe plus pour la session.
 * - Une erreur de base **remonte** à l'appelant. `storage.getUser` l'avalait et renvoyait
 *   `undefined`, si bien qu'une coupure de la base se lisait « compte inconnu » (401, déconnexion)
 *   au lieu d'une erreur serveur (500).
 */
export async function findActiveSessionUser(id: number): Promise<User | undefined> {
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .limit(1);
  return user;
}
