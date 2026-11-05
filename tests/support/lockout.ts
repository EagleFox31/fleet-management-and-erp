import type { LockoutConfig, LockoutStore, LockState } from "../../server/services/login-lockout-service";

/** Un echec de connexion tel que la garde le produit : reservation de la tentative, puis echec confirme. */
export async function failLogin(store: LockoutStore, username: string, now: Date, cfg: LockoutConfig): Promise<LockState> {
  await store.reserve(username, now, cfg);
  return store.confirmFailure(username, now, cfg);
}
