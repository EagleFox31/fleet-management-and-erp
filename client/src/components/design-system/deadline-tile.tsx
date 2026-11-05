import * as React from "react";
import { AlertTriangle, AlertCircle } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { daysUntilDeadline, statusFromDeadline, type KpiStatus } from "@/lib/kpi-status";

/**
 * Nature de l'échéance — pilote le vocabulaire affiché.
 * `document`: papier qui expire (assurance, visite technique, CPC).
 * `action`:   intervention à réaliser (entretien, inspection, rotation).
 */
export type DeadlineKind = "document" | "action";

interface DeadlineTileProps {
  label: string;
  /** Date d'échéance. `null`/absente ⇒ état neutre, pas d'alerte. */
  date: string | Date | null | undefined;
  /** Icône affichée quand l'échéance est encore lointaine. */
  icon: React.ReactNode;
  kind?: DeadlineKind;
  /** Seuil d'alerte en jours. Par défaut 30, aligné sur `alert-service.ts`. */
  warningWithinDays?: number;
  /** Texte affiché quand aucune date n'est renseignée. */
  emptyLabel?: string;
  /** Rend la tuile cliquable: curseur, survol et accessibilité au clavier. */
  onClick?: () => void;
  className?: string;
  "data-testid"?: string;
}

/** Habillage par état. Une seule source pour les quatre cas. */
const STYLES: Record<KpiStatus, { tile: string; iconWrap: string; icon: string; value: string }> = {
  critical: {
    tile: "border-destructive/30 bg-destructive/10",
    iconWrap: "bg-destructive/15",
    icon: "text-destructive-text",
    value: "text-destructive-text",
  },
  warning: {
    tile: "border-warning/40 bg-warning/10",
    iconWrap: "bg-warning/20",
    icon: "text-warning-text",
    value: "text-warning-text",
  },
  success: {
    tile: "border-gray-100 bg-gray-50",
    iconWrap: "bg-success/10",
    icon: "text-success",
    value: "text-gray-800",
  },
  neutral: {
    tile: "border-gray-100 bg-gray-50",
    iconWrap: "bg-gray-100",
    icon: "text-gray-400",
    value: "text-gray-400",
  },
};

/**
 * Phrase d'état, en français courant.
 *
 * Le vocabulaire dépend de la nature de l'échéance: un document **expire**,
 * une intervention planifiée est **en retard**. Dire « échue » pour les deux
 * serait juridiquement correct et incompréhensible pour un magasinier.
 */
function libelleEcheance(jours: number | null, kind: DeadlineKind, emptyLabel: string): string {
  if (jours === null) return emptyLabel;

  const jour = (n: number) => `${n} jour${n > 1 ? "s" : ""}`;

  if (kind === "action") {
    if (jours < 0) return `En retard de ${jour(Math.abs(jours))}`;
    if (jours === 0) return "À faire aujourd'hui";
    if (jours === 1) return "À faire demain";
    return `À faire dans ${jour(jours)}`;
  }

  if (jours < 0) return `Expiré depuis ${jour(Math.abs(jours))}`;
  if (jours === 0) return "Expire aujourd'hui";
  if (jours === 1) return "Expire demain";
  return `Expire dans ${jour(jours)}`;
}

/**
 * Tuile d'échéance à état automatique.
 *
 * L'appelant fournit une date; la tuile en déduit seule son état (échue,
 * bientôt, à jour, non renseignée), sa couleur, son icône et sa phrase.
 * Aucun calcul de seuil à répéter dans les pages.
 *
 *   <DeadlineTile label="Assurance" date={vehicle.insuranceExpiry}
 *                 icon={<FileText className="h-4 w-4" />} />
 */
export function DeadlineTile({
  label,
  date,
  icon,
  kind = "document",
  warningWithinDays = 30,
  emptyLabel = "Non renseignée",
  onClick,
  className,
  ...rest
}: DeadlineTileProps) {
  const statut = statusFromDeadline(date, { warningWithinDays });
  const jours = daysUntilDeadline(date);
  const style = STYLES[statut];
  const estCliquable = typeof onClick === "function";

  // En alerte, l'icône métier cède la place au signal: on veut que l'œil
  // accroche la tuile qui pose problème, pas qu'il lise six icônes identiques.
  const iconeAffichee =
    statut === "critical" ? <AlertCircle className="h-4 w-4" /> :
    statut === "warning" ? <AlertTriangle className="h-4 w-4" /> :
    icon;

  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3.5 flex flex-col gap-1",
        style.tile,
        // Cliquable: curseur, survol, et accès clavier (Entrée / Espace).
        estCliquable &&
          "cursor-pointer transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
      data-status={statut}
      role={estCliquable ? "button" : undefined}
      tabIndex={estCliquable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        estCliquable
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      {...rest}
    >
      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", style.iconWrap)}>
        <span className={style.icon}>{iconeAffichee}</span>
      </div>
      <p className="text-[11px] font-medium text-gray-500 mt-1">{label}</p>
      <p className={cn("text-[13px] font-bold", style.value)}>
        {date ? formatDate(date as string) : "—"}
      </p>
      <p className={cn("text-[10px]", statut === "success" || statut === "neutral" ? "text-gray-400" : style.value)}>
        {libelleEcheance(jours, kind, emptyLabel)}
      </p>
    </div>
  );
}
