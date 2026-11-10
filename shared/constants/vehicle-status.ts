/**
 * Libellés français des statuts véhicule — source unique serveur + client.
 *
 * Le serveur en a besoin pour écrire l'historique de statut en clair : une
 * ligne « Statut changé de operational à maintenance » est illisible pour un
 * chef d'atelier, et c'est pourtant ce que voit l'utilisateur final.
 *
 * `client/src/lib/utils.ts` (`translateStatus`) délègue ici pour ces trois
 * clés — ne pas recopier la table, le projet a déjà payé cher la duplication
 * des libellés de statut de demande de pièce.
 */
export const VEHICLE_STATUS_LABELS = {
  operational: "Opérationnel",
  maintenance: "En maintenance",
  out_of_service: "Hors service",
} as const;

export type VehicleStatusKey = keyof typeof VEHICLE_STATUS_LABELS;

export function getVehicleStatusLabel(status: string | null | undefined): string {
  if (!status) return "Inconnu";
  return VEHICLE_STATUS_LABELS[status as VehicleStatusKey] ?? status;
}

/**
 * Origine d'un changement de statut véhicule.
 *
 * Sans elle, l'historique disait « Statut changé automatiquement » aussi bien
 * pour une décision humaine que pour un traitement — le mot « automatiquement »
 * étant même faux dans le premier cas. Or les deux n'appellent pas la même
 * lecture : un véhicule immobilisé par le planificateur n'a encore mobilisé
 * personne, un véhicule déclaré en panne par le chef d'atelier si.
 */
export type StatusChangeOrigin = "manual" | "work_order" | "preventive" | "system";

const ORIGIN_LABELS: Record<StatusChangeOrigin, string> = {
  manual: "Déclaré manuellement",
  work_order: "Suite à un ordre de travail",
  preventive: "Déclenché par la maintenance préventive",
  system: "Changement système",
};

/**
 * Phrase par défaut d'un changement de statut, en français et sans mentir sur
 * l'origine. Les appelants qui ont mieux à dire (numéro d'OT, motif saisi)
 * passent leur propre texte.
 */
export function describeStatusChange(
  origin: StatusChangeOrigin,
  newStatus: string,
  oldStatus?: string | null,
): string {
  const vers = getVehicleStatusLabel(newStatus);
  const depuis = oldStatus ? getVehicleStatusLabel(oldStatus) : null;
  const transition = depuis ? `${depuis} → ${vers}` : vers;
  return `${ORIGIN_LABELS[origin]} : ${transition}`;
}

/**
 * Statuts d'un vehicule retire de l'exploitation (vendu, reforme : le schema n'a qu'un statut,
 * `out_of_service`). Les controles automatiques d'echeance (preventif par date) l'ecartent : un
 * vehicule qui ne roule plus n'a pas d'atelier a planifier.
 */
export const VEHICLE_OUT_OF_SERVICE_STATUSES: readonly VehicleStatusKey[] = ["out_of_service"];
