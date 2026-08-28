/**
 * Source unique des groupes de rôles partagés entre le serveur et l'interface.
 *
 * Le projet a déjà payé cher la duplication des tables de vérité (libellés de
 * statut, permissions de sortie de stock). Un groupe de rôles recopié dans une
 * page finit toujours par diverger du middleware qui le contrôle: l'écran
 * affiche un bouton, l'API renvoie 403.
 *
 * Règle: si un groupe de rôles est lu des deux côtés, il vit ici.
 */

/**
 * Gestion des chauffeurs — création, modification, activation.
 *
 * La fiche chauffeur n'est pas un carnet d'adresses: c'est un dossier de
 * conformité (CNI, permis, formation CPC) qui décide si un homme peut prendre
 * la route. Trois métiers y touchent:
 * - `logistics`  affecte les chauffeurs aux missions, enregistre les arrivées;
 * - `secretary`  tient les papiers et les renouvellements;
 * - `admin`      en secours, plus le rattachement d'un compte de connexion.
 *
 * Doit rester aligné sur `isDriverManager` (server/middleware/auth.ts).
 */
export const DRIVER_MANAGER_ROLES = ["admin", "logistics", "secretary"] as const;

export type DriverManagerRole = (typeof DRIVER_MANAGER_ROLES)[number];

export function canManageDrivers(role: string | null | undefined): boolean {
  return DRIVER_MANAGER_ROLES.includes(String(role ?? "") as DriverManagerRole);
}
