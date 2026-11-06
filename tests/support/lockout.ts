import type { LockoutConfig } from "../../shared/contracts/auth-lockout";
import type { LockoutStore, LockState } from "../../server/services/login-lockout-service";

/**
 * Un echec de connexion tel que la garde le produit : reservation de la tentative, puis echec confirme.
 * Reservation refusee : la garde repond 429 sans verifier le secret, donc rien a confirmer.
 */
export async function failLogin(store: LockoutStore, username: string, now: Date, cfg: LockoutConfig): Promise<LockState> {
  const reservation = await store.reserve(username, now, cfg);
  if (!reservation.allowed) return reservation.state;
  return store.confirmFailure(username, now, cfg);
}
