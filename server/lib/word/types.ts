/**
 * Donnees d'entree des documents Word d'un ordre de travail (P-06).
 * Le generateur n'accede pas a la base : l'appelant (route T-24) charge et
 * convertit les lignes en cet objet. Les montants sont deja des nombres.
 */
export interface WorkOrderDocLine {
  label: string;
  technicianName?: string | null;
  estimatedHours?: number | null;
  actualHours?: number | null;
  status?: string | null;
  notes?: string | null;
}

export interface WorkOrderDocPart {
  reference: string;
  name: string;
  quantity: number;
  unitPrice?: number | null;
}

export interface WorkOrderDocData {
  id: number;
  title: string;
  description?: string | null;
  diagnosis?: string | null;
  statusLabel: string;
  priorityLabel: string;
  vehicle: {
    registration?: string | null;
    brand?: string | null;
    model?: string | null;
  };
  technicianName?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  lines: WorkOrderDocLine[];
  parts: WorkOrderDocPart[];
  /** Date d'edition du document. */
  generatedAt: Date;
  /** Nom de la personne qui edite le document. */
  generatedByName?: string | null;
}

/** En-tete de societe, remplacable (D-12). */
export interface DocHeaderConfig {
  companyName: string;
  tagline?: string;
  /** Image PNG du papier a en-tete officiel. Absente : repli texte (nom et ligne de presentation). */
  logo?: Buffer | null;
}
