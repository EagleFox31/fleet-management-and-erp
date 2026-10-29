/**
 * Dictionnaire de messages d'erreur conviviales et explicites
 * Remplace les erreurs génériques par des textes clairs
 */

export const errorMessages: Record<string, string> = {
  // Validation formulaires
  'required': 'Ce champ est obligatoire',
  'email': 'Veuillez saisir une adresse email valide',
  'min_value': 'La valeur doit être supérieure à {value}',
  'max_value': 'La valeur doit être inférieure à {value}',
  'min_length': 'Minimum {length} caractères requis',
  'max_length': 'Maximum {length} caractères autorisés',
  'pattern': 'Format invalide pour ce champ',
  'unique': 'Cette valeur existe déjà',

  // Véhicules
  'vehicle_not_found': 'Véhicule non trouvé. Vérifiez l\'immatriculation',
  'invalid_mileage': 'Le kilométrage doit être supérieur au kilométrage précédent',
  'document_expired': 'Ce document a expiré',

  // Ordres de travail
  'work_order_locked': 'Cet ordre de travail est verrouillé',
  'invalid_status_transition': 'Transition de statut non autorisée',
  'no_technician_assigned': 'Veuillez assigner un technicien avant de démarrer',

  // Pièces & Stock
  'insufficient_stock': 'Stock insuffisant pour cette pièce',
  'part_not_found': 'Pièce non trouvée dans l\'inventaire',
  'negative_stock': 'Le stock ne peut pas être négatif',

  // Achats & Fournisseurs
  'supplier_not_found': 'Fournisseur non trouvé',
  'order_not_found': 'Commande non trouvée',
  'invoice_mismatch': 'Les montants de la facture ne correspondent pas à la commande',
  'quantity_mismatch': 'Les quantités reçues diffèrent de la commande',
  'delivery_code_required': 'Code de livraison requis',

  // Missions & Facturation
  'mission_not_found': 'Mission non trouvée',
  'invoice_already_generated': 'Une facture a déjà été générée pour cette mission',
  'invalid_amount': 'Montant invalide. Doit être supérieur à 0',
  'payment_exceeds_total': 'Le paiement dépasse le montant total',

  // Authentification
  'invalid_credentials': 'Identifiant ou mot de passe incorrect',
  'session_expired': 'Votre session a expiré. Veuillez vous reconnecter',
  'unauthorized': 'Vous n\'avez pas l\'autorisation pour cette action',
  'forbidden': 'Accès refusé',

  // Fichiers
  'file_too_large': 'Fichier trop volumineux (maximum {size})',
  'invalid_file_format': 'Format de fichier non autorisé',
  'import_failed': 'L\'importation a échoué. Vérifiez le fichier',

  // Réseau & Serveur
  'network_error': 'Connexion au serveur impossible. Vérifiez votre réseau puis réessayez',
  'server_error': 'Une erreur technique est survenue. Réessayez dans un instant',
  'timeout': 'Le serveur met trop de temps à répondre. Réessayez dans un instant',
  'not_found': 'L\'élément demandé n\'existe plus ou a été déplacé',
};

/**
 * Récupère un message d'erreur convivial
 * @param errorKey - Clé d'erreur ou message brut
 * @param params - Paramètres à substituer (ex: {value}, {length})
 * @returns Message d'erreur formaté
 */
export function getErrorMessage(
  errorKey: string,
  params?: Record<string, string | number>
): string {
  let message = errorMessages[errorKey] || errorKey;

  // Substituer les paramètres
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      message = message.replace(`{${key}}`, String(value));
    });
  }

  return message;
}

/**
 * Formate les erreurs de validation de formulaire
 */
export function formatValidationError(fieldName: string, errorType: string): string {
  const baseMessage = errorMessages[errorType] || 'Erreur de validation';

  // Messages contextuels par champ
  const contextMessages: Record<string, Record<string, string>> = {
    email: {
      required: 'Veuillez saisir une adresse email',
      pattern: 'Format email invalide (exemple: user@example.com)',
    },
    amount: {
      required: 'Veuillez saisir un montant',
      pattern: 'Montant invalide (utiliser le format numérique)',
      min_value: 'Le montant doit être supérieur à 0',
    },
    mileage: {
      required: 'Kilométrage obligatoire',
      pattern: 'Veuillez saisir un nombre valide',
      min_value: 'Le kilométrage doit être supérieur au précédent',
    },
  };

  return contextMessages[fieldName]?.[errorType] || baseMessage;
}
