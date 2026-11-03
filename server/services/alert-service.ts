import type { NotificationTopic } from "@shared/contracts/notification-settings";
import { filterUsersByTopic } from "./notification-preferences-service";
import { storage } from "../storage";
import type { Vehicle, Alert } from "../../shared/schema";
import { db } from "../db";
import { alerts, missions, assignments, suppliers, vehicleDocuments, vehicleDocumentTypes, vehicles } from "../../shared/schema";
import { and, desc, inArray, isNull, lt, eq, isNotNull } from "drizzle-orm";
import { classifyDocumentExpiry, documentExpiryDedupeKey } from "./document-expiry-rule";
import { moduleLogger } from "../lib/logger";

const log = moduleLogger("alert-service");

/** Clé de rappel quotidien (ALR1) : même objet, même jour UTC = même alerte. */
export function dailyReminderDedupeKey(type: string, title: string, link: string, now: Date = new Date()): string {
  return `daily:${now.toISOString().slice(0, 10)}:${type}:${link}:${title}`;
}

type AlertRecipientRole =
  | "admin"
  | "workshop_manager"
  | "technician"
  | "secretary"
  | "logistics"
  | "warehouse";

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

  private async resolveRecipientUserIds(
    roles: AlertRecipientRole[] = [],
    explicitUserIds: number[] = []
  ): Promise<number[]> {
    const roleUsers = await Promise.all(roles.map((role) => storage.getUsersByRole(role)));
    const roleUserIds = roleUsers.flat().map((user) => user.id);

    return Array.from(
      new Set(
        [...roleUserIds, ...explicitUserIds].filter(
          (id): id is number => typeof id === "number" && id > 0
        )
      )
    );
  }
  
  /**
   * Vérifie toutes les alertes véhicules et crée les alertes manquantes
   */
  async checkVehicleAlerts(): Promise<void> {
    console.log("🔍 Vérification des alertes véhicules...");
    
    // Récupérer tous les véhicules
    const { vehicles } = await storage.getVehicles();
    const activeVehicles = vehicles.filter((v: Vehicle) => v.status !== 'out_of_service');

    for (const vehicle of activeVehicles) {
      await this.checkVehicleMaintenanceAlerts(vehicle);
      await this.checkVehicleDocumentAlerts(vehicle);
      await this.checkVehicleMileageAlerts(vehicle);
    }
  }

  /**
   * Vérifie toutes les alertes ordres de travail
   */
  async checkWorkOrderAlerts(): Promise<void> {
    console.log("🔍 Vérification des alertes ordres de travail...");
    
    const { workOrders } = await storage.getWorkOrders();
    const today = new Date();
    
    for (const wo of workOrders) {
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
    
    const { vehicles } = await storage.getVehicles();
    const today = new Date().toISOString().split('T')[0];
    
    for (const vehicle of vehicles) {
      const schedules = await storage.getMaintenanceSchedulesByVehicleId(vehicle.id);

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
  private async checkVehicleDocumentAlerts(vehicle: Vehicle): Promise<void> {
    const today = new Date();
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(today.getDate() + 30);

    const documents: Array<{
      field: "insuranceExpiry" | "technicalInspectionDate" | "licensePlateExpiry";
      name: string;
    }> = [
      { field: 'insuranceExpiry', name: 'Assurance' },
      { field: 'technicalInspectionDate', name: 'Contrôle technique' },
      { field: 'licensePlateExpiry', name: 'Plaque d\'immatriculation' }
    ];

    for (const doc of documents) {
      const expiryDate = vehicle[doc.field];
      if (!expiryDate) continue;

      const expiry = new Date(expiryDate);
      const daysUntilExpiry = Math.floor((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const renewalLink = await this.documentRenewalLink(vehicle.id, doc.documentType);

      // Document expiré
      if (expiry < today) {
        await this.createAlertIfNotExists({
          remindDaily: true,
          vehicleId: vehicle.id,
          type: 'maintenance',
          title: 'Document expiré',
          message: `Véhicule ${vehicle.registrationNumber} - ${doc.name} expirée depuis ${Math.abs(daysUntilExpiry)} jours`,
          priority: 'critical',
          link: renewalLink,
          entityType: 'vehicle_document',
          entityId: vehicle.id,
          targetRoles: this.maintenanceRecipients
        });

        // Papier expiré pendant une mission en cours : le chef de parc (logistique)
        // est prévenu. La mission n'est pas interrompue ; c'est l'éligibilité qui
        // refuse toute nouvelle affectation ou tout nouveau lancement.
        const missionEnCours = await this.findInProgressMission(vehicle.id);
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
      // Document expire dans les 30 jours
      else if (expiry <= thirtyDaysFromNow) {
        await this.createAlertIfNotExists({
          remindDaily: true,
          vehicleId: vehicle.id,
          type: 'maintenance',
          title: 'Document expire bientôt',
          message: `Véhicule ${vehicle.registrationNumber} - ${doc.name} expire dans ${daysUntilExpiry} jours`,
          priority: daysUntilExpiry <= 7 ? 'high' : 'medium',
          link: renewalLink,
          entityType: 'vehicle_document',
          entityId: vehicle.id,
          targetRoles: this.maintenanceRecipients
        });
      }
    }
  }

  /** Mission `in_progress` portée par une affectation de ce véhicule, s'il y en a une. */
  private async findInProgressMission(vehicleId: number): Promise<{ id: number; orderNumber: string | null } | null> {
    const [row] = await db
      .select({ id: missions.id, orderNumber: missions.orderNumber })
      .from(assignments)
      .innerJoin(missions, eq(assignments.missionId, missions.id))
      .where(and(eq(assignments.vehicleId, vehicleId), eq(missions.status, "in_progress")))
      .limit(1);
    return row ?? null;
  }

  /**
   * Lien de l'alerte vers la demande de renouvellement du document le plus récent
   * du type ; à défaut de document, la fiche véhicule.
   */
  private async documentRenewalLink(vehicleId: number, documentType: string): Promise<string> {
    const [doc] = await db
      .select({ id: vehicleDocuments.id })
      .from(vehicleDocuments)
      .where(and(eq(vehicleDocuments.vehicleId, vehicleId), eq(vehicleDocuments.type, documentType as never)))
      .orderBy(desc(vehicleDocuments.id))
      .limit(1);
    return doc
      ? `/vehicles/documents/renew?vehicleId=${vehicleId}&documentId=${doc.id}&source=alert`
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
          ? `Véhicule ${vehicleLabel} - ${row.name} expiré depuis ${Math.abs(days)} jour(s)`
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

    const { vehicles } = await storage.getVehicles();

    for (const vehicle of vehicles) {
      const fuelHistory = await storage.getFuelRecordsByVehicleId(vehicle.id);
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

        await this.createAlertIfNotExists({
          remindDaily: true,
          vehicleId: vehicle.id,
          type: 'fuel',
          title: 'Consommation carburant élevée',
          message: `Véhicule ${vehicle.registrationNumber} - Consommation +${excessPercent}% vs moyenne`,
          priority: excessPercent > 50 ? 'high' : 'medium',
          entityType: 'fuel_record',
          entityId: vehicle.id,
          targetRoles: this.fuelRecipients
        });
      }
    }
  }

  /**
   * Crée une alerte seulement si elle n'existe pas déjà
   */
  private async createAlertIfNotExists(alertData: {
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
  }): Promise<void> {
    try {
      const tousLesDestinataires = await this.resolveRecipientUserIds(
        alertData.targetRoles,
        (alertData.targetUserIds ?? []).filter(
          (id): id is number => typeof id === "number" && id > 0
        )
      );

      // Retirer l'auteur du geste: personne n'a besoin qu'on lui annonce ce
      // qu'il vient de faire, et une alerte non lue de plus dilue les vraies.
      const sansAuteur = alertData.excludeUserId
        ? tousLesDestinataires.filter((userId) => userId !== alertData.excludeUserId)
        : tousLesDestinataires;
      // Préférences (P-12): chacun peut couper un thème pour lui seul.
      const topic: NotificationTopic = alertData.topic ?? alertData.type;
      const recipientUserIds = await filterUsersByTopic(sansAuteur, topic);

      if (recipientUserIds.length === 0) {
        return;
      }

      let resolvedLink = alertData.link ?? '';
      if (!resolvedLink) {
        if (alertData.vehicleId) {
          resolvedLink = `/vehicles/${alertData.vehicleId}`;
        } else if (alertData.workOrderId) {
          resolvedLink = `/work-orders/${alertData.workOrderId}`;
        } else if (alertData.maintenanceScheduleId) {
          resolvedLink = `/maintenance/schedules/${alertData.maintenanceScheduleId}`;
        }
      }

      const dedupeKey =
        alertData.dedupeKey ??
        (alertData.remindDaily
          ? dailyReminderDedupeKey(alertData.type, alertData.title, resolvedLink)
          : undefined);

      for (const userId of recipientUserIds) {
        const candidateAlerts = dedupeKey
          ? await storage.getAlertsByUserId(userId)
          : await storage.getUnreadAlertsByUserId(userId);

        const existingAlert = candidateAlerts.find((alert) => {
          if (dedupeKey && alert.dedupeKey === dedupeKey) return true;
          const sameType = alert.type === alertData.type;
          const sameTitle = alert.title === alertData.title;
          const sameLink = resolvedLink ? alert.link === resolvedLink : true;
          // Une alerte non lue identique bloque toujours, quelle que soit sa clé :
          // celle d'hier (autre jour) comme celle d'avant la clé (dedupe_key NULL,
          // déploiement). Le rappel quotidien ne repart qu'une fois l'alerte lue.
          return !alert.isRead && sameType && sameTitle && sameLink;
        });

        if (existingAlert) {
          continue;
        }

        // Un destinataire en échec (compte supprimé entre-temps) ne doit pas
        // priver les autres de l'alerte.
        let created: Alert | undefined;
        try {
          // ON CONFLICT DO NOTHING sur uq_alerts_user_dedupe : un passage concurrent
          // qui a inséré entre la lecture et l'écriture gagne, sans erreur ni événement.
          [created] = await db
            .insert(alerts)
            .values({
              userId,
              title: alertData.title,
              message: alertData.message,
              type: alertData.type,
              priority: alertData.priority,
              link: resolvedLink || undefined,
              topic,
              ...(dedupeKey ? { dedupeKey } : {}),
            })
            .onConflictDoNothing()
            .returning();
        } catch (error) {
          log.error({ err: error, userId, dedupeKey }, "alerte non créée pour un destinataire");
          continue;
        }
        if (!created) continue;

        // Couche 2 de la règle des 3 couches: sans cet événement, l'alerte
        // n'apparaissait qu'au prochain rafraîchissement, sans rien signaler.
        // Scope `user`: une alerte est nominative, elle ne concerne pas tout le monde.
        const broadcastUpdate = (global as any).broadcastUpdate;
        if (typeof broadcastUpdate === "function" && created?.id) {
          broadcastUpdate("alert_created", {
            entity: "alert",
            entityId: created.id,
            payload: {
              alertId: created.id,
              userId,
              title: alertData.title,
              message: alertData.message,
              type: alertData.type,
              priority: alertData.priority,
              link: resolvedLink || null,
            },
            scope: { type: "user", userIds: [userId] },
          });
        }
      }

      console.log(`✅ Alerte créée: ${alertData.title}`);
    } catch (error) {
      console.error('Erreur création alerte:', error);
    }
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

    for (const mission of overdueAtDeparture) {
      // Vérifier qu'aucune assignment n'a de startedAt (mission pas encore lancée)
      const started = await db
        .select({ startedAt: assignments.startedAt })
        .from(assignments)
        .where(and(eq(assignments.missionId, mission.id), isNull(assignments.startedAt)))
        .limit(1);

      if (started.length === 0) continue; // mission déjà démarrée

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
      await this.checkVehicleAlerts();
      await this.checkWorkOrderAlerts();
      await this.checkMaintenanceScheduleAlerts();
      await this.checkFuelConsumptionAlerts();
      await this.checkMissionAlerts();
      await this.checkIncompleteSupplierAlerts();
      await this.checkTypedDocumentExpiryAlerts();

      console.log("✅ Vérification des alertes terminée");
    } catch (error) {
      console.error("❌ Erreur lors de la vérification des alertes:", error);
    }
  }
}

export const alertService = new AlertService();
