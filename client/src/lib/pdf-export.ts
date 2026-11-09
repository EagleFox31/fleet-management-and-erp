import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import headerImage from '@assets/TAY-header-final.png';
import { fetchAllWorkOrders, ReportRefusedError } from '@/lib/fetch-all-work-orders';
import { fetchAllVehicles, fetchFuelRecords } from '@/lib/fetch-all-pages';
import { clientLogger } from '@/lib/logger';

// Configuration de l'en-tête officiel
const COMPANY_INFO = {
  name_fr: "Société de Transport ABOUBAKAR Yaroro",
  name_en: "ABOUBAKAR Yaroro Transport Company",
  address: "BP 14871 Yaoundé",
  address_en: "P.O. Box 14871, Yaoundé",
  email: "etsyaroro.logistique@gmail.com",
};

export interface PDFExportOptions {
  title: string;
  subtitle?: string;
  data: any[];
  columns: { header: string; dataKey: string; width?: number }[];
  filename?: string;
  orientation?: 'portrait' | 'landscape';
  showDate?: boolean;
}

export class PDFExporter {
  private doc: jsPDF;

  constructor(orientation: 'portrait' | 'landscape' = 'portrait') {
    this.doc = new jsPDF({
      orientation,
      unit: 'mm',
      format: 'a4'
    });
  }

  private addHeader() {
    const pageWidth = this.doc.internal.pageSize.width;
    
    // Ajouter votre image d'en-tête officielle
    try {
      // Dimensions de votre en-tête final : 1067x236 pixels
      // Conversion pixels vers mm (72 DPI standard)
      const pixelToMm = 25.4 / 72; // 1 pixel = 0.353 mm
      const headerWidth = 1067 * pixelToMm * 0.4; // Ajusté pour taille optimale
      const headerHeight = 236 * pixelToMm * 0.4; // Proportions respectées
      
      // Centrer horizontalement sur la page
      const headerX = (pageWidth - headerWidth) / 2;
      const headerY = 10; // Position Y depuis le haut
      
      // Ajouter l'image convertie de votre PDF original avec les bonnes proportions
      this.doc.addImage(headerImage, 'PNG', headerX, headerY, headerWidth, headerHeight);
      
      // Ligne horizontale sous l'en-tête pour séparer du contenu
      this.doc.setLineWidth(0.5);
      this.doc.line(15, headerY + headerHeight + 5, pageWidth - 15, headerY + headerHeight + 5);
      
      return headerY + headerHeight + 15; // Position Y après l'en-tête
    } catch (error) {
      clientLogger.error("Image d'en-tête du PDF non chargée, repli sur le texte", { err: error });
      
      // Fallback en cas d'erreur : utiliser le texte
      this.doc.setFontSize(14);
      this.doc.setFont("helvetica", 'bold');
      this.doc.text(COMPANY_INFO.name_fr, pageWidth / 2, 20, { align: 'center' });
      
      this.doc.setFontSize(10);
      this.doc.setFont("helvetica", 'normal');
      this.doc.text(COMPANY_INFO.address, pageWidth / 2, 30, { align: 'center' });
      this.doc.text(COMPANY_INFO.email, pageWidth / 2, 40, { align: 'center' });
      
      this.doc.setLineWidth(0.5);
      this.doc.line(15, 45, pageWidth - 15, 45);
      
      return 55;
    }
  }

  private addFooter() {
    const pageWidth = this.doc.internal.pageSize.width;
    const pageHeight = this.doc.internal.pageSize.height;
    
    // Ligne horizontale avant le pied de page
    this.doc.setLineWidth(0.3);
    this.doc.line(15, pageHeight - 20, pageWidth - 15, pageHeight - 20);
    
    // Informations du pied de page
    this.doc.setFontSize(8);
    this.doc.setFont("helvetica", 'normal');
    
    const currentDate = new Date().toLocaleDateString('fr-FR');
    this.doc.text(`Document généré le ${currentDate}`, 15, pageHeight - 10);
    
    // Numéro de page
    const pageNumber = this.doc.getCurrentPageInfo().pageNumber;
    this.doc.text(`Page ${pageNumber}`, pageWidth - 15, pageHeight - 10, { align: 'right' });
  }

