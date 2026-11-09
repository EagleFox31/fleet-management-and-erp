/**
 * Réponse de `GET /api/tires/statistics-advanced` (`TiresService.getTireStatisticsAdvanced`).
 * Route refusée au chauffeur (`isTireValuationReader`) : la fiche pneu servie contient le prix d'achat.
 *
 * Les types décrivent ce qui est servi aujourd'hui, sans le changer : les sommes Postgres
 * (`SUM` d'un integer, d'un numeric) arrivent du pilote en texte, et valent `0` quand il n'y a
 * aucun pneu (repli `|| 0`). `averageWear` vaut `null` sans inspection active.
 */
import type { Tire } from "../schema";
import type { Serialized } from "./serialized";

/** Inspection active sous 3 mm de profondeur de bande. */
export interface CriticalWearInspection {
  inspectionId: number;
  treadDepth: number | null;
  vehicleRegistration: string | null;
  tireBrand: string | null;
  tireModel: string | null;
  position: string | null;
}

/** Véhicule opérationnel avec la dernière rotation connue. */
export interface RotationVehicle {
  vehicleId: number;
  vehicleRegistration: string;
  currentMileage: number;
  lastRotationMileage: number | null;
  nextRotationMileage: number | null;
}

export type TireActionPriority = "critical" | "high" | "medium";

interface TireActionBase<Type extends string, Priority extends TireActionPriority> {
  type: Type;
  message: string;
  priority: Priority;
}

export interface TireStockAction<Type extends "low_stock" | "out_of_stock", Priority extends TireActionPriority>
  extends TireActionBase<Type, Priority> {
  tire: Tire;
}
export interface CriticalWearAction extends TireActionBase<"critical_wear", "critical"> {
  inspection: CriticalWearInspection;
}
export interface RotationAction<Type extends "rotation_due" | "rotation_approaching", Priority extends TireActionPriority>
  extends TireActionBase<Type, Priority> {
  vehicle: RotationVehicle;
}

export interface TireRequiredActions {
  lowStock: TireStockAction<"low_stock", "high">[];
  outOfStock: TireStockAction<"out_of_stock", "critical">[];
  criticalWear: CriticalWearAction[];
  rotationDue: RotationAction<"rotation_due", "high">[];
  rotationApproaching: RotationAction<"rotation_approaching", "medium">[];
}

export interface TireStatisticsAdvanced {
  /** Somme des quantités en stock : texte (bigint), `0` sans pneu. */
  totalTires: string | number;
  /** Valeur du stock (quantité × prix d'achat) : texte (numeric), `0` sans pneu. */
  totalValue: string | number;
  /** Profondeur moyenne des pneus montés (mm, une décimale), `null` sans inspection active. */
  averageWear: number | null;
  /** Nombre de références en stock faible mais non épuisé (`requiredActions.lowStock`). */
  lowStockCount: number;
  /** Rotations (`tire_rotations.rotation_date`) du mois civil en cours à Africa/Douala (`KPI_TIME_ZONE`). */
  rotationsThisMonth: number;
  requiredActions: TireRequiredActions;
}

/** Réponse HTTP lue par le client : `tire.createdAt`, `updatedAt`, `deletedAt` en texte ISO. */
export type TireStatisticsAdvancedJson = Serialized<TireStatisticsAdvanced>;
export type TireRequiredActionsJson = Serialized<TireRequiredActions>;
