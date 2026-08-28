import * as XLSX from 'xlsx';
import { companyInfo } from '@/components/layout/company-logo';

// Types de modèles disponibles
export enum TemplateType {
  VEHICLES = 'vehicles',
  MAINTENANCE = 'maintenance',
  PARTS = 'parts',
  FUEL_RECORDS = 'fuel_records',
}

// Interface pour les options de génération de modèles
interface TemplateOptions {
  includeExamples?: boolean;
}

// Fonction pour générer un modèle Excel téléchargeable
export function generateTemplate(type: TemplateType, options: TemplateOptions = {}): Blob {
  const workbook = XLSX.utils.book_new();
  
  // En-tête d'entreprise commune à tous les modèles
  const headerData = [
    [companyInfo.name],
    [`${companyInfo.address} - ${companyInfo.email}`],
    ["MODÈLE D'IMPORTATION"], 
    [], // Ligne vide pour l'espacement
  ];
  
  // Instructions d'utilisation
  const instructionsData = [
    ["INSTRUCTIONS D'UTILISATION:"],
    ["1. Ne modifiez pas les en-têtes des colonnes"],
    ["2. Les cellules marquées (*) sont obligatoires"],
    ["3. Respectez les formats indiqués entre parenthèses"],
    ["4. Pour mettre à jour des données existantes, conservez le même numéro d'immatriculation"],
    ["5. Laissez les cellules vides si vous n'avez pas l'information"],
    [],
  ];
  
  let columnHeaders: string[] = [];
  let exampleRows: any[][] = [];
  
  // Configurer les en-têtes et exemples selon le type de modèle
  switch (type) {
    case TemplateType.VEHICLES:
      columnHeaders = [
        'Immatriculation (*)',
        'Marque (*)',
        'Modèle (*)',
        'Type de véhicule (tracteur/porteur/semi_remorque/remorque/utilitaire/autre)',
        'Année (*)',
        'Kilométrage',
        'VIN',
        'Spécifications moteur',
        'Carburant (diesel/petrol/electric/hybrid/other)',
        'Date assurance (JJ/MM/AAAA)',
        'Date visite technique (JJ/MM/AAAA)',
        'Date expiration plaque (JJ/MM/AAAA)',
        'Statut (operational/maintenance/out_of_service)',
        'Notes'
      ];
      
      if (options.includeExamples) {
        exampleRows = [
          [
            'TG-1234-AB',
            'Mercedes',
            'Actros',
            'tracteur',
            '2022',
            '25000',
            'WMAT123456789',
            'Euro 6 - 480CV',
            'diesel',
            '31/12/2023',
            '15/06/2023',
            '01/01/2024',
            'operational',
            'Camion principal pour transport longue distance'
          ],
          [
            'TG-5678-CD',
            'Renault',
            'T-High',
            'tracteur',
            '2021',
            '35000',
            'VF617K56789123456',
            'Euro 6 - 520CV',
            'diesel',
            '15/10/2023',
            '30/05/2023',
            '01/11/2023',
            'maintenance',
            'En maintenance pour remplacement des freins'
          ],
        ];
      }
      break;
      
    case TemplateType.MAINTENANCE:
      // Configuration pour les planifications de maintenance
      columnHeaders = [
        'ID Véhicule (*)',
        'Immatriculation (*)',
        'Titre (*)',
        'Description',
        'Date prévue (JJ/MM/AAAA)',
        'Kilométrage prévu',
        'Fréquence (daily/weekly/monthly/quarterly/yearly/mileage)',
        'Valeur fréquence (*)',
        'Actif (true/false)'
      ];
      
      if (options.includeExamples) {
        exampleRows = [
          [
            '1',
            'TG-1234-AB',
            'Vidange moteur',
            'Vidange et remplacement filtre à huile',
            '15/08/2023',
            '30000',
            'mileage',
            '15000',
            'true'
          ],
          [
            '2',
            'TG-5678-CD',
            'Contrôle freins',
            'Vérification du système de freinage',
            '01/09/2023',
            '40000',
            'quarterly',
            '3',
            'true'
          ],
        ];
      }
      break;
      
    case TemplateType.PARTS:
      // Configuration pour les pièces détachées
      columnHeaders = [
        'Nom (*)',
        'Référence (*)',
        'Description',
        'Prix unitaire',
        'Quantité en stock',
        'Seuil minimum',
        'Emplacement',
        'Fournisseur',
        'Catégorie'
      ];
      
      if (options.includeExamples) {
        exampleRows = [
          [
            'Filtre à huile',
            'FH-MERC-123',
            'Filtre à huile pour Mercedes Actros',
            '45.50',
            '10',
            '3',
            'Étagère A-12',
            'Pièces Auto Plus',
            'Filtration'
          ],
          [
            'Plaquettes de frein',
            'PF-REN-456',
            'Plaquettes de frein avant pour Renault T-High',
            '120.75',
            '4',
            '2',
            'Étagère B-05',
            'Frein Express',
            'Freinage'
          ],
        ];
      }
      break;
      
    case TemplateType.FUEL_RECORDS:
      // Configuration pour les enregistrements de carburant
      columnHeaders = [
        'ID Véhicule (*)',
        'Immatriculation (*)',
        'Date (JJ/MM/AAAA) (*)',
        'Litres (*)',
        'Coût (*)',
        'Kilométrage (*)',
        'Station',
        'Notes'
      ];
      
      if (options.includeExamples) {
        exampleRows = [
          [
            '1',
            'TG-1234-AB',
            '10/07/2023',
            '250.5',
            '350000',
            '28500',
            'Total Aéroport',
            'Plein complet'
          ],
          [
            '2',
            'TG-5678-CD',
            '12/07/2023',
            '200.0',
            '280000',
            '38200',
            'Shell Autoroute',
            'Prix élevé mais urgence'
          ],
        ];
      }
      break;
      
    default:
      throw new Error(`Type de modèle non supporté: ${type}`);
  }
  
  // Créer les données complètes (en-tête + instructions + en-têtes de colonne + exemples)
  const data = [
    ...headerData,
    ...instructionsData,
    columnHeaders,
    ...(options.includeExamples ? exampleRows : [])
  ];
  
  // Créer la feuille de calcul
  const worksheet = XLSX.utils.aoa_to_sheet(data);
  
  // Ajouter des styles (fusionner les cellules d'en-tête)
  worksheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: columnHeaders.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: columnHeaders.length - 1 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: columnHeaders.length - 1 } },
    { s: { r: 4, c: 0 }, e: { r: 4, c: columnHeaders.length - 1 } },
    { s: { r: 5, c: 0 }, e: { r: 5, c: columnHeaders.length - 1 } },
    { s: { r: 6, c: 0 }, e: { r: 6, c: columnHeaders.length - 1 } },
    { s: { r: 7, c: 0 }, e: { r: 7, c: columnHeaders.length - 1 } },
    { s: { r: 8, c: 0 }, e: { r: 8, c: columnHeaders.length - 1 } },
  ];
  
  // Ajouter la feuille de calcul au workbook
  XLSX.utils.book_append_sheet(workbook, worksheet, `Modèle ${type}`);
  
  // Convertir le workbook en ArrayBuffer puis en Blob
  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  
  return new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// Fonction pour télécharger le modèle généré
export function downloadTemplate(type: TemplateType, options: TemplateOptions = {}): void {
  try {
    const templateData = generateTemplate(type, options);
    const url = URL.createObjectURL(templateData);
    const link = document.createElement('a');
    
    // Définir le nom du fichier selon le type
    let filename = '';
    switch (type) {
      case TemplateType.VEHICLES:
        filename = 'modele_import_vehicules.xlsx';
        break;
      case TemplateType.MAINTENANCE:
        filename = 'modele_import_maintenance.xlsx';
        break;
      case TemplateType.PARTS:
        filename = 'modele_import_pieces.xlsx';
        break;
      case TemplateType.FUEL_RECORDS:
        filename = 'modele_import_carburant.xlsx';
        break;
    }
    
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (error) {
    console.error('Erreur lors du téléchargement du modèle:', error);
    throw error;
  }
}