  exportTable(options: PDFExportOptions) {
    // Ajouter l'en-tête
    let startY = this.addHeader();
    
    // Trait de séparation après l'en-tête
    this.doc.setDrawColor(0, 0, 0);
    this.doc.setLineWidth(0.5);
    this.doc.line(20, startY, this.doc.internal.pageSize.width - 20, startY);
    startY += 15;
    
    // Titre du document - centré
    this.doc.setFontSize(16);
    this.doc.setFont("helvetica", 'bold');
    const titleWidth = this.doc.getTextWidth(options.title);
    const pageWidth = this.doc.internal.pageSize.getWidth();
    this.doc.text(options.title, (pageWidth - titleWidth) / 2, startY);
    
    startY += 15;
    
    // Sous-titre si présent
    if (options.subtitle) {
      this.doc.setFontSize(12);
      this.doc.setFont("helvetica", 'normal');
      const subtitleWidth = this.doc.getTextWidth(options.subtitle);
      this.doc.text(options.subtitle, (pageWidth - subtitleWidth) / 2, startY + 5);
      startY += 15;
    }
    
    // Date du rapport si demandée
    if (options.showDate) {
      this.doc.setFontSize(10);
      this.doc.setFont("helvetica", 'normal');
      const currentDate = new Date().toLocaleDateString('fr-FR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      const dateText = `Rapport du ${currentDate}`;
      const dateWidth = this.doc.getTextWidth(dateText);
      this.doc.text(dateText, (pageWidth - dateWidth) / 2, startY + 5);
      startY += 15;
    }
    
    // Préparer les données pour le tableau
    const tableColumns = options.columns.map(col => col.header);
    const tableRows = options.data.map(row => 
      options.columns.map(col => {
        const value = row[col.dataKey];
        if (value === null || value === undefined) return '';
        if (typeof value === 'number' && col.dataKey.includes('price') || col.dataKey.includes('cost')) {
          return new Intl.NumberFormat('fr-FR', {
            style: 'currency',
            currency: 'XAF'
          }).format(value);
        }
        return String(value);
      })
    );
    
    // Générer le tableau avec autoTable
    autoTable(this.doc, {
      head: [tableColumns],
      body: tableRows,
      startY: startY + 10,
      styles: {
        fontSize: 9,
        cellPadding: 3,
      },
      headStyles: {
        fillColor: [41, 128, 185], // Bleu professionnel
        textColor: 255,
        fontStyle: 'bold',
      },
      alternateRowStyles: {
        fillColor: [245, 245, 245],
      },
      margin: { left: 15, right: 15 },
      didDrawPage: () => {
        this.addFooter();
      }
    });
    
    // Télécharger le PDF
    const filename = options.filename || `${options.title.replace(/\s+/g, '_')}_${Date.now()}.pdf`;
    this.doc.save(filename);
  }

  exportDetails(title: string, subtitle: string, sections: { title: string; data: { [key: string]: any } }[], filename?: string) {
    // Ajouter l'en-tête
    let startY = this.addHeader();
    
    // Titre du document
    this.doc.setFontSize(16);
    this.doc.setFont("helvetica", 'bold');
    this.doc.text(title, this.doc.internal.pageSize.width / 2, startY + 15, { align: 'center' });
    
    // Sous-titre
    this.doc.setFontSize(12);
    this.doc.setFont("helvetica", 'normal');
    this.doc.text(subtitle, this.doc.internal.pageSize.width / 2, startY + 25, { align: 'center' });
    
    startY += 40;
    
    // Générer les sections
    sections.forEach((section, index) => {
      // Vérifier si on a assez de place sur la page
      if (startY > 250) {
        this.doc.addPage();
        startY = 20;
      }
      
      // Titre de section
      this.doc.setFontSize(14);
      this.doc.setFont("helvetica", 'bold');
      this.doc.text(section.title, 20, startY);
      startY += 10;
      
      // Données de la section
      this.doc.setFontSize(10);
      this.doc.setFont("helvetica", 'normal');
      
      Object.entries(section.data).forEach(([key, value]) => {
        if (startY > 270) {
          this.doc.addPage();
          startY = 20;
        }
        
        let displayValue = String(value || '');
        
        // Formatage spécial pour les prix/coûts
        if (typeof value === 'number' && (key.includes('price') || key.includes('cost') || key.includes('Prix') || key.includes('Coût'))) {
          displayValue = new Intl.NumberFormat('fr-FR', {
            style: 'currency',
            currency: 'XAF'
          }).format(value);
        }
        
        this.doc.text(`${key}: ${displayValue}`, 25, startY);
        startY += 6;
      });
      
      startY += 10; // Espacement entre sections
    });
    
    // Ajouter le pied de page
    this.addFooter();
    
    // Télécharger le PDF
    const defaultFilename = `${title.replace(/\s+/g, '_')}_${Date.now()}.pdf`;
    this.doc.save(filename || defaultFilename);
  }
}

// Fonctions d'export spécialisées
export const exportInventoryToPDF = (parts: any[]) => {
  const exporter = new PDFExporter();
  
  exporter.exportTable({
    title: 'Inventaire des Pièces Détachées',
    subtitle: 'Liste complète du stock des pièces',
    showDate: true,
    data: parts,
    columns: [
      { header: 'Référence', dataKey: 'reference' },
      { header: 'Nom', dataKey: 'name' },
      { header: 'Quantité', dataKey: 'quantity' },
      { header: 'Seuil min.', dataKey: 'minQuantity' },
      { header: 'Prix unitaire', dataKey: 'unitPrice' },
      { header: 'Emplacement', dataKey: 'location' },
      { header: 'Fournisseur', dataKey: 'supplier' },
    ],
    filename: 'Inventaire_Pieces_Detachees.pdf'
  });
};

export const exportVehiclesToPDF = (vehicles: any[]) => {
  const exporter = new PDFExporter('landscape');
  
  exporter.exportTable({
    title: 'Parc de Véhicules',
    subtitle: 'Liste complète de la flotte de transport',
    showDate: true,
    data: vehicles,
    columns: [
      { header: 'Immatriculation', dataKey: 'registrationNumber' },
      { header: 'Marque', dataKey: 'brand' },
      { header: 'Modèle', dataKey: 'model' },
      { header: 'Année', dataKey: 'year' },
      { header: 'Type', dataKey: 'vehicleType' },
      { header: 'Statut', dataKey: 'status' },
      { header: 'Kilométrage', dataKey: 'mileage' },
      { header: 'Prochaine maintenance', dataKey: 'nextMaintenanceDate' },
    ],
    filename: 'Parc_Vehicules.pdf'
  });
};

// Fonctions de traduction pour les ordres de travail
function translateWorkOrderStatus(status: string): string {
  const statusMap: { [key: string]: string } = {
    'pending': 'En attente',
    'in_progress': 'En cours',
    'completed': 'Terminé',
    'cancelled': 'Annulé'
  };
  return statusMap[status] || status;
}

function translateWorkOrderPriority(priority: string): string {
  const priorityMap: { [key: string]: string } = {
    'low': 'Faible',
    'medium': 'Moyenne',
    'high': 'Haute',
    'critical': 'Critique'
  };
  return priorityMap[priority] || priority;
}

function formatFcfa(value: number | string | null | undefined): string {
  if (value === null || value === undefined) {
    return "0 FCFA";
  }

  const numericValue =
    typeof value === "string"
      ? Number.parseFloat(value.replace(/\s+/g, "").replace(",", ".").replace(/[^\d.\-]/g, ""))
      : value;

  if (!Number.isFinite(numericValue)) {
    return "0 FCFA";
  }

  const formattedValue = new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(numericValue);

  return `${formattedValue.replace(/[\u202F\u00A0]/g, " ")} FCFA`;
}

export const exportWorkOrdersToPDF = (workOrders: any[]) => {
  const exporter = new PDFExporter();
  
  // Formatter les données pour l'affichage
  const formattedData = workOrders.map(order => ({
    id: order.id?.toString() || 'N/A',
    vehicleRegistration: order.vehicleRegistration || order.vehicleRegistrationNumber || 'N/A',
    vehicleInfo: `${order.vehicleBrand || ''} ${order.vehicleModel || ''}`.trim() || 'N/A',
    title: order.title || 'Sans titre',
    status: translateWorkOrderStatus(order.status),
    priority: translateWorkOrderPriority(order.priority),
    technicianName: order.technicianName || 'Non assigné',
    startDate: order.startDate ? new Date(order.startDate).toLocaleDateString('fr-FR') : 'Non planifié',
    cost: order.cost ? formatFcfa(order.cost) : 'Non estimé',
    type: order.isPreventive ? 'Préventif' : 'Correctif'
  }));

  exporter.exportTable({
    title: 'Ordres de Travail',
    subtitle: 'Liste des interventions de maintenance',
    showDate: true,
    data: formattedData,
    columns: [
      { header: 'N°', dataKey: 'id' },
      { header: 'Véhicule', dataKey: 'vehicleRegistration' },
      { header: 'Marque/Modèle', dataKey: 'vehicleInfo' },
      { header: 'Titre', dataKey: 'title' },
      { header: 'Statut', dataKey: 'status' },
      { header: 'Priorité', dataKey: 'priority' },
      { header: 'Technicien', dataKey: 'technicianName' },
      { header: 'Date début', dataKey: 'startDate' },
      { header: 'Type', dataKey: 'type' },
      { header: 'Coût estimé', dataKey: 'cost' },
    ],
    filename: 'Ordres_de_Travail.pdf'
  });
};

export const exportDashboardToPDF = (dashboardData: any) => {
  const exporter = new PDFExporter();
  
  const sections: { title: string; data: Record<string, any> }[] = [
    {
      title: 'Vue d\'ensemble de la flotte',
      data: {
        'Véhicules opérationnels': dashboardData.fleet?.operational || '0',
        'Véhicules en maintenance': dashboardData.fleet?.maintenance || '0',
        'Véhicules hors service': dashboardData.fleet?.outOfService || '0',
        'Total véhicules': (parseInt(dashboardData.fleet?.operational || '0') + 
                           parseInt(dashboardData.fleet?.maintenance || '0') + 
                           parseInt(dashboardData.fleet?.outOfService || '0')).toString()
      }
    },
    {
      title: 'Statistiques des bons de travail',
      data: {
        'En attente': dashboardData.workOrders?.pending || '0',
        'En cours': dashboardData.workOrders?.inProgress || '0', 
        'Terminés': dashboardData.workOrders?.completed || '0',
        'Annulés': dashboardData.workOrders?.cancelled || '0'
      }
    },
    {
      title: 'Conformité maintenance',
      data: {
        'Véhicules conformes': dashboardData.compliance?.compliant || '0',
        'Véhicules en retard': dashboardData.compliance?.overdue || '0',
        'Taux de conformité': dashboardData.compliance?.percentage || '0%'
      }
    },
    {
      title: 'Maintenance programmée',
      data: {
        'Interventions programmées': dashboardData.scheduled?.scheduled || '0'
      }
    }
  ];

  if (dashboardData.fuel) {
    sections.push({
      title: 'Statistiques carburant (mois en cours)',
      data: {
        'Consommation totale': `${dashboardData.fuel.totalFuel || '0'} L`,
        'Coût total': formatFcfa(dashboardData.fuel.totalCost || 0),
        'Consommation moyenne': `${dashboardData.fuel.averageConsumption || '0'} L/100km`,
        'Nombre de pleins': dashboardData.fuel.totalRefuels || '0'
      }
    });
  }

  exporter.exportDetails(
    'Tableau de Bord - Gestion de Flotte',
    `Rapport généré le ${new Date().toLocaleDateString('fr-FR')}`,
    sections,
    'Tableau_de_Bord_Flotte.pdf'
  );
};

// Fonctions utilitaires pour les rapports
function addCompanyHeader(doc: jsPDF): number {
  const pageWidth = doc.internal.pageSize.width;
  
  try {
    // Ajouter votre image d'en-tête officielle TAY-header-final.png
    // Dimensions: 1067x236 pixels, ratio: 4.52:1
    const headerWidth = 180; // Largeur en mm pour PDF
    const headerHeight = headerWidth / 4.52; // Maintenir le ratio
    const headerX = (pageWidth - headerWidth) / 2; // Centrer
    const headerY = 10;
    
    // Ajouter l'image (convertie en base64 dans le build)
    doc.addImage(headerImage, 'PNG', headerX, headerY, headerWidth, headerHeight);
    
    return headerY + headerHeight + 10; // Position Y après l'image
  } catch (error) {
    // Fallback si l'image ne charge pas
    clientLogger.warn("Logo du PDF non disponible, repli sur le texte", { err: error });
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text("Société de Transport ABOUBAKAR Yaroro", pageWidth / 2, 20, { align: 'center' });
    
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("BP 14871 Yaoundé", pageWidth / 2, 28, { align: 'center' });
    doc.text("etsyaroro.logistique@gmail.com", pageWidth / 2, 35, { align: 'center' });
    
    // Ligne de séparation
    doc.setLineWidth(0.5);
    doc.line(20, 42, pageWidth - 20, 42);
    
    return 50;
  }
}

function addFooter(doc: jsPDF): void {
  const pageHeight = doc.internal.pageSize.height;
  const pageWidth = doc.internal.pageSize.width;
  
  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  doc.text(
    `Document généré le ${new Date().toLocaleDateString('fr-FR')} - Société de Transport ABOUBAKAR Yaroro`,
    pageWidth / 2,
    pageHeight - 10,
    { align: 'center' }
  );
}

// Rapports spécialisés pour la page Reports
export async function exportVehicleUsageReport(startDate: Date, endDate: Date) {
  try {
    // Tous les véhicules, page par page : échec ou liste incomplète refusent le rapport.
    const vehicles = await fetchAllVehicles();

    // Pleins de carburant : une lecture en échec refuse le rapport. Avant, il sortait sans
    // carburant (0 litre) ; l'échec reste journalisé par le `catch` ci-dessous.
    const fuelRecords = await fetchFuelRecords();

    // Filtrer les données par période
    const filteredFuelRecords = fuelRecords.filter((record: any) => {
      if (!record.date) return false;
      const recordDate = new Date(record.date);
      return recordDate >= startDate && recordDate <= endDate;
    });

    clientLogger.debug("Rapport d'utilisation : pleins lus", {
      total: fuelRecords.length,
      inPeriod: filteredFuelRecords.length,
      from: startDate.toISOString(),
      to: endDate.toISOString(),
    });

    const doc = new jsPDF();
    let yPosition = addCompanyHeader(doc);

    // Trait de séparation après l'en-tête
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.5);
    doc.line(20, yPosition, pageWidth - 20, yPosition);
    yPosition += 15;

    // Titre du rapport - centré
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    const titleText = "Rapport d'Utilisation des Véhicules";
    const titleWidth = doc.getTextWidth(titleText);
    doc.text(titleText, (pageWidth - titleWidth) / 2, yPosition);
    yPosition += 10;

    // Période - centrée
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    const periodText = `Période: du ${startDate.toLocaleDateString('fr-FR')} au ${endDate.toLocaleDateString('fr-FR')}`;
    const periodWidth = doc.getTextWidth(periodText);
    doc.text(periodText, (pageWidth - periodWidth) / 2, yPosition);
    yPosition += 15;

    // Statistiques générales
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Statistiques Générales", 20, yPosition);
    yPosition += 8;

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`• Nombre total de véhicules: ${vehicles.length}`, 25, yPosition);
    yPosition += 6;
    doc.text(`• Pleins enregistrés sur la période: ${filteredFuelRecords.length}`, 25, yPosition);
    yPosition += 6;

