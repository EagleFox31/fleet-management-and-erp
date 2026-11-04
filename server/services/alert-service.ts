import type { NotificationTopic } from "@shared/contracts/notification-settings";
import type { AppRole } from "@shared/constants/roles";
import { filterUsersByTopic } from "./notification-preferences-service";
import { storage } from "../storage";
import type { Vehicle, Alert } from "../../shared/schema";
import { db } from "../db";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  alerts,
  alertRecipientSettings,
  missions,
  assignments,
  suppliers,
  vehicleDocuments,
  vehicleDocumentTypes,
  vehicles,
  maintenanceSchedules,
  fuelRecords,
  users,
  workOrders,
} from "../../shared/schema";
import { and, asc, eq, inArray, isNotNull, isNull, lt, max, or, sql, type SQL } from "drizzle-orm";
import { classifyDocumentExpiry, documentExpiryDedupeKey } from "./document-expiry-rule";
import { daysBetweenDateOnly, toExpiryDateOnly, todayUtcDateOnly } from "@shared/constants/expiry-day";
import { moduleLogger } from "../lib/logger";
import { broadcastAlertCreated } from "../lib/alert-broadcast";

const log = moduleLogger("alert-service");
/** Taille des échantillons de candidates dans le journal récapitulatif d'emitAlerts. */
const SAMPLE_SIZE = 5;

/** Clé de rappel quotidien (ALR1) : même objet, même jour UTC = même alerte. */
export function dailyReminderDedupeKey(type: string, title: string, link: string, now: Date = new Date()): string {
  return `daily:${now.toISOString().slice(0, 10)}:${type}:${link}:${title}`;
}

/** `satisfies` : un rôle retiré du schéma fait échouer la compilation ici. */
const ALERT_RECIPIENT_ROLES = ["admin", "workshop_manager", "technician", "secretary", "logistics", "warehouse"] as const satisfies readonly AppRole[];
type AlertRecipientRole = (typeof ALERT_RECIPIENT_ROLES)[number];

const isAlertRecipientRole = (role: string): role is AlertRecipientRole =>
  (ALERT_RECIPIENT_ROLES as readonly string[]).includes(role);

/** Alerte candidate : une par objet, déclinée ensuite par destinataire. */
type AlertCandidate = {
  vehicleId?: number;
  workOrderId?: number;
  maintenanceScheduleId?: number;
  type: Alert['type'];
  title: string;
  message: string;
  priority: Alert['priority'];
  link?: string;
  entityType?: string;
  entityId?: number;
  targetRoles?: AlertRecipientRole[];
  /** Utilisateur à ne pas notifier: l'auteur du geste qui déclenche l'alerte. */
  excludeUserId?: number | null;
  targetUserIds?: Array<number | null | undefined>;
  /** Thème de notification (P-12) ; par défaut le type de l'alerte, qui est aussi un thème. */
  topic?: NotificationTopic;
  /** Clé stable: si fournie, une alerte déjà émise (lue ou non) avec cette clé n'est pas recréée. */
  dedupeKey?: string;
  /**
   * Génération planifiée (ALR1) : au plus une alerte par destinataire et par jour
   * pour le même objet, lue ou non. Sans elle, une alerte lue revenait au passage
   * suivant (toutes les 5 min) et deux passages simultanés la doublaient.
   */
  remindDaily?: boolean;
};

/**
 * Passage planifié (#281) : les candidates s'accumulent dans ce contexte et sont émises
 * en une fois à la fin (destinataires, préférences, existant, insertion : nombre de
 * requêtes indépendant du nombre de véhicules). Hors passage, émission immédiate.
 * AsyncLocalStorage : une alerte déclenchée par une requête HTTP pendant le passage
 * n'entre pas dans son lot.
 */
const pendingAlertBatch = new AsyncLocalStorage<AlertCandidate[]>();

/** Un seul paramètre pour une liste de longueur quelconque (inArray en ouvre un par valeur). */
function anyText(column: Parameters<typeof eq>[0], values: readonly string[]): SQL {
  return sql`${column} = ANY (SELECT jsonb_array_elements_text(${JSON.stringify(values)}::jsonb))`;
}
function anyInt(column: Parameters<typeof eq>[0], values: readonly number[]): SQL {
  return sql`${column} = ANY (SELECT (jsonb_array_elements_text(${JSON.stringify(values)}::jsonb))::int)`;
}

const INSERT_CHUNK = 500;

/** Reprise objet par objet d'un lot en échec : arrêt après ce nombre d'échecs consécutifs. */
export const MAX_CONSECUTIVE_RETRY_FAILURES = 3;

