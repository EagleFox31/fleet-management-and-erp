/**
 * Écrans du chantier CDC (écarts du cahier des charges, lot CDC-0b) : une ligne par écran,
 * déclarative, sur le modèle de `lot-screens.ts`.
 *
 * `lot-routes.tsx` en tire les routes, `sidebar.tsx` les entrées de menu, en itérant
 * `[...LOT_SCREENS, ...CDC_SCREENS]`. Un lot fonctionnel remplit seulement le fichier
 * `client/src/pages/cdc/<id>.tsx` de son écran : ni ce registre, ni `App.tsx`, ni la sidebar
 * ne sont retouchés. Il peut ajuster le titre, le menu ou les rôles de sa ligne, à condition
 * de rester aligné sur la garde serveur (voir `tests/unit/client/cdc-screens.test.ts`).
 *
 * Chaque écran est derrière un drapeau de `shared/feature-flags.ts`, coupé par défaut : le
 * drapeau masque le menu et rend la route introuvable côté client. La vraie garde reste
 * `requireFeature` côté serveur (`server/api/index.ts`).
 *
 * Les rôles d'un écran sont ceux de l'API qui le nourrit, telle que montée dans
 * `server/api/index.ts` : un écran ouvert à un rôle que son API refuse affiche une page vide
 * puis un 403 (leçon « Écran ouvert à un rôle que son API refuse »).
 */
import {
  FileBarChart,
  FileSpreadsheet,
  MapPin,
  RadioTower,
  ScanLine,
  ShoppingBag,
  Tag,
  TrendingUp,
} from "lucide-react";
import {
  GPS_VIEW_ROLES,
  IMPORT_INTERVENTION_ROLES,
  KPI_VIEWER_ROLES,
  MAINTENANCE_REPORT_ROLES,
  PART_LABEL_ROLES,
  PART_SALE_READ_ROLES,
  PART_SCAN_ROLES,
  type AppRole,
} from "@shared/constants/roles";
import type { FeatureKey } from "@shared/feature-flags";
import type { LotScreen } from "@/config/lot-screens";

export type CdcScreenApi = {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** Chemin tel qu'appelé par le client, préfixe de montage compris. */
  path: string;
};

/**
 * Un écran CDC est un écran du lot (`LotScreen`) dont le drapeau et les rôles sont obligatoires
 * (jamais `"authenticated"`) et dont les appels d'API sont déclarés. `task` reprend le numéro du
 * lot fonctionnel qui remplit la page (`docs/plans/cdc-ecarts.md`).
 */
export type CdcScreen = LotScreen & {
  feature: FeatureKey;
  roles: readonly AppRole[];
  /** Drapeaux exigés en plus de `feature` (le montage serveur les exige tous). */
  alsoRequires?: readonly FeatureKey[];
  /**
   * Appels d'API de l'écran, à titre de documentation. Les rôles de l'écran sont ceux du montage
   * serveur qui garde son accès, quelle que soit la méthode : le test les compare.
   */
  apis: readonly CdcScreenApi[];
};

/** Tous les drapeaux dont dépend un écran ; l'un d'eux éteint, l'écran disparaît. */
export function screenFeatures(screen: LotScreen): FeatureKey[] {
  const extra = "alsoRequires" in screen ? ((screen as CdcScreen).alsoRequires ?? []) : [];
  return [...(screen.feature ? [screen.feature] : []), ...extra];
}

export const CDC_SCREENS: readonly CdcScreen[] = [
  // --- Lot #3 : QR des pièces
  {
    id: "part-scanner", path: "/inventory/scan", title: "Scanner une pièce", task: "CDC-3",
    description: "Retrouver une pièce en scannant l'étiquette QR collée sur son emplacement.",
    feature: "part-qr", roles: PART_SCAN_ROLES,
    apis: [{ method: "GET", path: "/api/part-scans" }, { method: "POST", path: "/api/part-scans" }],
    menu: { group: "inventory", label: "Scanner une pièce", icon: ScanLine },
  },
  {
    id: "part-labels", path: "/inventory/labels", title: "Étiquettes des pièces", task: "CDC-3",
    description: "Imprimer les étiquettes QR des pièces du magasin.",
    feature: "part-qr", roles: PART_LABEL_ROLES,
    apis: [{ method: "GET", path: "/api/parts" }],
    menu: { group: "inventory", label: "Étiquettes des pièces", icon: Tag },
  },
  // --- Lot #4 : vente de pièces
  {
    id: "part-sales", path: "/inventory/sales", title: "Ventes de pièces", task: "CDC-4",
    description: "Ventes de pièces du magasin : saisie, validation, annulation et facturation.",
    feature: "part-sales", roles: PART_SALE_READ_ROLES,
    apis: [{ method: "GET", path: "/api/part-sales" }, { method: "POST", path: "/api/part-sales" }],
    menu: { group: "inventory", label: "Ventes de pièces", icon: ShoppingBag },
  },
  // --- Lot #6 : suivi GPS
  {
    id: "fleet-map", path: "/fleet/map", title: "Carte de la flotte", task: "CDC-6",
    description: "Dernière position connue des véhicules équipés d'un boîtier.",
    feature: "gps", roles: GPS_VIEW_ROLES,
    apis: [{ method: "GET", path: "/api/vehicle-positions" }],
    menu: { group: "resources", label: "Carte de la flotte", icon: MapPin },
  },
  {
    id: "telemetry-devices", path: "/admin/telemetry-devices", title: "Boîtiers de suivi", task: "CDC-6",
    description: "Boîtiers GPS rattachés aux véhicules : enregistrement, jeton d'appareil et état.",
    feature: "gps", roles: ["admin"],
    apis: [{ method: "GET", path: "/api/admin/telemetry-devices" }],
    menu: { group: "administration", label: "Boîtiers de suivi", icon: RadioTower },
  },
  // --- Lot #7 : indicateurs
  {
    id: "kpi-reports", path: "/management/kpi-reports", title: "Rapports d'indicateurs", task: "CDC-7",
    description: "Indicateurs de maintenance sur une période, avec export PDF et Excel.",
    feature: "kpi-reports", roles: KPI_VIEWER_ROLES,
    apis: [{ method: "GET", path: "/api/kpi" }],
    menu: { group: "top", label: "Rapports d'indicateurs", icon: TrendingUp },
  },
  // --- Lot #8 : rapport de maintenance
  {
    id: "maintenance-report", path: "/maintenance/report", title: "Rapport de maintenance", task: "CDC-8",
    description: "Rapport de maintenance d'un véhicule ou d'une période, à télécharger.",
    // Le montage serveur exige aussi `exports` (rapport remis au format Word).
    feature: "maintenance-report", alsoRequires: ["exports"], roles: MAINTENANCE_REPORT_ROLES,
    apis: [{ method: "GET", path: "/api/maintenance-reports" }],
    menu: { group: "maintenance", label: "Rapport de maintenance", icon: FileBarChart },
  },
  // --- Lot #9 : import Excel
  {
    id: "excel-import", path: "/admin/excel-import", title: "Import Excel", task: "CDC-9",
    description: "Importer des véhicules, pièces ou interventions depuis un classeur Excel.",
    feature: "excel-import", roles: IMPORT_INTERVENTION_ROLES,
    apis: [{ method: "POST", path: "/api/imports" }],
    menu: { group: "administration", label: "Import Excel", icon: FileSpreadsheet },
  },
];
