// Workflow de gestion des statuts des demandes de pièces
// Basé sur les meilleures pratiques de séparation des tâches (contrôle interne)

import { PART_REQUIREMENT_STATUS_LABELS } from "@shared/constants/part-requirements";

export type PartRequirementStatus =
  | 'pending'            // En attente d'approbation
  | 'approved'           // Approuvée par le chef d'atelier/admin
  | 'rejected'           // Rejetée par le chef d'atelier/admin
  | 'ordered'            // Commandée auprès du fournisseur (par magasinier)
  | 'partially_received' // Réception partielle en magasin
  | 'received'           // Réception totale en magasin
  | 'issued'             // Pièce sortie du stock pour un technicien/OT
  | 'fulfilled'          // Pièce installée, OT clôturé
  | 'cancel_requested'   // Demande d'annulation (après commande)
  | 'cancelled'          // Annulée
  | 'partial'            // Rétrocompatibilité: Livraison partielle (ancien)
  | 'delivered';         // Rétrocompatibilité: Livrée (ancien)

// Définition des transitions autorisées
const STATUS_TRANSITIONS: Record<PartRequirementStatus, PartRequirementStatus[]> = {
  'pending': ['approved', 'rejected', 'cancelled'],
  'approved': ['ordered', 'cancelled'],
  'rejected': [], // État final
  'ordered': ['partially_received', 'received', 'cancel_requested'],
  'partially_received': ['received', 'cancel_requested'],
  'received': ['issued'],
  'issued': [], // État final - la sortie de stock termine le processus
  'fulfilled': [], // État final (rétrocompatibilité uniquement)
  'cancel_requested': ['cancelled', 'approved'], // Retour à approved si annulation refusée (reprend le cycle)
  'cancelled': [],  // État final
  // Rétrocompatibilité : anciens statuts vers nouveaux
  'partial': ['received', 'cancelled'],  // Ancien statut -> received
  'delivered': ['issued']   // Ancien statut -> issued (fin du processus)
};

// Labels en français pour l'interface.
// Source unique: `shared/constants/part-requirements.ts`. Ne pas redéclarer ici,
// les deux tables avaient déjà divergé (ex: `fulfilled` "Installée" vs "Utilisée").
export const STATUS_LABELS: Record<PartRequirementStatus, string> =
  PART_REQUIREMENT_STATUS_LABELS;

// Couleurs pour l'interface
export const STATUS_COLORS: Record<PartRequirementStatus, string> = {
  'pending': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  'approved': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  'rejected': 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  'ordered': 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  'partially_received': 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  'received': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  'issued': 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
  'fulfilled': 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
  'cancel_requested': 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  'cancelled': 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  'partial': 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  'delivered': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
};

// Icônes pour chaque statut
export const STATUS_ICONS: Record<PartRequirementStatus, string> = {
  'pending': 'clock',
  'approved': 'check-circle',
  'rejected': 'x-circle',
  'ordered': 'package',
  'partially_received': 'truck',
  'received': 'archive',
  'issued': 'log-out',
  'fulfilled': 'check-square',
  'cancel_requested': 'alert-triangle',
  'cancelled': 'x-circle',
  'partial': 'truck',
  'delivered': 'archive'
};

