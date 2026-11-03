/**
 * Couche 2 (temps réel) d'une alerte écrite en base : trame `alert_created`.
 *
 * Forme de la charge : à plat (`alertId`, `title`, `message`, `priority`, `link`…), comme
 * `alert-service` et les missions, car c'est ce que lit `useRealTimeSync` pour le toast,
 * la notification native et son lien.
 *
 * Portée : nominative (`user`). Une alerte sans destinataire ne part jamais en broadcast
 * (AGENTS.md §11) : elle va aux `fallbackRoles` fournis, ou nulle part s'il n'y en a pas.
 *
 * À appeler après le commit de l'alerte, au mieux (l'appelant garde son try/catch).
 * Sans serveur WebSocket (`global.broadcastUpdate` absent, scripts), ne fait rien.
 */
export type BroadcastableAlert = {
  id: number;
  userId: number | null;
  title: string;
  message: string;
  type: string;
  priority: string | null;
  link: string | null;
};

export function broadcastAlertCreated(alert: BroadcastableAlert, fallbackRoles: readonly string[] = []): void {
  const broadcastUpdate = (global as any).broadcastUpdate;
  if (typeof broadcastUpdate !== "function") return;

  const scope = alert.userId
    ? { type: "user", userIds: [alert.userId] }
    : fallbackRoles.length > 0
      ? { type: "roles", roles: [...fallbackRoles] }
      : null;
  if (!scope) return;

  broadcastUpdate("alert_created", {
    version: 1,
    entity: "alert",
    entityId: alert.id,
    payload: {
      alertId: alert.id,
      userId: alert.userId,
      title: alert.title,
      message: alert.message,
      type: alert.type,
      priority: alert.priority,
      link: alert.link,
    },
    scope,
    emittedAt: new Date().toISOString(),
  });
}
