import { storage } from "../storage";

type User = Awaited<ReturnType<typeof storage.getUsersByRole>>[number];
type WarnLogger = { warn: (obj: object, msg: string) => void };

/**
 * Destinataires d'alerte par rôle, au mieux.
 *
 * Réservé aux notifications qui accompagnent une écriture : l'écriture est faite
 * ou va l'être, une lecture des destinataires en échec ne doit jamais la faire
 * échouer. Le rôle illisible est journalisé et ignoré ; les autres sont gardés.
 * Pour un écran qui affiche des utilisateurs, appeler `storage.getUsersByRole`
 * directement : l'erreur doit y remonter.
 */
export async function usersByRolesBestEffort(
  roles: readonly string[],
  log: WarnLogger,
  context: Record<string, unknown> = {},
): Promise<User[]> {
  const result: User[] = [];
  for (const role of roles) {
    try {
      result.push(...(await storage.getUsersByRole(role)));
    } catch (err) {
      log.warn({ err, ...context, role }, "destinataires d'alerte illisibles pour ce rôle, notification réduite");
    }
  }
  return result;
}