// Rôles autorisés pour chaque transition
// Séparation des tâches : évite qu'une même personne demande, valide, commande et réceptionne
export const STATUS_PERMISSIONS: Record<PartRequirementStatus, Partial<Record<PartRequirementStatus, string[]>>> = {
  'pending': {
    // Validation : Chef d'atelier, Secrétaire ou Admin (pas le demandeur si possible)
    'approved': ['admin', 'workshop_manager', 'secretary'],
    'rejected': ['admin', 'workshop_manager', 'secretary'],
    // Annulation simple avant approbation : tout le monde peut
    'cancelled': ['admin', 'workshop_manager', 'technician']
  },
  'approved': {
    // Commande : Magasinier + Secrétaire (flux standard), Admin en backup
    'ordered': ['admin', 'warehouse', 'secretary'],
    // Annulation après approbation : Admin ou Chef d'atelier
    'cancelled': ['admin', 'workshop_manager']
  },
  'rejected': {},
  'ordered': {
    // Réception : Magasinier primaire, Secrétaire/Admin en backup
    'partially_received': ['admin', 'warehouse', 'secretary'],
    'received': ['admin', 'warehouse', 'secretary'],
    // Demande d'annulation après commande : Admin ou Chef d'atelier
    'cancel_requested': ['admin', 'workshop_manager']
  },
  'partially_received': {
    // Compléter la réception : Magasinier primaire, Secrétaire/Admin en backup
    'received': ['admin', 'warehouse', 'secretary'],
    // Demande d'annulation : Admin ou Chef d'atelier
    'cancel_requested': ['admin', 'workshop_manager']
  },
  'received': {
    // Sortie stock : Magasinier uniquement (le technicien récupère, ne fait pas la transaction)
    'issued': ['admin', 'warehouse']
  },
  'issued': {}, // État final - plus de transition
  'fulfilled': {}, // Rétrocompatibilité uniquement
  'cancel_requested': {
    // Décision finale sur l'annulation : Admin
    'cancelled': ['admin'],
    // Refus de l'annulation, retour à approved pour reprendre le cycle : Admin
    'approved': ['admin']
  },
  'cancelled': {},
  // Rétrocompatibilité : anciens statuts
  'partial': {
    'received': ['admin', 'warehouse', 'secretary'],
    'cancelled': ['admin', 'workshop_manager']
  },
  'delivered': {
    'issued': ['admin', 'warehouse']
  }
};

// Description des actions pour chaque transition
export const TRANSITION_DESCRIPTIONS: Record<string, string> = {
  'pending_approved': 'Valider la demande de pièce',
  'pending_rejected': 'Rejeter la demande de pièce',
  'pending_cancelled': 'Annuler la demande',
  'approved_ordered': 'Passer la commande au fournisseur',
  'approved_cancelled': 'Annuler la demande approuvée',
  'ordered_partially_received': 'Enregistrer une réception partielle',
  'ordered_received': 'Enregistrer la réception complète',
  'ordered_cancel_requested': 'Demander l\'annulation de la commande',
  'partially_received_received': 'Compléter la réception',
  'partially_received_cancel_requested': 'Demander l\'annulation de la commande',
  'received_issued': 'Sortir la pièce du stock',
  'issued_fulfilled': 'Confirmer l\'utilisation de la pièce',
  'cancel_requested_cancelled': 'Confirmer l\'annulation',
  'cancel_requested_ordered': 'Refuser l\'annulation et maintenir la commande'
};

// Rôle responsable pour chaque étape
export const STATUS_RESPONSIBLE: Record<PartRequirementStatus, string> = {
  'pending': 'Chef d\'atelier / Secrétaire / Admin',
  'approved': 'Magasinier / Secrétaire',
  'rejected': '-',
  'ordered': 'Magasinier / Secrétaire',
  'partially_received': 'Magasinier / Secrétaire',
  'received': 'Magasinier / Secrétaire',
  'issued': 'Technicien',
  'fulfilled': '-',
  'cancel_requested': 'Admin',
  'cancelled': '-',
  'partial': 'Magasinier (migration)',
  'delivered': 'Magasinier (migration)'
};

export class PartRequirementWorkflow {
  /**
   * Vérifie si une transition de statut est autorisée
   */
  static isTransitionAllowed(
    currentStatus: PartRequirementStatus, 
    newStatus: PartRequirementStatus
  ): boolean {
    const allowedTransitions = STATUS_TRANSITIONS[currentStatus] || [];
    return allowedTransitions.includes(newStatus);
  }

  /**
   * Vérifie si un utilisateur a le droit de faire une transition
   */
  static isUserAuthorized(
    currentStatus: PartRequirementStatus,
    newStatus: PartRequirementStatus,
    userRole: string
  ): boolean {
    const statusPerms = STATUS_PERMISSIONS[currentStatus] || {};
    const transitionPerms = statusPerms[newStatus] || [];
    return transitionPerms.includes(userRole);
  }

  /**
   * Retourne les statuts suivants possibles pour un statut donné
   */
  static getNextPossibleStatuses(
    currentStatus: PartRequirementStatus,
    userRole: string
  ): PartRequirementStatus[] {
    const allowedTransitions = STATUS_TRANSITIONS[currentStatus] || [];
    
    return allowedTransitions.filter(nextStatus => 
      this.isUserAuthorized(currentStatus, nextStatus, userRole)
    );
  }

