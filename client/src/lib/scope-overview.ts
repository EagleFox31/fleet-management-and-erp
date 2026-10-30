import { FEATURE_FLAGS, FEATURE_KEYS, type FeatureFlagsResponse, type FeatureKey, type FeatureLevel } from "@shared/feature-flags";

export type ScopeFeature = { key: FeatureKey; label: string; enabled: boolean };

/** Fonctions d'un niveau, libellés lus dans le catalogue, état lu dans les drapeaux effectifs. */
export function featuresByLevel(level: FeatureLevel, flags: FeatureFlagsResponse): ScopeFeature[] {
  return FEATURE_KEYS.filter((key) => FEATURE_FLAGS[key].level === level).map((key) => ({
    key,
    label: FEATURE_FLAGS[key].label,
    enabled: flags[key],
  }));
}

/** Livré lundi : cœur de la recette, hors drapeaux (texte de docs/recette/perimetre-prochains-lots.md). */
export const DELIVERED_ITEMS: readonly string[] = [
  "Verrouillage du compte après plusieurs échecs de connexion (5 échecs, 15 minutes, valeurs provisoires).",
  "Journal d'audit : qui a fait quoi, quand.",
  "Sauvegarde quotidienne, conservée 12 mois, avec alerte en cas d'échec.",
  "Types de documents de véhicule paramétrables (9 types), avec alerte avant échéance.",
  "Export Word de l'ordre de travail et du bon de sortie.",
  "Planning d'atelier : un technicien ou un véhicule ne peut pas être affecté deux fois en même temps.",
  "Trois indicateurs du cahier des charges : incidents par mois, conformité préventive, coût moyen par intervention.",
  "Préférences de notification (alertes dans l'application).",
  "Exports réservés au personnel autorisé.",
  "Données fictives, un compte par profil.",
];

export type NextLot = { subject: string; reason: string; need: string };

/** Sujets des prochains lots : raison et besoin client, sans date promise. */
export const NEXT_LOTS: readonly NextLot[] = [
  { subject: "Alertes par e-mail", reason: "Pas de serveur d'envoi fourni.", need: "Un serveur d'e-mail et un expéditeur." },
  { subject: "Export de ses propres données pour un client", reason: "Lundi, un client n'a aucun export ; le filtre sur ses lignes vient après.", need: "Confirmation du besoin." },
  { subject: "Finance et trésorerie", reason: "Hors cahier des charges, formules à valider.", need: "Réponses aux questions finance." },
  { subject: "QHSE", reason: "Hors cahier des charges.", need: "Confirmation du périmètre." },
  { subject: "Suivi GPS", reason: "Fournisseur de balises non choisi.", need: "Choix du fournisseur." },
  { subject: "Tarifs et rentabilité par opération", reason: "Plusieurs formules coexistent dans vos fichiers.", need: "Formule retenue, grille tarifaire." },
  { subject: "SMS et notifications mobiles", reason: "Fournisseur non choisi.", need: "Fournisseur." },
  { subject: "Connexion unique (Microsoft, Google)", reason: "Fournisseur non choisi.", need: "Fournisseur." },
  { subject: "Restauration en un clic", reason: "Opération sensible, procédure documentée d'abord.", need: "Exercice de restauration réussi." },
];