    const totalFuel = filteredFuelRecords.reduce((sum: number, record: any) => sum + (record.quantity || 0), 0);
    doc.text(`• Carburant total consommé: ${totalFuel.toFixed(2)} L`, 25, yPosition);
    yPosition += 15;

    // Tableau des véhicules
    const tableData = vehicles.map((vehicle: any) => {
      const vehicleFuelRecords = filteredFuelRecords.filter((record: any) => record.vehicleId === vehicle.id);
      const vehicleFuel = vehicleFuelRecords.reduce((sum: number, record: any) => sum + (record.quantity || 0), 0);
      const recordCount = vehicleFuelRecords.length;

      return [
        vehicle.registrationNumber || 'N/A',
        `${vehicle.brand || 'N/A'} ${vehicle.model || 'N/A'}`,
        vehicle.year?.toString() || 'N/A',
        `${(vehicle.mileage || 0).toLocaleString()} km`,
        recordCount.toString(),
        `${vehicleFuel.toFixed(2)} L`
      ];
    });

    autoTable(doc, {
      head: [['Immatriculation', 'Véhicule', 'Année', 'Kilométrage', 'Pleins', 'Carburant (L)']],
      body: tableData,
      startY: yPosition,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [46, 125, 50], textColor: 255 },
      alternateRowStyles: { fillColor: [240, 240, 240] }
    });

    // Pied de page
    addFooter(doc);

    doc.save(`rapport_utilisation_vehicules_${new Date().toISOString().split('T')[0]}.pdf`);
    return true;
  } catch (error) {
    clientLogger.error("Rapport d'utilisation des véhicules en échec", { err: error });
    if (error instanceof ReportRefusedError) throw error;
    throw new Error('Erreur lors de la génération du rapport d\'utilisation des véhicules');
  }
}