  /**
   * Retourne toutes les informations d'un statut
   */
  static getStatusInfo(status: PartRequirementStatus) {
    return {
      status,
      label: STATUS_LABELS[status],
      color: STATUS_COLORS[status],
      icon: STATUS_ICONS[status],
      responsible: STATUS_RESPONSIBLE[status],
      possibleTransitions: STATUS_TRANSITIONS[status] || []
    };
  }

  /**
   * Dérogation de sortie de stock — chemin d'exception, volontairement séparé.
   *
   * La règle normale reste inchangée: seuls `admin` et `warehouse` sortent une
   * pièce du stock (`STATUS_PERMISSIONS`). Élargir cette table au chef
   * d'atelier aurait dilué la règle — on ne saurait plus distinguer une sortie
   * ordinaire d'une sortie d'exception.
   *
   * Ici on nomme l'exception: le chef d'atelier peut ouvrir le magasin quand
   * personne n'est là (soir, week-end), à condition d'écrire pourquoi. Le motif
   * est journalisé, et son usage se compte: si le compteur s'emballe, la réponse
   * est une astreinte magasin, pas une règle logicielle de plus.
   *
   * Ne couvre QUE le cas « la pièce est reçue, il manque la clé ». Une demande
   * non approuvée ne se sort pas par dérogation: il y manque une décision, pas
   * une clé.
   */
  static readonly OVERRIDE_ISSUE_ROLES = ['admin', 'workshop_manager'];

  /** Longueur minimale du motif: assez pour forcer une phrase, pas un « ok ». */
  static readonly OVERRIDE_REASON_MIN_LENGTH = 10;

  static validateOverrideIssue(
    userRole: string,
    reason: string | undefined | null,
  ): { valid: boolean; error?: string } {
    if (!this.OVERRIDE_ISSUE_ROLES.includes(userRole)) {
      return {
        valid: false,
        error:
          "Sortie exceptionnelle réservée au chef d'atelier. " +
          "Le technicien demande la pièce, il ne la sort pas lui-même.",
      };
    }

    const motif = (reason || '').trim();
    if (motif.length < this.OVERRIDE_REASON_MIN_LENGTH) {
      return {
        valid: false,
        error:
          'Motif obligatoire pour une sortie exceptionnelle ' +
          `(${this.OVERRIDE_REASON_MIN_LENGTH} caractères minimum).`,
      };
    }

    return { valid: true };
  }

