import { toast } from "@/hooks/use-toast";

/**
 * Signale qu'une action existe dans l'interface mais n'est pas encore active.
 *
 * Une action qui ne fait **rien** au clic est le pire cas: l'utilisateur croit
 * avoir raté quelque chose et recommence. Mieux vaut afficher explicitement que
 * la fonctionnalité arrive.
 *
 * À n'utiliser que pour du développement en attente. Pour une action refusée par
 * les droits, ne pas afficher le bouton du tout — proposer puis refuser est plus
 * frustrant que ne pas proposer (voir AGENTS.md).
 *
 * @param fonctionnalite Nom métier de l'action, tel que l'utilisateur la voit.
 *                       Exemple: "La commande de pneus", "L'édition des utilisateurs".
 * @param precision      Détail optionnel: ce qu'il faut faire en attendant.
 */
export function notifyComingSoon(fonctionnalite: string, precision?: string): void {
  toast({
    title: "Fonctionnalité à venir",
    description: precision
      ? `${fonctionnalite} n'est pas encore disponible. ${precision}`
      : `${fonctionnalite} n'est pas encore disponible.`,
  });
}