export async function exportMaintenanceCostReport(startDate: Date, endDate: Date) {
  try {
    // Tous les ordres de travail, page par page : échec, liste incomplète ou volume au-delà
    // de la borne refusent le rapport plutôt qu'un rapport sur une partie des OT.
    const workOrders = await fetchAllWorkOrders();

    // Véhicules et utilisateurs illisibles : refus, plutôt que des lignes « N/A » sans le dire.
    // Véhicules lus page par page : `limit=1000` omettait les suivants.
    const vehicles = await fetchAllVehicles();

    const usersResponse = await fetch('/api/users');
    const users = usersResponse.ok ? await usersResponse.json() : null;
    if (!Array.isArray(users)) {
      throw new ReportRefusedError("Les utilisateurs n'ont pas pu être lus : le rapport n'a pas été généré. Réessayez.");
    }
    const usersList = users;

    // Volumes seulement : des milliers d'OT resteraient dans le tampon de `clientLogger`.
    clientLogger.debug("Rapport des coûts : données lues", {
      workOrders: workOrders.length,
      users: usersList.length,
    });
    
    // Filtrer par période
    const filteredWorkOrders = Array.isArray(workOrders) ? workOrders.filter((order: any) => {
      const orderDate = new Date(order.startDate);
      return orderDate >= startDate && orderDate <= endDate;
    }) : [];

    const doc = new jsPDF();
    let yPosition = addCompanyHeader(doc);

    // Trait de séparation après l'en-tête
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.5);
    doc.line(20, yPosition, pageWidth - 20, yPosition);
    yPosition += 15;

    // Titre du rapport - centré
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    const titleText = "Rapport des Coûts de Maintenance";
    const titleWidth = doc.getTextWidth(titleText);
    doc.text(titleText, (pageWidth - titleWidth) / 2, yPosition);
    yPosition += 10;

    // Période - centrée
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    const periodText = `Période: du ${startDate.toLocaleDateString('fr-FR')} au ${endDate.toLocaleDateString('fr-FR')}`;
    const periodWidth = doc.getTextWidth(periodText);
    doc.text(periodText, (pageWidth - periodWidth) / 2, yPosition);
    yPosition += 15;

    // Coût réel de chaque OT = ses pièces. Une lecture en échec arrête le rapport : remplacer
    // le coût par 0 ou par l'estimation produirait un total faux sans le dire.
    const partsCostByOrder = new Map<unknown, number>();
    await Promise.all(filteredWorkOrders.map(async (order: any) => {
      const orderPartsResponse = await fetch(`/api/work-orders/${order.id}/parts`);
      const orderParts = orderPartsResponse.ok ? await orderPartsResponse.json() : null;
      if (!Array.isArray(orderParts)) {
        throw new Error(`Erreur coût pour OT ${order.id}: ${orderPartsResponse.status}`);
      }
      partsCostByOrder.set(order.id, orderParts.reduce((sum: number, part: any) =>
        sum + ((part.quantity || 0) * (part.unitPrice || 0)), 0));
    }));
    let realTotalCost = 0;
    partsCostByOrder.forEach((cost) => { realTotalCost += cost; });

    // Statistiques
    const completedOrders = filteredWorkOrders.filter((order: any) => order.status === 'completed');

    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Statistiques de Maintenance", 20, yPosition);
    yPosition += 8;

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`• Interventions totales: ${filteredWorkOrders.length}`, 25, yPosition);
    yPosition += 6;
    doc.text(`• Interventions terminées: ${completedOrders.length}`, 25, yPosition);
    yPosition += 6;
    doc.text(`• Coût total réel: ${formatFcfa(realTotalCost)}`, 25, yPosition);
    yPosition += 15;

    // Tableau des interventions avec les vraies données
    const tableData = await Promise.all(filteredWorkOrders.map(async (order: any) => {
      const vehicle = vehicles.find((v: any) => v.id === order.vehicleId);
      
      // Coût réel = pièces utilisées sur l'OT, lues une seule fois plus haut.
      const realCost = partsCostByOrder.get(order.id) ?? 0;
      
      return [
        order.id?.toString() || 'N/A',
        `${vehicle?.registrationNumber || 'N/A'} (${vehicle?.brand || ''} ${vehicle?.model || ''})`.trim(),
        order.title || order.description || 'N/A',
        order.technicianName || order.assignedToName || 'Non assigné',
        new Date(order.startDate).toLocaleDateString('fr-FR'),
        order.status === 'completed' ? 'Terminé' : 
        order.status === 'in_progress' ? 'En cours' : 'En attente',
        formatFcfa(realCost)
      ];
    }));

    autoTable(doc, {
      head: [['OT', 'Véhicule (Marque Modèle)', 'Nature', 'Technicien', 'Date', 'Statut', 'Coût Réel (FCFA)']],
      body: tableData,
      startY: yPosition,
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [46, 125, 50], textColor: 255 },
      alternateRowStyles: { fillColor: [240, 240, 240] }
    });

    addFooter(doc);
    doc.save(`rapport_couts_maintenance_${new Date().toISOString().split('T')[0]}.pdf`);
    return true;
  } catch (error) {
    clientLogger.error("Rapport des coûts de maintenance en échec", { err: error });
    if (error instanceof ReportRefusedError) throw error;
    throw new Error('Erreur lors de la génération du rapport des coûts de maintenance');
  }
}