  /**
   * Valide une transition et retourne un message d'erreur si elle n'est pas autorisée
   * Paramètres optionnels pour la séparation des tâches :
   * - requesterId : ID du demandeur original de la pièce
   * - currentUserId : ID de l'utilisateur qui tente la transition
   */
  static validateTransition(
    currentStatus: PartRequirementStatus,
    newStatus: PartRequirementStatus,
    userRole: string,
    options?: {
      requesterId?: number;
      currentUserId?: number;
      requesterRole?: string;
    }
  ): { valid: boolean; error?: string } {
    // Vérifier si la transition est logiquement autorisée
    if (!this.isTransitionAllowed(currentStatus, newStatus)) {
      return {
        valid: false,
        error: `Transition de "${STATUS_LABELS[currentStatus]}" vers "${STATUS_LABELS[newStatus]}" non autorisée`
      };
    }

    // Vérifier si l'utilisateur a les permissions
    if (!this.isUserAuthorized(currentStatus, newStatus, userRole)) {
      return {
        valid: false,
        error: `Vous n'avez pas les permissions pour changer le statut vers "${STATUS_LABELS[newStatus]}"`
      };
    }

    // Transitions sensibles nécessitant une vérification stricte du magasinier/admin
    // Cela inclut les statuts legacy (partial, delivered)
    const sensibleTransitions = ['approved', 'rejected', 'issued', 'received', 'fulfilled', 'cancelled'];
    const legacyStatuses = ['partial', 'delivered'];
    
    // Pour les transitions vers des états sensibles depuis des statuts legacy,
    // vérifier que seul le magasinier ou admin peut le faire
    if (legacyStatuses.includes(currentStatus) && sensibleTransitions.includes(newStatus)) {
      if (userRole !== 'admin' && userRole !== 'warehouse') {
        return {
          valid: false,
          error: 'Seul le magasinier ou l\'administrateur peut finaliser les transitions depuis un statut ancien'
        };
      }
    }

    // Pour les transitions sensibles, EXIGER que requesterId ET currentUserId soient fournis
    // Cela bloque les appels sans contexte utilisateur complet
    const requiresIdentityCheck = sensibleTransitions.includes(newStatus);
    
    if (requiresIdentityCheck) {
      // Admin peut bypass les contrôles d'identité en cas d'urgence
      const isAdmin = userRole === 'admin';
      
      // Vérifier que les DEUX identifiants sont présents (pas juste un des deux)
      const hasRequesterId = options?.requesterId !== undefined && options?.requesterId !== null;
      const hasCurrentUserId = options?.currentUserId !== undefined && options?.currentUserId !== null;
      const hasBothIds = hasRequesterId && hasCurrentUserId;
      
      // Bloquer si l'un ou l'autre identifiant est manquant (sauf admin)
      if (!hasBothIds && !isAdmin) {
        return {
          valid: false,
          error: 'Identifiants utilisateur requis pour cette transition (sécurité)'
        };
      }
      
      // Si les IDs sont fournis, appliquer les contrôles de séparation des tâches
      if (hasBothIds) {
        const sameUser = options!.requesterId === options!.currentUserId;

        // Cas métier spécifique: si la demande vient d'un chef d'atelier,
        // seule la secrétaire valide/rejette l'étape pending.
        if (
          currentStatus === 'pending' &&
          (newStatus === 'approved' || newStatus === 'rejected') &&
          options?.requesterRole === 'workshop_manager' &&
          userRole !== 'secretary'
        ) {
          return {
            valid: false,
            error: 'Cette demande a été créée par un chef d’atelier: la validation/rejet doit être faite par la secrétaire'
          };
        }
        
        // Empêcher toute auto-validation/auto-rejet par le demandeur
        if (sameUser && (newStatus === 'approved' || newStatus === 'rejected')) {
          return {
            valid: false,
            error: 'Séparation des tâches : vous ne pouvez pas approuver/rejeter votre propre demande'
          };
        }
        
        // Empêcher le demandeur d'annuler sa propre demande après commande
        if (sameUser && newStatus === 'cancelled' && currentStatus === 'cancel_requested') {
          if (!isAdmin) {
            return {
              valid: false,
              error: 'Séparation des tâches : la décision d\'annulation doit être validée par un administrateur'
            };
          }
        }
        
        // Empêcher un technicien (demandeur) de sortir ses propres pièces sans validation du magasinier
        // Cela s'applique aussi aux transitions depuis les statuts legacy
        if (sameUser && userRole === 'technician' && ['issued', 'received'].includes(newStatus)) {
          return {
            valid: false,
            error: 'Séparation des tâches : la sortie de stock doit être validée par le magasinier'
          };
        }
      }
    }

    return { valid: true };
  }

  /**
   * Retourne la description d'une transition
   */
  static getTransitionDescription(
    currentStatus: PartRequirementStatus,
    newStatus: PartRequirementStatus
  ): string {
    const key = `${currentStatus}_${newStatus}`;
    return TRANSITION_DESCRIPTIONS[key] || `Passer de ${STATUS_LABELS[currentStatus]} à ${STATUS_LABELS[newStatus]}`;
  }

  /**
   * Vérifie si un statut est un état final
   */
  static isFinalStatus(status: PartRequirementStatus): boolean {
    return ['issued', 'fulfilled', 'cancelled', 'rejected'].includes(status);
  }

  /**
   * Vérifie si un statut représente une demande active (en cours)
   */
  static isActiveStatus(status: PartRequirementStatus): boolean {
    return !this.isFinalStatus(status);
  }

  /**
   * Retourne tous les statuts groupés par phase
   */
  static getStatusesByPhase() {
    return {
      demande: ['pending', 'approved', 'rejected'] as PartRequirementStatus[],
      commande: ['ordered', 'cancel_requested'] as PartRequirementStatus[],
      reception: ['partially_received', 'received'] as PartRequirementStatus[],
      sortie: ['issued'] as PartRequirementStatus[],
      terminal: ['issued', 'rejected', 'cancelled'] as PartRequirementStatus[]
    };
  }
}
