/**
 * Routes d'écriture rejouables sans doublon (CDC #10, saisie hors ligne du technicien).
 *
 * Liste vide à ce stade : le garde `server/middleware/idempotency-guard.ts` ne fait rien
 * tant que le lot #10b ne la remplit pas. Une route s'ajoute ici, jamais dans le garde.
 */
export type IdempotencyRoute = {
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  /** Motif sur le chemin sans préfixe `/api`, par exemple `^/work-orders/\d+/time-entries$`. */
  pattern: RegExp;
};

/** En-tête portant la clé d'idempotence choisie par le client. */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";

export const IDEMPOTENCY_ROUTES: readonly IdempotencyRoute[] = [];