export async function exportFuelConsumptionReport(startDate: Date, endDate: Date) {
  try {
    // Pleins et véhicules lus en entier : une lecture en échec refuse le rapport, jamais un
    // rapport de carburant à 0.
    const allFuelRecords = await fetchFuelRecords();
    const vehicles = await fetchAllVehicles();

    // Filtrer par période
    const filteredFuelRecords = allFuelRecords.filter((record: any) => {
      const recordDate = new Date(record.date);
      return recordDate >= startDate && recordDate <= endDate;
    });

    const doc = new jsPDF();
    let yPosition = addCompanyHeader(doc);

    // Trait de séparation après l'en-tête
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.5);
    doc.line(20, yPosition, pageWidth - 20, yPosition);
    yPosition += 15;

    // Titre du rapport - centré
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    const titleText = "Rapport de Consommation de Carburant";
    const titleWidth = doc.getTextWidth(titleText);
    doc.text(titleText, (pageWidth - titleWidth) / 2, yPosition);
    yPosition += 10;

    // Période - centrée
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    const periodText = `Période: du ${startDate.toLocaleDateString('fr-FR')} au ${endDate.toLocaleDateString('fr-FR')}`;
    const periodWidth = doc.getTextWidth(periodText);
    doc.text(periodText, (pageWidth - periodWidth) / 2, yPosition);
    yPosition += 15;

    // Statistiques globales
    const totalFuel = filteredFuelRecords.reduce((sum: number, record: any) => sum + (record.quantity || 0), 0);
    const totalCost = filteredFuelRecords.reduce((sum: number, record: any) => sum + (record.cost || 0), 0);

    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Statistiques Globales", 20, yPosition);
    yPosition += 8;

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`• Carburant total: ${totalFuel.toFixed(2)} L`, 25, yPosition);
    yPosition += 6;
    doc.text(`• Coût total: ${formatFcfa(totalCost)}`, 25, yPosition);
    yPosition += 6;
    doc.text(`• Pleins enregistrés: ${filteredFuelRecords.length}`, 25, yPosition);
    yPosition += 15;

    // Tableau par véhicule
    const vehicleConsumption = vehicles.map((vehicle: any) => {
      const vehicleRecords = filteredFuelRecords.filter((record: any) => record.vehicleId === vehicle.id);
      const fuel = vehicleRecords.reduce((sum: number, record: any) => sum + (record.quantity || 0), 0);
      const cost = vehicleRecords.reduce((sum: number, record: any) => sum + (record.cost || 0), 0);
      const recordCount = vehicleRecords.length;

      return [
        vehicle.registrationNumber || 'N/A',
        `${vehicle.brand || 'N/A'} ${vehicle.model || 'N/A'}`,
        recordCount.toString(),
        `${fuel.toFixed(2)} L`,
        formatFcfa(cost),
        fuel > 0 ? `${formatFcfa(cost / fuel)}/L` : 'N/A'
      ];
    }).filter((row: string[]) => parseFloat(row[3]) > 0); // Seulement les véhicules avec du carburant

    autoTable(doc, {
      head: [['Véhicule', 'Modèle', 'Pleins', 'Carburant (L)', 'Coût (FCFA)', 'Prix/L (FCFA)']],
      body: vehicleConsumption,
      startY: yPosition,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [46, 125, 50], textColor: 255 },
      alternateRowStyles: { fillColor: [240, 240, 240] }
    });

    addFooter(doc);
    doc.save(`rapport_consommation_carburant_${new Date().toISOString().split('T')[0]}.pdf`);
    return true;
  } catch (error) {
    clientLogger.error("Rapport de consommation de carburant en échec", { err: error });
    if (error instanceof ReportRefusedError) throw error;
    throw new Error('Erreur lors de la génération du rapport de consommation de carburant');
  }
}

