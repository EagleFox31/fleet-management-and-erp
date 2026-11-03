/**
 * Portée des événements temps réel (WebSocket) : qui reçoit quoi.
 *
 * Module pur, sans socket ni état : `server/index.ts` lui passe la portée demandée et un index
 * des connexions, il rend les destinataires.
 */

export type WsScope =
  | { type: "broadcast" }
  | { type: "user"; userIds: number[] }
  | { type: "roles"; roles: string[] };

/** Index des connexions actives, générique en `S` (un `WebSocket` en production). */
export interface ConnectionIndex<S> {
  byUser: ReadonlyMap<number, ReadonlySet<S>>;
  /** Clés en minuscules, comme dans `server/index.ts`. */
  byRole: ReadonlyMap<string, ReadonlySet<S>>;
}

const toPositiveInteger = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;

/**
 * Règle : fermé par défaut. Seule une portée valide désigne des destinataires ; une portée
 * absente, vide ou invalide rend `null` et l'événement ne part à personne. Le broadcast n'existe
 * que s'il est demandé (`{ type: "broadcast" }`).
 *
 * `targetUserId` (3e argument historique de `broadcastUpdate`) ne vaut que si aucune portée
 * n'est fournie ; une portée fournie mais invalide ne retombe jamais dessus.
 */
export function normalizeScope(scopeCandidate: unknown, targetUserId: number | null): WsScope | null {
  if (scopeCandidate === undefined || scopeCandidate === null) {
    const target = toPositiveInteger(targetUserId);
    return target ? { type: "user", userIds: [target] } : null;
  }

  if (typeof scopeCandidate !== "object" || Array.isArray(scopeCandidate)) {
    return null;
  }

  const scopeRecord = scopeCandidate as Record<string, unknown>;

  if (scopeRecord.type === "broadcast") {
    return { type: "broadcast" };
  }

  if (scopeRecord.type === "user" && Array.isArray(scopeRecord.userIds)) {
    const userIds = scopeRecord.userIds
      .map((candidate) => toPositiveInteger(candidate))
      .filter((candidate): candidate is number => candidate !== null);
    return userIds.length > 0 ? { type: "user", userIds } : null;
  }

  if (scopeRecord.type === "roles" && Array.isArray(scopeRecord.roles)) {
    const roles = scopeRecord.roles
      .filter((candidate): candidate is string => typeof candidate === "string")
      .map((candidate) => candidate.trim().toLowerCase())
      .filter((candidate) => candidate.length > 0);
    return roles.length > 0 ? { type: "roles", roles } : null;
  }

  return null;
}

/** Forme de la portée refusée, pour le journal : jamais les identifiants ni les rôles eux-mêmes. */
export function describeInvalidScope(scopeCandidate: unknown): string {
  if (scopeCandidate === undefined || scopeCandidate === null) return "absente";
  if (typeof scopeCandidate !== "object" || Array.isArray(scopeCandidate)) return "forme inattendue";
  const type = (scopeCandidate as Record<string, unknown>).type;
  return typeof type === "string" && ["user", "roles"].includes(type) ? `${type} sans cible valide` : "type inconnu";
}

export function resolveRecipients<S>(scope: WsScope | null, index: ConnectionIndex<S>): Set<S> {
  const recipients = new Set<S>();
  if (!scope) return recipients;
  if (scope.type === "broadcast") {
    index.byUser.forEach((sockets) => sockets.forEach((s) => recipients.add(s)));
  } else if (scope.type === "user") {
    scope.userIds.forEach((id) => index.byUser.get(id)?.forEach((s) => recipients.add(s)));
  } else if (scope.type === "roles") {
    scope.roles.forEach((role) => index.byRole.get(role.trim().toLowerCase())?.forEach((s) => recipients.add(s)));
  }
  return recipients;
}
