/**
 * Nombre de sauts de proxy de confiance, pour `app.set("trust proxy", ...)`.
 *
 * `req.ip` (donc la limite d'essais par adresse) lit `X-Forwarded-For` jusqu'à ce nombre de sauts.
 * Il doit suivre la topologie de chaque profil de déploiement : un saut derrière Caddy (vps,
 * recette), aucun quand l'application est publiée sans proxy (site).
 *
 * `TRUST_PROXY` : entier >= 0 (`0` = aucun proxy de confiance). Absent, vide ou invalide : 1,
 * le comportement historique.
 */
import { moduleLogger } from "./logger";

const log = moduleLogger("trust-proxy");

export const DEFAULT_TRUST_PROXY_HOPS = 1;

export function trustProxyFromEnv(raw: string | undefined): number | false {
  const text = raw?.trim() ?? "";
  if (!/^\d{1,2}$/.test(text)) {
    // Valeur non secrète : une faute de frappe (« false », « off », liste CIDR) ne doit pas passer sous silence.
    if (text !== "") log.warn({ value: text.slice(0, 64) }, "TRUST_PROXY invalide (entier attendu, 0 = aucun proxy) : repli sur 1 saut");
    return DEFAULT_TRUST_PROXY_HOPS;
  }
  const hops = Number(text);
  return hops === 0 ? false : hops;
}