export async function exportPartsInventoryReport(startDate: Date, endDate: Date) {
  try {
    // Utiliser le nouvel endpoint dédié aux rapports
    const reportUrl = `/api/reports/inventory?startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`;
    clientLogger.debug("Rapport d'inventaire : lecture", { url: reportUrl });
    
    const reportResponse = await fetch(reportUrl);
    if (!reportResponse.ok) {
      throw new Error(`Erreur API rapport: ${reportResponse.status}`);
    }
    
    const reportData = await reportResponse.json();
    const parts = reportData.parts || [];
    const allMovements = reportData.movements || [];
    const statistics = reportData.statistics || {};
    
    clientLogger.debug("Rapport d'inventaire : données lues", {
      partsCount: parts.length,
      movementsCount: allMovements.length,
      totalMovements: statistics.totalMovements,
    });

    const doc = new jsPDF();
    let yPosition = addCompanyHeader(doc);

    // Trait de séparation après l'en-tête
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.5);
    doc.line(20, yPosition, pageWidth - 20, yPosition);
    yPosition += 15;

    // Titre du rapport - centré
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    const titleText = "Rapport d'Inventaire des Pièces";
    const titleWidth = doc.getTextWidth(titleText);
    doc.text(titleText, (pageWidth - titleWidth) / 2, yPosition);
    yPosition += 10;

    // Période - centrée
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    const periodText = `Période: du ${startDate.toLocaleDateString('fr-FR')} au ${endDate.toLocaleDateString('fr-FR')}`;
    const periodWidth = doc.getTextWidth(periodText);
    doc.text(periodText, (pageWidth - periodWidth) / 2, yPosition);
    yPosition += 15;

    // Utiliser les statistiques du rapport
    const totalValue = statistics.totalValue || 0;
    const lowStockCount = statistics.lowStockCount || 0;
    const totalMovements = statistics.totalMovements || 0;

    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("État de l'Inventaire", 20, yPosition);
    yPosition += 8;

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`• Pièces en stock: ${parts.length}`, 25, yPosition);
    yPosition += 6;
    doc.text(`• Valeur totale: ${formatFcfa(totalValue)}`, 25, yPosition);
    yPosition += 6;
    doc.text(`• Pièces en stock faible: ${lowStockCount}`, 25, yPosition);
    yPosition += 6;
    doc.text(`• Mouvements sur la période: ${totalMovements}`, 25, yPosition);
    yPosition += 15;

    // Tableau des pièces - utiliser les données enrichies
    const tableData = parts.map((part: any) => {
      const stockStatus = (part.quantity || 0) <= (part.minQuantity || 0) ? 'Faible' : 'Normal';

      return [
        part.reference || 'N/A',
        part.name || 'N/A',
        (part.quantity || 0).toString(),
        (part.minQuantity || 0).toString(),
        stockStatus,
        (part.movementsCount || 0).toString(),
        formatFcfa((part.quantity || 0) * (part.unitPrice || 0))
      ];
    });

    autoTable(doc, {
      head: [['Référence', 'Nom', 'Stock', 'Min', 'État', 'Mouvements', 'Valeur (FCFA)']],
      body: tableData,
      startY: yPosition,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [46, 125, 50], textColor: 255 },
      alternateRowStyles: { fillColor: [240, 240, 240] }
    });

    addFooter(doc);
    doc.save(`rapport_inventaire_pieces_${new Date().toISOString().split('T')[0]}.pdf`);
    return true;
  } catch (error) {
    clientLogger.error("Rapport d'inventaire des pièces en échec", { err: error });
    throw new Error('Erreur lors de la génération du rapport d\'inventaire des pièces');
  }
}