/** Base injoignable ou connexion coupée : réessayer chaque candidate ne servirait à rien. */
export function isConnectionError(error: unknown): boolean {
  for (let current: any = error, depth = 0; current && depth < 3; current = current.cause, depth += 1) {
    const code = typeof current.code === "string" ? current.code : "";
    if (["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "57P01", "57P02", "57P03"].includes(code) || /^08/.test(code)) return true;
  }
  return false;
}

function groupBy<T, K>(rows: readonly T[], keyOf: (row: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

export class AlertService {
  private readonly maintenanceRecipients: AlertRecipientRole[] = [
    "admin",
    "workshop_manager",
    "secretary",
  ];

  private readonly workOrderRecipients: AlertRecipientRole[] = [
    "admin",
    "workshop_manager",
    "secretary",
  ];

  private readonly fuelRecipients: AlertRecipientRole[] = [
    "admin",
    "logistics",
  ];

  // Alertes papiers (30 jours, expiré) : atelier, secrétariat et chef de parc.
  // emitAlerts dédoublonne un utilisateur qui cumulerait plusieurs rôles.
  private readonly documentAlertRecipients: AlertRecipientRole[] = [
    "admin",
    "workshop_manager",
    "secretary",
    "logistics",
  ];

  // Chef de parc : le rôle `logistics` (planification des missions, cf. shared/schema.ts).
  private readonly fleetChiefRecipients: AlertRecipientRole[] = [
    "logistics",
  ];

  private readonly missionRecipients: AlertRecipientRole[] = [
    "admin",
    "logistics",
    "secretary",
  ];

  // Fiches fournisseurs à qualifier: c'est l'administration qui détient les
  // données commerciales (cf. docs/analysis/MATRICE_ROLES_GAP.md).
  private readonly procurementRecipients: AlertRecipientRole[] = [
    "admin",
    "secretary",
  ];

  // Sortie exceptionnelle: le magasin doit savoir ce qui est parti sans lui
  // pour rapprocher l'étagère, l'admin pour surveiller l'usage de la soupape.
  private readonly stockOverrideRecipients: AlertRecipientRole[] = [
    "admin",
    "warehouse",
  ];

  // Stock bas : le magasin réapprovisionne, l'admin surveille (décision du 3 novembre 2026).
  private readonly lowStockRecipients: AlertRecipientRole[] = [
    "admin",
    "warehouse",
  ];

  /**
   * Une fiche fournisseur est "à compléter" quand elle ne porte que son nom.
   * Cas produit par la création inline depuis le formulaire pièce: le magasinier
   * peut nommer un fournisseur, mais pas renseigner ses données commerciales.
   */
  static isSupplierIncomplete(supplier: {
    contactName?: string | null;
    email?: string | null;
    phone?: string | null;
    category?: string | null;
  }): boolean {
    const renseigne = (valeur?: string | null) => Boolean(valeur && valeur.trim().length > 0);
    return (
      !renseigne(supplier.contactName) &&
      !renseigne(supplier.email) &&
      !renseigne(supplier.phone) &&
      !renseigne(supplier.category)
    );
  }

  /**
   * Alerte immédiate à la création d'une fiche fournisseur incomplète.
   * Appelée depuis `POST /api/suppliers`; le rappel périodique ci-dessous prend
   * le relais tant que la fiche n'est pas qualifiée.
   */
  async notifyIncompleteSupplierCreated(supplier: {
    id: number;
    name: string;
  }, createdByName?: string | null): Promise<void> {
    await this.createAlertIfNotExists({
      type: "procurement",
      title: "Fiche fournisseur à compléter",
      message: createdByName
        ? `« ${supplier.name} » a été créé par ${createdByName} avec le nom seul. Complétez contact, catégorie et conditions.`
        : `« ${supplier.name} » a été créé avec le nom seul. Complétez contact, catégorie et conditions.`,
      priority: "medium",
      link: `/procurement/suppliers/${supplier.id}/edit`,
      entityType: "supplier",
      entityId: supplier.id,
      targetRoles: this.procurementRecipients,
    });
  }

  /**
   * Affectation d'un ordre de travail à un technicien.
   *
   * Alerte **nominative**: elle ne part qu'au technicien concerné, via
   * `targetUserIds`. Sans elle, le chef d'atelier voyait « OT mis à jour » et
   * le technicien ne voyait rien — il découvrait son travail en ouvrant la
   * liste, ou pas.
   *
   * Le `link` pointe le détail de l'OT: la cloche du bandeau et le panneau
   * d'alertes y naviguent au clic, sur ordinateur comme dans la PWA, qui est
   * la même application.
   *
   * Le titre porte le numéro d'OT: `createAlertIfNotExists` déduplique sur le
   * titre, et deux affectations distinctes ne doivent pas se masquer. Une
   * réaffectation au même technicien ne crée pas de doublon tant que la
   * première n'est pas lue — c'est le comportement voulu.
   */
  async notifyWorkOrderAssigned(params: {
    workOrderId: number;
    workOrderTitle: string;
    technicianUserId: number;
    assignedByName?: string | null;
    vehicleRegistration?: string | null;
  }): Promise<void> {
    const parQui = params.assignedByName ? ` par ${params.assignedByName}` : "";
    const surQuoi = params.vehicleRegistration ? ` — ${params.vehicleRegistration}` : "";

    await this.createAlertIfNotExists({
      type: "work_order",
      title: `Nouvelle intervention assignée — OT #${params.workOrderId}`,
      message: `« ${params.workOrderTitle} »${surQuoi} vous a été assigné${parQui}.`,
      priority: "high",
      link: `/maintenance/work-orders/${params.workOrderId}`,
      entityType: "work_order",
      entityId: params.workOrderId,
      targetUserIds: [params.technicianUserId],
    });
  }

  /**
   * Avancement d'un ordre de travail — remontée vers l'encadrement atelier.
   *
   * L'affectation descendait du chef vers le technicien; rien ne remontait.
   * Or c'est l'encadrement qui pilote: il doit savoir qu'un camion est entré
   * en réparation, qu'il en ressort, et surtout qu'une intervention est
   * bloquée.
   *
   * Chaque transition a son urgence propre et son geste attendu:
   * - `in_progress`     : information, rien à faire.
   * - `completed`       : le véhicule redevient disponible — il faut le placer.
   * - `awaiting_parts`  : quelqu'un doit débloquer la pièce, sinon ça dort.
   *
   * L'appelant filtre l'auto-notification: le chef qui change lui-même un
   * statut n'a pas à être prévenu de son propre geste.
   */
  async notifyWorkOrderProgress(params: {
    workOrderId: number;
    workOrderTitle: string;
    newStatus: "in_progress" | "completed" | "awaiting_parts";
    technicianName?: string | null;
    vehicleRegistration?: string | null;
    /** Auteur du changement: il ne se notifie pas lui-même. */
    excludeUserId?: number | null;
  }): Promise<void> {
    const qui = params.technicianName || "Le technicien";
    const camion = params.vehicleRegistration;

    // Le titre porte le statut ET le numéro d'OT: `createAlertIfNotExists`
    // déduplique sur le titre, et les trois étapes d'un même OT doivent
    // pouvoir coexister dans la cloche.
    const messages = {
      in_progress: {
        title: `Intervention démarrée — OT #${params.workOrderId}`,
        message: camion
          ? `${qui} a commencé « ${params.workOrderTitle} » sur ${camion}.`
          : `${qui} a commencé « ${params.workOrderTitle} ».`,
        priority: "low" as const,
      },
      completed: {
        title: `Intervention terminée — OT #${params.workOrderId}`,
        message: camion
          ? `${qui} a terminé « ${params.workOrderTitle} ». ${camion} est de nouveau disponible.`
          : `${qui} a terminé « ${params.workOrderTitle} ».`,
        priority: "medium" as const,
      },
      awaiting_parts: {
        title: `Intervention bloquée — OT #${params.workOrderId}`,
        message: camion
          ? `${qui} attend une pièce pour « ${params.workOrderTitle} ». ${camion} reste immobilisé.`
          : `${qui} attend une pièce pour « ${params.workOrderTitle} ».`,
        priority: "high" as const,
      },
    };

    const contenu = messages[params.newStatus];

    await this.createAlertIfNotExists({
      type: "work_order",
      title: contenu.title,
      message: contenu.message,
      priority: contenu.priority,
      link: `/maintenance/work-orders/${params.workOrderId}`,
      entityType: "work_order",
      entityId: params.workOrderId,
      targetRoles: this.workOrderRecipients,
      excludeUserId: params.excludeUserId,
    });
  }

  /**
   * Sortie exceptionnelle du stock par le chef d'atelier (magasin fermé).
   *
   * Le magasinier n'a pas remis la pièce: il doit pouvoir rapprocher son
   * étagère lundi matin. L'alerte est donc immédiate et nominative, pas un
   * rappel périodique — au prochain cycle, l'information serait déjà froide.
   *
   * Le titre porte le numéro de demande: `createAlertIfNotExists` déduplique
   * sur le titre, et deux sorties exceptionnelles distinctes ne doivent jamais
   * se masquer l'une l'autre. Une demande n'étant sortie qu'une fois (`issued`
   * est final), l'unicité est acquise par construction.
   */
  async notifyExceptionalStockIssue(params: {
    requirementId: number;
    partName: string;
    quantity: number;
    workOrderId: number;
    reason: string;
    issuedByName?: string | null;
  }): Promise<void> {
    const auteur = params.issuedByName ? ` par ${params.issuedByName}` : "";

    await this.createAlertIfNotExists({
      type: "inventory",
      title: `Sortie exceptionnelle — demande #${params.requirementId}`,
      message:
        `${params.quantity} × « ${params.partName} » est sorti du stock${auteur} ` +
        `sans passer par le magasin (OT #${params.workOrderId}). ` +
        `Motif: ${params.reason}. À rapprocher avec l'étagère.`,
      priority: "high",
      link: `/work-orders/${params.workOrderId}`,
      entityType: "part_requirement",
      entityId: params.requirementId,
      targetRoles: this.stockOverrideRecipients,
    });
  }

  /**
   * Stock bas après un mouvement : une alerte nominative et une trame `alert_created`
   * par admin et magasinier. `createAlertIfNotExists` déduplique par destinataire
   * (même titre et même lien non lus). À appeler hors transaction, après le commit.
   */
  async notifyLowStock(params: {
    partId: number;
    title: string;
    message: string;
    priority: Alert["priority"];
  }): Promise<void> {
    await this.createAlertIfNotExists({
      type: "inventory",
      title: params.title,
      message: params.message,
      priority: params.priority,
      link: `/warehouse/parts/${params.partId}`,
      targetRoles: this.lowStockRecipients,
    });
  }

  /**
   * Rappel périodique: relance tant qu'une fiche fournisseur reste au nom seul.
   * `createAlertIfNotExists` empêche l'accumulation d'alertes identiques.
   */
  async checkIncompleteSupplierAlerts(): Promise<void> {
    console.log("🔍 Vérification des fiches fournisseurs à compléter...");

    const incomplets = await db
      .select({
        id: suppliers.id,
        name: suppliers.name,
        createdAt: suppliers.createdAt,
      })
      .from(suppliers)
      .where(
        and(
          eq(suppliers.isActive, true),
          isNull(suppliers.contactName),
          isNull(suppliers.email),
          isNull(suppliers.phone),
          isNull(suppliers.category),
        ),
      );

    for (const fournisseur of incomplets) {
      const joursDepuisCreation = Math.floor(
        (Date.now() - new Date(fournisseur.createdAt).getTime()) / (1000 * 60 * 60 * 24),
      );

      await this.createAlertIfNotExists({
        remindDaily: true,
        type: "procurement",
        title: "Fiche fournisseur à compléter",
        message:
          joursDepuisCreation > 0
            ? `« ${fournisseur.name} » est au nom seul depuis ${joursDepuisCreation} jour(s). Complétez contact, catégorie et conditions.`
            : `« ${fournisseur.name} » est au nom seul. Complétez contact, catégorie et conditions.`,
        priority: joursDepuisCreation >= 7 ? "high" : "medium",
        link: `/procurement/suppliers/${fournisseur.id}/edit`,
        entityType: "supplier",
        entityId: fournisseur.id,
        targetRoles: this.procurementRecipients,
      });
    }

    console.log(`   ${incomplets.length} fiche(s) fournisseur à compléter`);
  }

  /** Destinataires par rôle, tous rôles en une requête (comptes supprimés exclus, comme getUsersByRole). */
  private async usersByRole(roles: readonly AlertRecipientRole[]): Promise<Map<string, number[]>> {
    const byRole = new Map<string, number[]>();
    if (roles.length === 0) return byRole;
    const rows = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(and(anyText(users.role, [...roles]), isNull(users.deletedAt)))
      .orderBy(asc(users.id));
    for (const row of rows) {
      const list = byRole.get(row.role) ?? [];
      list.push(row.id);
      byRole.set(row.role, list);
    }
    return byRole;
  }

  /**
   * Rôles destinataires des alertes carburant : réglage alert_recipient_settings (même
   * source que les triggers de fuel-alerts-triggers.sql). Repli sur la valeur par défaut
   * si la ligne manque, est vide ou illisible. Un rôle hors ALERT_RECIPIENT_ROLES est ignoré.
   */
  async fuelRecipientRoles(): Promise<AlertRecipientRole[]> {
    try {
      const [row] = await db
        .select({ roles: alertRecipientSettings.recipientRoles })
        .from(alertRecipientSettings)
        .where(eq(alertRecipientSettings.alertType, "fuel"));
      if (!row) return this.fuelRecipients;
      const roles = row.roles.filter(isAlertRecipientRole);
      const ignored = row.roles.filter((role) => !isAlertRecipientRole(role));
      if (ignored.length > 0) log.warn({ ignored }, "rôles destinataires carburant ignorés");
      return roles.length > 0 ? roles : this.fuelRecipients;
    } catch (err) {
      log.error({ err }, "réglage des destinataires carburant illisible, valeur par défaut");
      return this.fuelRecipients;
    }
  }

  /**
   * Vérifie toutes les alertes véhicules et crée les alertes manquantes
   */
  async checkVehicleAlerts(): Promise<void> {
    console.log("🔍 Vérification des alertes véhicules...");
    
    // Récupérer tous les véhicules
    const { vehicles } = await storage.listAllVehicles();
    const activeVehicles = vehicles.filter((v: Vehicle) => v.status !== 'out_of_service');
    // Chargés une fois pour tous les véhicules (#281), plutôt qu'une requête par papier expiré.
    const [latestDocumentIds, inProgressMissions] = await Promise.all([
      this.latestDocumentIds(),
      this.inProgressMissionsByVehicle(),
    ]);

    for (const vehicle of activeVehicles) {
      await this.checkVehicleMaintenanceAlerts(vehicle);
      await this.checkVehicleDocumentAlerts(vehicle, { latestDocumentIds, inProgressMissions });
      await this.checkVehicleMileageAlerts(vehicle);
    }
  }

  /**
   * Vérifie toutes les alertes ordres de travail
   */
  async checkWorkOrderAlerts(): Promise<void> {
    console.log("🔍 Vérification des alertes ordres de travail...");
    
    // Seuls les OT ouverts peuvent alerter. Requête directe : storage.getWorkOrders() pagine
    // à 50 par défaut, les OT au-delà n'étaient jamais contrôlés (#281).
    const openWorkOrders = await db
      .select({
        id: workOrders.id,
        title: workOrders.title,
        status: workOrders.status,
        priority: workOrders.priority,
        startDate: workOrders.startDate,
        createdAt: workOrders.createdAt,
        technicianId: workOrders.technicianId,
      })
      .from(workOrders)
      .where(inArray(workOrders.status, ["pending", "in_progress"]))
      .orderBy(asc(workOrders.id));
    const today = new Date();
    
    for (const wo of openWorkOrders) {
      // Ordres en retard
      if ((wo.status === 'pending' || wo.status === 'in_progress') && wo.startDate) {
        const startDate = new Date(wo.startDate);
        const daysPast = Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        
        if (daysPast > 0) {
          await this.createAlertIfNotExists({
            remindDaily: true,
            workOrderId: wo.id,
            type: 'work_order',
            title: 'Ordre de travail en retard',
            message: `OT #${wo.id} "${wo.title}" - En retard de ${daysPast} jours`,
            priority: daysPast > 7 ? 'critical' : 'high',
            link: `/work-orders/${wo.id}`,
            targetRoles: this.workOrderRecipients,
            targetUserIds: [wo.technicianId]
          });
        }
      }
      
      // Ordres critiques non traités
      if (wo.status === 'pending' && wo.priority === 'critical') {
        const createdAt = new Date(wo.createdAt);
        const hoursWaiting = Math.floor((today.getTime() - createdAt.getTime()) / (1000 * 60 * 60));
        
        await this.createAlertIfNotExists({
          remindDaily: true,
          workOrderId: wo.id,
          type: 'work_order',
          title: 'OT critique non traité',
          message: `OT #${wo.id} "${wo.title}" - Critique non traité depuis ${hoursWaiting}h`,
          priority: 'critical',
          link: `/work-orders/${wo.id}`,
          targetRoles: this.workOrderRecipients,
          targetUserIds: [wo.technicianId]
        });
      }
    }
  }

  /**
   * Vérifie les alertes de planification maintenance
   */
  async checkMaintenanceScheduleAlerts(): Promise<void> {
    console.log("🔍 Vérification des alertes planification maintenance...");
    
    const { vehicles } = await storage.listAllVehicles();
    const today = new Date().toISOString().split('T')[0];
    
    // Une requête pour tous les plannings actifs, groupés par véhicule (#281).
    const activeSchedules = await db
      .select({
        id: maintenanceSchedules.id,
        vehicleId: maintenanceSchedules.vehicleId,
        title: maintenanceSchedules.title,
        scheduledDate: maintenanceSchedules.scheduledDate,
        scheduledMileage: maintenanceSchedules.scheduledMileage,
        isActive: maintenanceSchedules.isActive,
      })
      .from(maintenanceSchedules)
      .where(eq(maintenanceSchedules.isActive, true))
      .orderBy(asc(maintenanceSchedules.scheduledDate), asc(maintenanceSchedules.id));
    const schedulesByVehicle = groupBy(activeSchedules, (schedule) => schedule.vehicleId);

    for (const vehicle of vehicles) {
      const schedules = schedulesByVehicle.get(vehicle.id) ?? [];

      for (const schedule of schedules) {
        if (!schedule.isActive) continue;

        // Maintenance due par date
        if (schedule.scheduledDate && schedule.scheduledDate <= today) {
          const daysPast = Math.floor((new Date().getTime() - new Date(schedule.scheduledDate).getTime()) / (1000 * 60 * 60 * 24));
          
          await this.createAlertIfNotExists({
            remindDaily: true,
            maintenanceScheduleId: schedule.id,
            vehicleId: schedule.vehicleId,
            type: 'maintenance',
            title: 'Maintenance préventive programmée due',
            message: `"${schedule.title}" - Échéance préventive dépassée de ${daysPast} jours (date planifiée)`,
            priority: daysPast > 7 ? 'high' : 'medium',
            link: `/maintenance/schedules/${schedule.id}`,
            targetRoles: this.maintenanceRecipients
          });
        }
        
        // Maintenance due par kilométrage
        if (schedule.scheduledMileage && vehicle.mileage >= schedule.scheduledMileage) {
          const excessKm = vehicle.mileage - schedule.scheduledMileage;
          
          await this.createAlertIfNotExists({
            remindDaily: true,
            maintenanceScheduleId: schedule.id,
            vehicleId: schedule.vehicleId,
            type: 'maintenance',
            title: 'Maintenance préventive kilométrage due',
            message: `"${schedule.title}" - Échéance préventive kilométrique dépassée de ${excessKm} km (${vehicle.registrationNumber})`,
            priority: excessKm > 10000 ? 'high' : 'medium',
            link: `/maintenance/schedules/${schedule.id}`,
            targetRoles: this.maintenanceRecipients
          });
        }
      }
    }
  }

  /**
   * Vérifie les alertes de maintenance pour un véhicule
   */
  private async checkVehicleMaintenanceAlerts(vehicle: Vehicle): Promise<void> {
    const today = new Date().toISOString().split('T')[0];

    // Alerte maintenance en retard
    if (vehicle.nextMaintenanceDate && vehicle.nextMaintenanceDate < today) {
      const daysPast = Math.floor((new Date().getTime() - new Date(vehicle.nextMaintenanceDate).getTime()) / (1000 * 60 * 60 * 24));
      
      await this.createAlertIfNotExists({
        remindDaily: true,
        vehicleId: vehicle.id,
        type: 'maintenance',
        title: 'Maintenance en retard',
        message: `Véhicule ${vehicle.registrationNumber} - Échéance de maintenance préventive dépassée de ${daysPast} jours (date planifiée)`,
        priority: daysPast > 30 ? 'critical' : 'high',
        entityType: 'vehicle',
        entityId: vehicle.id,
        targetRoles: this.maintenanceRecipients
      });
    }

    // Alerte maintenance due dans les 7 jours
    if (vehicle.nextMaintenanceDate) {
      const nextMaintenanceDate = new Date(vehicle.nextMaintenanceDate);
      const daysUntil = Math.floor((nextMaintenanceDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysUntil > 0 && daysUntil <= 7) {
        await this.createAlertIfNotExists({
          remindDaily: true,
          vehicleId: vehicle.id,
          type: 'maintenance',
          title: 'Maintenance programmée',
          message: `Véhicule ${vehicle.registrationNumber} - Maintenance préventive à effectuer dans ${daysUntil} jours (date planifiée)`,
          priority: 'medium',
          entityType: 'vehicle',
          entityId: vehicle.id,
          targetRoles: this.maintenanceRecipients
        });
      }
    }
  }

  /**
   * Vérifie les alertes de documents pour un véhicule
   */
  private async checkVehicleDocumentAlerts(
    vehicle: Vehicle,
    preloaded?: {
      latestDocumentIds: Map<string, number>;
      inProgressMissions: Map<number, { id: number; orderNumber: string | null }>;
    },
  ): Promise<void> {
    // Appel isolé (hors passage) : charger le contexte, au prix de deux requêtes.
    const context = preloaded ?? {
      latestDocumentIds: await this.latestDocumentIds(),
      inProgressMissions: await this.inProgressMissionsByVehicle(),
    };
    const todayDateOnly = todayUtcDateOnly();

    const documents: Array<{
      field: "insuranceExpiry" | "technicalInspectionDate" | "licensePlateExpiry";
      name: string;
      documentType: "assurance" | "visite_technique" | "carte_grise";
    }> = [
      { field: 'insuranceExpiry', name: 'Assurance', documentType: 'assurance' },
      { field: 'technicalInspectionDate', name: 'Contrôle technique', documentType: 'visite_technique' },
      { field: 'licensePlateExpiry', name: 'Plaque d\'immatriculation', documentType: 'carte_grise' }
    ];

    for (const doc of documents) {
      const expiryDate = vehicle[doc.field];
      if (!expiryDate) continue;

      // Même règle que le lancement et getMissionEligibility (shared/constants/expiry-day.ts) :
      // jour UTC, le jour de l'échéance est valable, expiré à J+1.
      const expiryDateOnly = toExpiryDateOnly(expiryDate);
      if (expiryDateOnly === null) continue;
      const daysUntilExpiry = daysBetweenDateOnly(expiryDateOnly, todayDateOnly);

      // Document expiré (échéance au plus tard hier)
      if (daysUntilExpiry < 0) {
        const renewalLink = this.documentRenewalLink(context.latestDocumentIds, vehicle.id, doc.documentType);
        await this.createAlertIfNotExists({
          remindDaily: true,
          vehicleId: vehicle.id,
          type: 'maintenance',
          title: 'Document expiré',
          message: `Véhicule ${vehicle.registrationNumber} - ${doc.name} expirée depuis ${Math.abs(daysUntilExpiry)} jour${daysUntilExpiry === -1 ? "" : "s"} : lancement de mission bloqué`,
          priority: 'critical',
          link: renewalLink,
          entityType: 'vehicle_document',
          entityId: vehicle.id,
          targetRoles: this.documentAlertRecipients
        });

        // Papier expiré pendant une mission en cours : le chef de parc (logistique)
        // est prévenu. La mission n'est pas interrompue ; c'est l'éligibilité qui
        // refuse toute nouvelle affectation ou tout nouveau lancement.
        const missionEnCours = context.inProgressMissions.get(vehicle.id);
        if (missionEnCours) {
          await this.createAlertIfNotExists({
            remindDaily: true,
            vehicleId: vehicle.id,
            type: 'mission',
            title: 'Papier expiré en cours de mission',
            message: `Véhicule ${vehicle.registrationNumber} - ${doc.name} expirée pendant la mission ${missionEnCours.orderNumber ?? `#${missionEnCours.id}`}. La mission se poursuit ; aucune nouvelle mission avant régularisation.`,
            priority: 'critical',
            link: renewalLink,
            entityType: 'mission',
            entityId: missionEnCours.id,
            targetRoles: this.fleetChiefRecipients
          });
        }
      }
      // Document expire dans les 30 jours (jour J compris : dernier jour de validité)
      else if (daysUntilExpiry <= 30) {
        const renewalLink = this.documentRenewalLink(context.latestDocumentIds, vehicle.id, doc.documentType);
        await this.createAlertIfNotExists({
          remindDaily: true,
          vehicleId: vehicle.id,
          type: 'maintenance',
          title: 'Document expire bientôt',
          message: daysUntilExpiry === 0
            ? `Véhicule ${vehicle.registrationNumber} - ${doc.name} expire ce soir : dernier jour de validité`
            : `Véhicule ${vehicle.registrationNumber} - ${doc.name} expire dans ${daysUntilExpiry} jours`,
          priority: daysUntilExpiry <= 7 ? 'high' : 'medium',
          link: renewalLink,
          entityType: 'vehicle_document',
          entityId: vehicle.id,
          targetRoles: this.documentAlertRecipients
        });
      }
    }
  }

  /** Mission `in_progress` portée par une affectation, par véhicule (la première trouvée). */
  private async inProgressMissionsByVehicle(): Promise<Map<number, { id: number; orderNumber: string | null }>> {
    const rows = await db
      .select({ vehicleId: assignments.vehicleId, id: missions.id, orderNumber: missions.orderNumber })
      .from(assignments)
      .innerJoin(missions, eq(assignments.missionId, missions.id))
      .where(eq(missions.status, "in_progress"))
      .orderBy(asc(assignments.id));
    const byVehicle = new Map<number, { id: number; orderNumber: string | null }>();
    for (const row of rows) {
      if (row.vehicleId !== null && !byVehicle.has(row.vehicleId)) {
        byVehicle.set(row.vehicleId, { id: row.id, orderNumber: row.orderNumber });
      }
    }
    return byVehicle;
  }

  /** Document le plus récent par véhicule et par type, clé `vehicleId|type`. */
  private async latestDocumentIds(): Promise<Map<string, number>> {
    const rows = await db
      .select({ vehicleId: vehicleDocuments.vehicleId, type: vehicleDocuments.type, id: max(vehicleDocuments.id) })
      .from(vehicleDocuments)
      .groupBy(vehicleDocuments.vehicleId, vehicleDocuments.type);
    return new Map(
      rows.filter((row) => row.id !== null).map((row) => [`${row.vehicleId}|${row.type}`, row.id as number]),
    );
  }

  /**
   * Lien de l'alerte vers la demande de renouvellement du document le plus récent
   * du type ; à défaut de document, la fiche véhicule.
   */
  private documentRenewalLink(latestDocumentIds: Map<string, number>, vehicleId: number, documentType: string): string {
    const documentId = latestDocumentIds.get(`${vehicleId}|${documentType}`);
    return documentId
      ? `/vehicles/documents/renew?vehicleId=${vehicleId}&documentId=${documentId}&source=alert`
      : `/vehicles/${vehicleId}`;
  }

  /**
   * Documents véhicule typés (T-17a): échéance dans `alertDays` jours du type
   * (30 par défaut) ou déjà échue. Seuls les types actifs qui portent une
   * échéance (validity_months renseigné) sont concernés. Une alerte par
   * document et par échéance, thème `documents`.
   */
  async checkTypedDocumentExpiryAlerts(now: Date = new Date()): Promise<number> {
    const rows = await db
      .select({
        id: vehicleDocuments.id,
        vehicleId: vehicleDocuments.vehicleId,
        name: vehicleDocuments.name,
        expiryDate: vehicleDocuments.expiryDate,
        typeLabel: vehicleDocumentTypes.label,
        alertDays: vehicleDocumentTypes.alertDays,
        registrationNumber: vehicles.registrationNumber,
      })
      .from(vehicleDocuments)
      .innerJoin(vehicleDocumentTypes, eq(vehicleDocumentTypes.code, vehicleDocuments.type))
      .leftJoin(vehicles, eq(vehicles.id, vehicleDocuments.vehicleId))
      .where(
        and(
          isNotNull(vehicleDocuments.expiryDate),
          eq(vehicleDocumentTypes.active, true),
          isNotNull(vehicleDocumentTypes.validityMonths),
        ),
      );

    let emitted = 0;
    for (const row of rows) {
      const { status, days } = classifyDocumentExpiry(row.expiryDate, now, row.alertDays);
      if (status === "none" || days === null || !row.expiryDate) continue;

      const expiry = row.expiryDate.slice(0, 10);
      const vehicleLabel = row.registrationNumber ?? `#${row.vehicleId}`;
      const expired = status === "expired";
      await this.createAlertIfNotExists({
        vehicleId: row.vehicleId,
        type: "maintenance",
        topic: "documents",
        title: expired
          ? `${row.typeLabel} expiré (${vehicleLabel}, ${expiry})`
          : `${row.typeLabel} expire bientôt (${vehicleLabel}, ${expiry})`,
        message: expired
          ? `Véhicule ${vehicleLabel} - ${row.name} expiré depuis ${Math.abs(days)} jour(s), lancement de mission bloqué`
          : days === 0
            ? `Véhicule ${vehicleLabel} - ${row.name} expire ce soir : dernier jour de validité`
            : `Véhicule ${vehicleLabel} - ${row.name} expire dans ${days} jour(s)`,
        priority: expired ? "critical" : days <= 7 ? "high" : "medium",
        entityType: "vehicle_document",
        entityId: row.id,
        targetRoles: this.maintenanceRecipients,
        dedupeKey: documentExpiryDedupeKey(row.id, expiry, status),
      });
      emitted++;
    }
    return emitted;
  }

  /**
   * Vérifie les alertes de kilométrage pour un véhicule
   */
  private async checkVehicleMileageAlerts(vehicle: Vehicle): Promise<void> {
    if (!vehicle.nextMaintenanceMileage || !vehicle.mileage) return;

    const remainingKm = vehicle.nextMaintenanceMileage - vehicle.mileage;

    // Kilométrage dépassé
    if (remainingKm <= 0) {
      await this.createAlertIfNotExists({
        remindDaily: true,
        vehicleId: vehicle.id,
        type: 'maintenance',
        title: 'Kilométrage de maintenance dépassé',
        message: `Véhicule ${vehicle.registrationNumber} - Kilométrage dépassé de ${Math.abs(remainingKm)} km`,
        priority: 'critical',
        entityType: 'vehicle',
        entityId: vehicle.id,
        targetRoles: this.maintenanceRecipients
      });
    }
    // Kilométrage proche (dans les 5000 km)
    else if (remainingKm <= 5000) {
      await this.createAlertIfNotExists({
        remindDaily: true,
        vehicleId: vehicle.id,
        type: 'maintenance',
        title: 'Kilométrage de maintenance proche',
        message: `Véhicule ${vehicle.registrationNumber} - Plus que ${remainingKm} km avant maintenance`,
        priority: remainingKm <= 1000 ? 'high' : 'medium',
        entityType: 'vehicle',
        entityId: vehicle.id,
        targetRoles: this.maintenanceRecipients
      });
    }
  }

  /**
   * Vérifie les alertes de consommation carburant
   */
  async checkFuelConsumptionAlerts(): Promise<void> {
    console.log("🔍 Vérification des alertes consommation carburant...");

    const { vehicles } = await storage.listAllVehicles();
    // Une requête pour l'historique de tous les véhicules (#281), colonnes utiles seulement.
    const history = await db
      .select({
        id: fuelRecords.id,
        vehicleId: fuelRecords.vehicleId,
        date: fuelRecords.date,
        mileage: fuelRecords.mileage,
        quantity: fuelRecords.quantity,
      })
      .from(fuelRecords)
      .where(isNull(fuelRecords.deletedAt))
      .orderBy(asc(fuelRecords.vehicleId), asc(fuelRecords.id));
    const historyByVehicle = groupBy(history, (record) => record.vehicleId);
    const recipientRoles = await this.fuelRecipientRoles();

    for (const vehicle of vehicles) {
      const fuelHistory = historyByVehicle.get(vehicle.id) ?? [];
      if (fuelHistory.length < 3) continue;

      const sortedByDate = [...fuelHistory].sort((a, b) => {
        const aTime = a.date ? new Date(a.date).getTime() : 0;
        const bTime = b.date ? new Date(b.date).getTime() : 0;
        return aTime - bTime;
      });

      const consumptions: number[] = [];

      for (let i = 1; i < sortedByDate.length; i++) {
        const previous = sortedByDate[i - 1];
        const current = sortedByDate[i];

        if (!previous.mileage || !current.mileage) continue;

        const distance = current.mileage - previous.mileage;
        if (distance <= 0) continue;

        const consumption = (current.quantity / distance) * 100;
        if (Number.isFinite(consumption) && consumption > 0) {
          consumptions.push(consumption);
        }
      }

      if (consumptions.length < 3) continue;

      const avgConsumption = consumptions.reduce((sum, value) => sum + value, 0) / consumptions.length;
      const recentConsumptions = consumptions.slice(-3);
      const recentAvg = recentConsumptions.reduce((sum, value) => sum + value, 0) / recentConsumptions.length;

      if (recentAvg > avgConsumption * 1.2) {
        const excessPercent = Math.round(((recentAvg - avgConsumption) / avgConsumption) * 100);

        // Même clé que le trigger fuel_consumption_alert (#287) : une alerte par plein anormal,
        // que le trigger l'ait émise ou non (plein importé sous suppress_side_effects). Lue ou
        // non, elle ne revient pas en double.
        const latestRecord = sortedByDate[sortedByDate.length - 1];
        await this.createAlertIfNotExists({
          dedupeKey: `fuel-consumption:${latestRecord.id}`,
          vehicleId: vehicle.id,
          type: 'fuel',
          title: 'Consommation carburant élevée',
          message: `Véhicule ${vehicle.registrationNumber} - Consommation +${excessPercent}% vs moyenne`,
          priority: excessPercent > 50 ? 'high' : 'medium',
          entityType: 'fuel_record',
          entityId: vehicle.id,
          targetRoles: recipientRoles
        });
      }
    }
  }

  /**
   * Crée une alerte seulement si elle n'existe pas déjà. Pendant un passage planifié
   * (runAllAlertChecks), la candidate est mise en lot et émise à la fin du passage.
   */
  private async createAlertIfNotExists(alertData: AlertCandidate): Promise<void> {
    const batch = pendingAlertBatch.getStore();
    if (batch) {
      batch.push(alertData);
      return;
    }
    await this.emitAlerts([alertData]);
  }

  /**
   * Émet un lot de candidates en un nombre de requêtes fixe (#281) : destinataires
   * (une requête), préférences (une par thème), alertes existantes (une), insertion
   * (une par tranche de INSERT_CHUNK lignes). Règles de dédoublonnage inchangées :
   * - même clé (lue ou non) chez ce destinataire : pas de nouvelle alerte ;
   * - alerte non lue de même type, titre et lien (lien ignoré s'il est vide) : idem,
   *   quelle que soit sa clé (celle d'hier, ou NULL d'avant la clé).
   * Une candidate acceptée compte pour les suivantes du même lot, comme en séquentiel.
   * Retourne le nombre d'alertes créées.
   */
  private async emitAlerts(candidates: readonly AlertCandidate[]): Promise<number> {
    if (candidates.length === 0) return 0;
    try {
      return await this.emitAlertBatch(candidates);
    } catch (error) {
      if (candidates.length === 1) {
        log.error({ err: error, title: candidates[0].title, type: candidates[0].type }, "création d'alerte en échec");
        return 0;
      }
      const describe = (c: AlertCandidate) => ({ title: c.title, type: c.type });
      // Base injoignable : la reprise unitaire échouerait pareil, tout le lot est perdu.
      if (isConnectionError(error)) {
        log.error(
          {
            err: error,
            failed: 0,
            abandoned: candidates.length,
            lost: candidates.length,
            candidates: candidates.length,
            abandonedSample: candidates.slice(0, SAMPLE_SIZE).map(describe),
          },
          "création d'alerte en échec",
        );
        return 0;
      }
      // Un lot en échec ne doit pas emporter tout le passage : reprise objet par objet,
      // un seul journal récapitulatif (pas une ligne par candidate si la base est tombée).
      log.warn({ err: error, candidates: candidates.length }, "lot d'alertes en échec, reprise objet par objet");
      let created = 0;
      const failed: Array<{ title: string; type: string }> = [];
      let abandonedSample: Array<{ title: string; type: string }> = [];
      let firstError: unknown;
      let consecutiveFailures = 0;
      let abandoned = 0;
      for (const [index, candidate] of candidates.entries()) {
        try {
          created += await this.emitAlertBatch([candidate]);
          consecutiveFailures = 0;
        } catch (candidateError) {
          firstError ??= candidateError;
          failed.push({ title: candidate.title, type: candidate.type });
          consecutiveFailures += 1;
          // Coupe-circuit : base injoignable ou échecs en série, inutile d'insister
          // candidate par candidate ; le reste est compté comme perdu.
          if (isConnectionError(candidateError) || consecutiveFailures >= MAX_CONSECUTIVE_RETRY_FAILURES) {
            abandoned = candidates.length - index - 1;
            abandonedSample = candidates.slice(index + 1, index + 1 + SAMPLE_SIZE).map(describe);
            break;
          }
        }
      }
      if (failed.length > 0) {
        log.error(
          {
            err: firstError,
            failed: failed.length,
            abandoned,
            lost: failed.length + abandoned,
            candidates: candidates.length,
            sample: failed.slice(0, SAMPLE_SIZE),
            abandonedSample,
          },
          "création d'alerte en échec",
        );
      }
      return created;
    }
  }

  /** Un lot en une fois ; lève en cas d'échec (repli géré par emitAlerts). */
  private async emitAlertBatch(candidates: readonly AlertCandidate[]): Promise<number> {
    const byRole = await this.usersByRole([...new Set(candidates.flatMap((c) => c.targetRoles ?? []))]);

    const prepared = candidates.map((alertData) => {
      const explicit = (alertData.targetUserIds ?? []).filter(
        (id): id is number => typeof id === "number" && id > 0,
      );
      const tousLesDestinataires = Array.from(
        new Set([...(alertData.targetRoles ?? []).flatMap((role) => byRole.get(role) ?? []), ...explicit]),
      );
      // Retirer l'auteur du geste: personne n'a besoin qu'on lui annonce ce
      // qu'il vient de faire, et une alerte non lue de plus dilue les vraies.
      const recipients = alertData.excludeUserId
        ? tousLesDestinataires.filter((userId) => userId !== alertData.excludeUserId)
        : tousLesDestinataires;

      let link = alertData.link ?? "";
      if (!link) {
        if (alertData.vehicleId) link = `/vehicles/${alertData.vehicleId}`;
        else if (alertData.workOrderId) link = `/work-orders/${alertData.workOrderId}`;
        else if (alertData.maintenanceScheduleId) link = `/maintenance/schedules/${alertData.maintenanceScheduleId}`;
      }
      const dedupeKey =
        alertData.dedupeKey ??
        (alertData.remindDaily ? dailyReminderDedupeKey(alertData.type, alertData.title, link) : undefined);
      const topic: NotificationTopic = alertData.topic ?? alertData.type;
      return { alertData, recipients, link, dedupeKey, topic };
    });

    // Préférences (P-12): chacun peut couper un thème pour lui seul. Une requête par thème.
    const allowedByTopic = new Map<NotificationTopic, Set<number>>();
    for (const topic of new Set(prepared.map((p) => p.topic))) {
      const ids = [...new Set(prepared.filter((p) => p.topic === topic).flatMap((p) => p.recipients))];
      allowedByTopic.set(topic, new Set(await filterUsersByTopic(ids, topic)));
    }
    for (const p of prepared) {
      const allowed = allowedByTopic.get(p.topic)!;
      p.recipients = p.recipients.filter((userId) => allowed.has(userId));
    }

    const recipientIds = [...new Set(prepared.flatMap((p) => p.recipients))];
    if (recipientIds.length === 0) return 0;

    // Existant utile au dédoublonnage, en une requête : les clés du lot et les non lues
    // de mêmes titres. Remplace le chargement de toutes les alertes de chaque destinataire.
    const keys = [...new Set(prepared.flatMap((p) => (p.dedupeKey ? [p.dedupeKey] : [])))];
    const titles = [...new Set(prepared.map((p) => p.alertData.title))];
    const existing = await db
      .select({
        userId: alerts.userId,
        dedupeKey: alerts.dedupeKey,
        type: alerts.type,
        title: alerts.title,
        link: alerts.link,
        isRead: alerts.isRead,
      })
      .from(alerts)
      .where(
        and(
          anyInt(alerts.userId, recipientIds),
          or(
            keys.length > 0 ? anyText(alerts.dedupeKey, keys) : sql`false`,
            and(eq(alerts.isRead, false), anyText(alerts.title, titles)),
          ),
        ),
      );

    const takenKeys = new Set<string>(); // user|clé
    const unreadSame = new Set<string>(); // user|type|titre|lien
    const unreadSameAnyLink = new Set<string>(); // user|type|titre
    const remember = (userId: number, dedupeKey: string | null | undefined, unread: boolean, type: string, title: string, link: string | null | undefined) => {
      if (dedupeKey) takenKeys.add(`${userId}|${dedupeKey}`);
      if (unread) {
        unreadSame.add(`${userId}|${type}|${title}|${link ?? ""}`);
        unreadSameAnyLink.add(`${userId}|${type}|${title}`);
      }
    };
    for (const row of existing) {
      if (row.userId !== null) remember(row.userId, row.dedupeKey, !row.isRead, row.type, row.title, row.link);
    }

    const rows: Array<typeof alerts.$inferInsert> = [];
    for (const p of prepared) {
      for (const userId of p.recipients) {
        const blocked =
          (p.dedupeKey !== undefined && takenKeys.has(`${userId}|${p.dedupeKey}`)) ||
          (p.link
            ? unreadSame.has(`${userId}|${p.alertData.type}|${p.alertData.title}|${p.link}`)
            : unreadSameAnyLink.has(`${userId}|${p.alertData.type}|${p.alertData.title}`));
        if (blocked) continue;
        remember(userId, p.dedupeKey, true, p.alertData.type, p.alertData.title, p.link);
        rows.push({
          userId,
          title: p.alertData.title,
          message: p.alertData.message,
          type: p.alertData.type,
          priority: p.alertData.priority,
          link: p.link || undefined,
          topic: p.topic,
          ...(p.dedupeKey ? { dedupeKey: p.dedupeKey } : {}),
        });
      }
    }

    const created = await this.insertAlertRows(rows);
    const createdPerObject = new Map<string, number>(); // type|titre|lien
    for (const alert of created) {
      const objectKey = `${alert.type}|${alert.title}|${alert.link ?? ""}`;
      createdPerObject.set(objectKey, (createdPerObject.get(objectKey) ?? 0) + 1);
    }

    for (const [objectKey, createdCount] of createdPerObject) {
      const [type, title] = objectKey.split("|");
      log.info({ title, type, createdCount }, "alertes créées");
    }
    return created.length;
  }

  /**
   * Insertion par tranches, ON CONFLICT DO NOTHING sur uq_alerts_user_dedupe : un passage
   * concurrent qui a inséré entre la lecture et l'écriture gagne, sans erreur ni événement.
   * Une tranche en échec est rejouée ligne à ligne : un destinataire en échec (compte
   * supprimé entre-temps) ne prive pas les autres de l'alerte.
   */
  private async insertAlertRows(rows: Array<typeof alerts.$inferInsert>): Promise<Alert[]> {
    const created: Alert[] = [];
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const chunk = rows.slice(i, i + INSERT_CHUNK);
      try {
        created.push(...(await db.insert(alerts).values(chunk).onConflictDoNothing().returning()));
      } catch (chunkError) {
        log.warn({ err: chunkError, rows: chunk.length }, "insertion groupée d'alertes en échec, reprise ligne à ligne");
        for (const row of chunk) {
          try {
            created.push(...(await db.insert(alerts).values(row).onConflictDoNothing().returning()));
          } catch (error) {
            log.error({ err: error, userId: row.userId, dedupeKey: row.dedupeKey }, "alerte non créée pour un destinataire");
          }
        }
      }
    }
    // Couche 2 de la règle des 3 couches : sans cette trame, l'alerte n'apparaissait qu'au
    // prochain rafraîchissement. Portée nominative : une alerte concerne son destinataire.
    for (const alert of created) broadcastAlertCreated(alert);
    return created;
  }

  /**
   * Vérifie les alertes liées aux missions (retards de départ, retards de livraison)
   */
  async checkMissionAlerts(): Promise<void> {
    console.log("🚚 Vérification des alertes missions...");
    const now = new Date();

    // 1. Missions en retard au départ : planned/assigned, pickupDate < now, pas encore démarrées
    const overdueAtDeparture = await db
      .select({
        id: missions.id,
        orderNumber: missions.orderNumber,
        pickupDate: missions.pickupDate,
        deliveryDate: missions.deliveryDate,
        status: missions.status,
      })
      .from(missions)
      .where(
        and(
          inArray(missions.status, ["planned", "assigned"]),
          lt(missions.pickupDate, now),
        )
      );

    // Départs de toutes ces missions en une requête (#281), plutôt qu'une par mission.
    const starts = overdueAtDeparture.length
      ? await db
          .select({ missionId: assignments.missionId, startedAt: assignments.startedAt })
          .from(assignments)
          .where(anyInt(assignments.missionId, overdueAtDeparture.map((m) => m.id)))
      : [];
    const startsByMission = groupBy(starts, (row) => row.missionId);

    for (const mission of overdueAtDeparture) {
      // Mission pas encore lancée : aucune de ses affectations n'a de startedAt. Plusieurs chauffeurs
      // possibles : un seul départ suffit pour la dire lancée (une autre affectation encore sans départ
      // ne la rend pas en retard). Sans affectation, pas d'alerte non plus.
      const assignmentStarts = startsByMission.get(mission.id) ?? [];

      if (assignmentStarts.length === 0 || assignmentStarts.some((a) => a.startedAt !== null)) continue; // déjà démarrée

      const pickupDate = mission.pickupDate!;
      const delayMs = now.getTime() - new Date(pickupDate).getTime();
      const delayH = Math.floor(delayMs / 3600000);
      const delayMin = Math.floor((delayMs % 3600000) / 60000);
      const delayText = delayH > 0 ? `${delayH}h${delayMin > 0 ? ` ${delayMin}min` : ""}` : `${delayMin}min`;

      await this.createAlertIfNotExists({
        remindDaily: true,
        type: "mission",
        title: "Retard au départ",
        message: `Mission ${mission.orderNumber} — départ prévu dépassé de ${delayText}. Mission non encore lancée (statut: ${mission.status}).`,
        priority: delayH >= 24 ? "critical" : "high",
        link: `/missions/${mission.id}`,
        targetRoles: this.missionRecipients,
      });
    }

    // 2. Missions en retard à la livraison : in_progress, deliveryDate < now
    const overdueAtDelivery = await db
      .select({
        id: missions.id,
        orderNumber: missions.orderNumber,
        deliveryDate: missions.deliveryDate,
      })
      .from(missions)
      .where(
        and(
          eq(missions.status, "in_progress"),
          lt(missions.deliveryDate, now),
        )
      );

    for (const mission of overdueAtDelivery) {
      const delayMs = now.getTime() - new Date(mission.deliveryDate!).getTime();
      const delayH = Math.floor(delayMs / 3600000);
      const delayMin = Math.floor((delayMs % 3600000) / 60000);
      const delayText = delayH > 0 ? `${delayH}h${delayMin > 0 ? ` ${delayMin}min` : ""}` : `${delayMin}min`;

      await this.createAlertIfNotExists({
        remindDaily: true,
        type: "mission",
        title: "Retard à la livraison",
        message: `Mission ${mission.orderNumber} — livraison prévue dépassée de ${delayText}. Mission toujours en cours.`,
        priority: delayH >= 24 ? "critical" : "high",
        link: `/missions/${mission.id}`,
        targetRoles: this.missionRecipients,
      });
    }

    console.log(`✅ Alertes missions: ${overdueAtDeparture.length} retards départ, ${overdueAtDelivery.length} retards livraison vérifiés`);
  }

  /**
   * Lance toutes les vérifications d'alertes
   */
  async runAllAlertChecks(): Promise<void> {
    console.log("🚨 Démarrage vérification complète des alertes...");

    try {
      // Les candidates du passage sont émises en une fois (#281). Un contrôle en échec
      // n'empêche pas l'émission de celles déjà collectées.
      const batch: AlertCandidate[] = [];
      try {
        await pendingAlertBatch.run(batch, async () => {
          await this.checkVehicleAlerts();
          await this.checkWorkOrderAlerts();
          await this.checkMaintenanceScheduleAlerts();
          await this.checkFuelConsumptionAlerts();
          await this.checkMissionAlerts();
          await this.checkIncompleteSupplierAlerts();
          await this.checkTypedDocumentExpiryAlerts();
        });
      } finally {
        const created = await this.emitAlerts(batch);
        log.info({ candidates: batch.length, created }, "passage d'alertes émis");
      }

      console.log("✅ Vérification des alertes terminée");
    } catch (error) {
      console.error("❌ Erreur lors de la vérification des alertes:", error);
    }
  }
}

export const alertService = new AlertService();