export async function exportTechnicianPerformanceReport(startDate: Date, endDate: Date) {
  try {
    // Utiliser le nouvel endpoint dédié aux rapports de performance des techniciens
    const reportUrl = `/api/reports/technician-performance?startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`;
    clientLogger.debug("Rapport de performance des techniciens : lecture", { url: reportUrl });
    
    const reportResponse = await fetch(reportUrl);
    if (!reportResponse.ok) {
      throw new Error(`Erreur API rapport: ${reportResponse.status}`);
    }
    
    const reportData = await reportResponse.json();
    const technicians = reportData.technicians || [];
    const statistics = reportData.statistics || {};
    
    clientLogger.debug("Rapport de performance des techniciens : données lues", {
      techniciansCount: technicians.length,
      totalWorkOrders: statistics.totalWorkOrders,
      totalCompleted: statistics.totalCompletedWorkOrders
    });

    const doc = new jsPDF();
    let yPosition = addCompanyHeader(doc);

    // Trait de séparation après l'en-tête
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.5);
    doc.line(20, yPosition, pageWidth - 20, yPosition);
    yPosition += 15;

    // Titre du rapport - centré
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    const titleText = "Rapport de Performance des Techniciens";
    const titleWidth = doc.getTextWidth(titleText);
    doc.text(titleText, (pageWidth - titleWidth) / 2, yPosition);
    yPosition += 10;

    // Période - centrée
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    const periodText = `Période: du ${startDate.toLocaleDateString('fr-FR')} au ${endDate.toLocaleDateString('fr-FR')}`;
    const periodWidth = doc.getTextWidth(periodText);
    doc.text(periodText, (pageWidth - periodWidth) / 2, yPosition);
    yPosition += 15;

    // Statistiques - utiliser les données du rapport
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Performance Globale", 20, yPosition);
    yPosition += 8;

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`• Techniciens actifs: ${statistics.totalActiveTechnicians || 0}`, 25, yPosition);
    yPosition += 6;
    doc.text(`• Interventions totales: ${statistics.totalWorkOrders || 0}`, 25, yPosition);
    yPosition += 6;
    doc.text(`• Interventions terminées: ${statistics.totalCompletedWorkOrders || 0}`, 25, yPosition);
    yPosition += 15;

    // Tableau des techniciens - utiliser les données enrichies
    const tableData = technicians.map((tech: any) => {
      const roleText = tech.role === 'workshop_manager' ? 'Chef d\'atelier' : 'Technicien';

      return [
        tech.name || 'N/A',
        roleText,
        (tech.totalWorkOrders || 0).toString(),
        (tech.completedWorkOrders || 0).toString(),
        (tech.inProgressWorkOrders || 0).toString(),
        `${tech.completionRate || 0}%`
      ];
    });

    autoTable(doc, {
      head: [['Nom', 'Rôle', 'Total OT', 'Terminés', 'En cours', 'Taux (%)']], 
      body: tableData,
      startY: yPosition,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [46, 125, 50], textColor: 255 },
      alternateRowStyles: { fillColor: [240, 240, 240] }
    });

    addFooter(doc);
    doc.save(`rapport_performance_techniciens_${new Date().toISOString().split('T')[0]}.pdf`);
    return true;
  } catch (error) {
    clientLogger.error("Rapport de performance des techniciens en échec", { err: error });
    throw new Error('Erreur lors de la génération du rapport de performance des techniciens');
  }
}
