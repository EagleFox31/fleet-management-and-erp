import { userMessageOf } from "@/lib/api-error";
import React, { useMemo, useState } from "react";
import { canReadDocumentation, canReadInventoryReport, canReadTechnicianReport } from "@shared/constants/roles";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { useAuth } from "@/hooks/useAuth";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import {
  FileText,
  Download,
  Eye,
  Loader2,
  BarChart3,
  Database,
  BookOpen,
  Truck,
  Wrench,
  Package,
  Fuel,
  Users,
  Receipt,
  Route,
  CreditCard,
  Settings2,
  RefreshCw,
  ClipboardList,
  AlertTriangle,
  FileCheck,
  Clock,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import jsPDF from 'jspdf';
import headerImage from '@assets/TAY-header-final.png';
import { 
  exportVehicleUsageReport,
  exportMaintenanceCostReport,
  exportFuelConsumptionReport,
  exportPartsInventoryReport,
  exportTechnicianPerformanceReport
} from "@/lib/pdf-export";
import { exportsService } from "@/services/exportsService";
import { cn } from "@/lib/utils";
import { HeaderCard, KpiGrid, KpiTile, PremiumTabsNav, CardShell, IconSquare } from "@/components/design-system";
import { TabIcon } from "@/lib/premium-tab-icons";
import { queryView, readyData } from "@/lib/query-view";
import { UNAVAILABLE } from "@/components/dashboard/kpi-tiles";

type ExportCardTone = "green" | "blue" | "amber" | "red" | "gray";

interface ExportCardProps {
  title: string;
  subtitle: string;
  description: string;
  icon: React.ReactNode;
  tone?: ExportCardTone;
  formatLabel?: string;
  loading?: boolean;
  onExport?: () => void | Promise<void>;
  buttonVariant?: "outline" | "default" | "secondary";
  className?: string;
  topBarClassName?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}

function ExportCard({
  title,
  subtitle,
  description,
  icon,
  tone = "green",
  formatLabel = "Exporter (.xlsx)",
  loading = false,
  onExport,
  buttonVariant = "outline",
  className,
  topBarClassName,
  children,
  footer,
}: ExportCardProps) {
  return (
    <CardShell className={cn("flex flex-col h-full", className)} topBar topBarClassName={topBarClassName}>
      <div className="p-5 flex flex-col flex-1 gap-4">
        <div className="flex items-start gap-3">
          <IconSquare size="lg" tone={tone}>
            {icon}
          </IconSquare>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-gray-900">{title}</h3>
            <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>
          </div>
        </div>
        <p className="text-sm text-gray-500 leading-relaxed flex-1">{description}</p>
        {children}
        {footer ?? (
          <Button
            variant={buttonVariant}
            size="sm"
            className="w-full h-9 text-xs gap-1.5"
            onClick={onExport}
            disabled={loading || !onExport}
          >
            {loading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Export en cours...
              </>
            ) : (
              <>
                <Download className="h-3.5 w-3.5" />
                {formatLabel}
              </>
            )}
          </Button>
        )}
      </div>
    </CardShell>
  );
}

type ReportsKpiItem = {
  key: string;
  label: string;
  value: React.ReactNode;
  subValue: React.ReactNode;
  icon: React.ReactNode;
  iconWrapperClassName?: string;
  valueClassName?: string;
};

function ReportsKpiSkeleton() {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 flex flex-col gap-2">
      <Skeleton className="h-8 w-8 rounded-lg" />
      <Skeleton className="h-3 w-24 mt-1" />
      <Skeleton className="h-5 w-16" />
      <Skeleton className="h-3 w-28" />
    </div>
  );
}

export default function ReportsIndex() {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [startDate, setStartDate] = useState<Date | undefined>(new Date());
  const [endDate, setEndDate] = useState<Date | undefined>(new Date());
  const [reportType, setReportType] = useState("vehicle-usage");
  const [format, setFormat] = useState("pdf");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUpdatingVehicleData, setIsUpdatingVehicleData] = useState(false);
  const [exportingStates, setExportingStates] = useState({
    vehicles: false,
    workOrders: false,
    inventory: false,
    fuel: false,
    users: false,
    complete: false,
    supplierInvoices: false,
    fuelStatistics: false,
    clientMissions: false,
    clientInvoices: false,
    monthlyReport: false
  });

  // États pour la documentation
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [isExportingDoc, setIsExportingDoc] = useState(false);

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const CLIENTS = ["MAERSK", "CNPCC", "AGL", "SODECOTON"];

  // Contrôle d'accès basé sur les rôles
  const isFinancialDataAuthorized = user?.role === 'admin' || user?.role === 'workshop_manager';
  const isClient = user?.role === 'client';

  // Charger la liste des documents (admin + secrétaire)
  const { data: docs, isLoading: isLoadingDocs } = useQuery<{ files: { name: string; title: string; description: string; }[] }>({
    queryKey: ['/api/documentation'],
    enabled: canReadDocumentation(user?.role),
  });

  const { data: fleetStats, isLoading: fleetLoading } = useQuery<any>({
    queryKey: ["/api/statistics/fleet"],
    enabled: !!user,
  });

  const { data: workOrderStats, isLoading: workOrderLoading } = useQuery<any>({
    queryKey: ["/api/work-orders/statistics"],
    enabled: !!user,
  });

  const partsStatsQuery = useQuery<any>({
    queryKey: ["/api/parts/statistics"],
    enabled: !!user,
  });
  // Échec sans données : « Indisponible », jamais « 0 pièce sous seuil ».
  const partsStatsView = queryView(partsStatsQuery);
  const partsStats = readyData(partsStatsView, undefined as any);
  const partsLoading = partsStatsQuery.isLoading;

  const { data: documentStats, isLoading: documentStatsLoading } = useQuery<any>({
    queryKey: ["/api/vehicles/document-stats"],
    enabled: !!user,
  });

  const { data: renewalRequests = [], isLoading: renewalsLoading } = useQuery<any[]>({
    queryKey: ["/api/document-renewals/requests"],
    enabled: !!user && (user.role === "admin" || user.role === "secretary" || user.role === "logistics"),
  });

  const { data: missionsData = [], isLoading: missionsLoading } = useQuery<any[]>({
    queryKey: ["/api/missions"],
    enabled: !!user && user.role === "logistics",
  });

  // Charger le contenu d'un document
  const { data: docContent, isLoading: isLoadingContent } = useQuery<{ content: string; filename: string }>({
    queryKey: ['/api/documentation', selectedDoc],
    enabled: user?.role === 'admin' && !!selectedDoc && previewOpen,
  });

  // Fonctions pour la documentation
  const handlePreview = (filename: string) => {
    setSelectedDoc(filename);
    setPreviewOpen(true);
  };

  const addPDFHeader = (doc: jsPDF) => {
    const pageWidth = doc.internal.pageSize.width;
    
    try {
      const pixelToMm = 25.4 / 72;
      const headerWidth = 1067 * pixelToMm * 0.4;
      const headerHeight = 236 * pixelToMm * 0.4;
      const headerX = (pageWidth - headerWidth) / 2;
      const headerY = 10;
      
      doc.addImage(headerImage, 'PNG', headerX, headerY, headerWidth, headerHeight);
      doc.setLineWidth(0.5);
      doc.line(15, headerY + headerHeight + 5, pageWidth - 15, headerY + headerHeight + 5);
      
      return headerY + headerHeight + 15;
    } catch (error) {
      console.error('Erreur lors du chargement de l\'image d\'en-tête:', error);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('Yaro FleetOS', pageWidth / 2, 20, { align: 'center' });
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text('Société de Transport ABOUBAKAR Yaroro', pageWidth / 2, 30, { align: 'center' });
      doc.text('BP 14871 Yaoundé', pageWidth / 2, 37, { align: 'center' });
      doc.text('etsyaroro.logistique@gmail.com', pageWidth / 2, 44, { align: 'center' });
      doc.setLineWidth(0.5);
      doc.line(15, 50, pageWidth - 15, 50);
      return 60;
    }
  };

  const addPDFFooter = (doc: jsPDF) => {
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;
    doc.setLineWidth(0.3);
    doc.line(15, pageHeight - 20, pageWidth - 15, pageHeight - 20);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    const currentDate = new Date().toLocaleDateString('fr-FR');
    doc.text(`Document généré le ${currentDate}`, 15, pageHeight - 10);
    const pageNumber = doc.getCurrentPageInfo().pageNumber;
    doc.text(`Page ${pageNumber}`, pageWidth - 15, pageHeight - 10, { align: 'right' });
  };

  const convertMarkdownToPDF = (content: string, title: string, filename: string) => {
    setIsExportingDoc(true);
    
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.width;
      const pageHeight = doc.internal.pageSize.height;
      const margin = 15;
      const maxWidth = pageWidth - 2 * margin;
      let currentY = addPDFHeader(doc);
      
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text(title, pageWidth / 2, currentY, { align: 'center' });
      currentY += 12;
      
      // Nettoyer le contenu (apostrophes typographiques, etc.)
      const cleanContent = content
        .replace(/'/g, "'")  // Apostrophes typographiques
        .replace(/'/g, "'")  // Apostrophes ouvrantes
        .replace(/"/g, '"')  // Guillemets typographiques
        .replace(/"/g, '"')  // Guillemets typographiques fermants
        .replace(/–/g, '-')  // Tirets demi-cadratin
        .replace(/—/g, '-'); // Tirets cadratin
      
      const lines = cleanContent.split('\n');
      let inTable = false;
      let tableData: string[][] = [];
      let tableHeaders: string[] = [];
      
      for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        
        // Vérifier si on doit créer une nouvelle page
        if (currentY > pageHeight - 35) {
          doc.addPage();
          currentY = addPDFHeader(doc);
        }
        
        // Détecter les tableaux markdown
        if (line.includes('|') && !inTable) {
          // Début d'un tableau
          tableHeaders = line.split('|').map(h => h.trim()).filter(h => h);
          inTable = true;
          tableData = [];
          continue;
        } else if (inTable && line.includes('|') && line.includes('-')) {
          // Ligne de séparation du tableau (ignorer)
          continue;
        } else if (inTable && line.includes('|')) {
          // Ligne de données du tableau
          const rowData = line.split('|').map(c => c.trim()).filter(c => c);
          tableData.push(rowData);
          continue;
        } else if (inTable && !line.includes('|')) {
          // Fin du tableau - le rendre
          inTable = false;
          
          if (tableHeaders.length > 0 && tableData.length > 0) {
            // Calculer la largeur des colonnes
            const colWidth = (maxWidth - 10) / tableHeaders.length;
            
            // Dessiner les en-têtes
            doc.setFontSize(9);
            doc.setFont('helvetica', 'bold');
            doc.setFillColor(240, 240, 240);
            doc.rect(margin, currentY - 4, maxWidth, 6, 'F');
            
            tableHeaders.forEach((header, idx) => {
              doc.text(header, margin + 2 + (idx * colWidth), currentY);
            });
            currentY += 8;
            
            // Dessiner les données
            doc.setFont('helvetica', 'normal');
            tableData.forEach((row) => {
              if (currentY > pageHeight - 35) {
                doc.addPage();
                currentY = addPDFHeader(doc);
              }
              
              row.forEach((cell, idx) => {
                const cellText = doc.splitTextToSize(cell, colWidth - 4);
                doc.text(cellText, margin + 2 + (idx * colWidth), currentY);
              });
              currentY += 6;
            });
            
            // Ligne de fin de tableau
            doc.setLineWidth(0.2);
            doc.line(margin, currentY, margin + maxWidth, currentY);
            currentY += 8;
          }
          
          // Continuer avec la ligne actuelle
        }
        
        // Traiter les autres éléments markdown
        if (line.startsWith('# ')) {
          doc.setFontSize(16);
          doc.setFont('helvetica', 'bold');
          doc.text(line.substring(2), margin, currentY);
          currentY += 10;
        } else if (line.startsWith('## ')) {
          doc.setFontSize(14);
          doc.setFont('helvetica', 'bold');
          doc.text(line.substring(3), margin, currentY);
          currentY += 8;
        } else if (line.startsWith('### ')) {
          doc.setFontSize(12);
          doc.setFont('helvetica', 'bold');
          doc.text(line.substring(4), margin, currentY);
          currentY += 7;
        } else if (line.startsWith('#### ')) {
          doc.setFontSize(11);
          doc.setFont('helvetica', 'bold');
          doc.text(line.substring(5), margin, currentY);
          currentY += 6;
        } else if (line.trim() === '---') {
          doc.setLineWidth(0.3);
          doc.line(margin, currentY, pageWidth - margin, currentY);
          currentY += 5;
        } else if (line.match(/^[\s]*[-*]\s/)) {
          doc.setFontSize(10);
          doc.setFont('helvetica', 'normal');
          const indent = (line.match(/^[\s]*/)?.[0].length || 0) * 2;
          const text = line.replace(/^[\s]*[-*]\s/, '').replace(/\*\*/g, '');
          doc.text('•', margin + indent, currentY);
          const splitText = doc.splitTextToSize(text, maxWidth - indent - 5);
          doc.text(splitText, margin + indent + 5, currentY);
          currentY += splitText.length * 5;
        } else if (line.match(/^[\s]*\d+\.\s/)) {
          doc.setFontSize(10);
          doc.setFont('helvetica', 'normal');
          const indent = (line.match(/^[\s]*/)?.[0].length || 0) * 2;
          const parts = line.match(/^[\s]*(\d+\.)\s(.*)$/);
          if (parts) {
            const text = parts[2].replace(/\*\*/g, '');
            doc.text(parts[1], margin + indent, currentY);
            const splitText = doc.splitTextToSize(text, maxWidth - indent - 10);
            doc.text(splitText, margin + indent + 10, currentY);
            currentY += splitText.length * 5;
          }
        } else if (line.trim() === '') {
          currentY += 3;
        } else if (line.trim() && !line.includes('|')) {
          // Texte normal avec gestion du gras inline
          doc.setFontSize(10);
          
          // Détecter et traiter le texte avec **gras**
          if (line.includes('**')) {
            const segments = line.split(/(\*\*[^*]+\*\*)/g);
            let xOffset = margin;
            
            segments.forEach(segment => {
              if (segment.startsWith('**') && segment.endsWith('**')) {
                // Texte en gras
                const boldText = segment.replace(/\*\*/g, '');
                doc.setFont('helvetica', 'bold');
                doc.text(boldText, xOffset, currentY);
                xOffset += doc.getTextWidth(boldText);
              } else if (segment.trim()) {
                // Texte normal
                doc.setFont('helvetica', 'normal');
                const cleanText = segment.replace(/[`]/g, '');
                doc.text(cleanText, xOffset, currentY);
                xOffset += doc.getTextWidth(cleanText);
              }
            });
            currentY += 5;
          } else {
            // Texte normal sans formatage
            doc.setFont('helvetica', 'normal');
            const cleanedLine = line.replace(/[`]/g, '').trim();
            if (cleanedLine) {
              const splitText = doc.splitTextToSize(cleanedLine, maxWidth);
              doc.text(splitText, margin, currentY);
              currentY += splitText.length * 5;
            }
          }
        }
        
        addPDFFooter(doc);
      }
      
      const pdfFilename = filename.replace('.md', '.pdf');
      doc.save(pdfFilename);
      
      toast({
        title: "Export réussi",
        description: `Le document ${pdfFilename} a été téléchargé avec succès.`,
      });
    } catch (error) {
      console.error('Erreur lors de l\'export PDF:', error);
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Une erreur est survenue lors de l'export en PDF.",
      });
    } finally {
      setIsExportingDoc(false);
    }
  };

  const handleExportPDF = async (filename: string, title: string) => {
    try {
      const response = await fetch(`/api/documentation/${filename}`);
      const data = await response.json();
      
      if (data.content) {
        convertMarkdownToPDF(data.content, title, filename);
      }
    } catch (error) {
      console.error('Erreur lors du chargement du document:', error);
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Impossible de charger le document.",
      });
    }
  };

  const handleGenerateReport = async () => {
    if (!startDate || !endDate) {
      toast({
        title: "Erreur",
        description: "Veuillez sélectionner les dates de début et de fin.",
        variant: "destructive",
      });
      return;
    }

    if (startDate > endDate) {
      toast({
        title: "Erreur", 
        description: "La date de début doit être antérieure à la date de fin.",
        variant: "destructive",
      });
      return;
    }

    // CONTRÔLE DE SÉCURITÉ : Vérifier les permissions avant génération
    if ((reportType === "maintenance-costs" || reportType === "fuel-consumption") && !isFinancialDataAuthorized) {
      toast({
        title: "Accès refusé",
        description: "Vous n'avez pas l'autorisation d'accéder aux données financières.",
        variant: "destructive",
      });
      return;
    }

    if (
      (reportType === "parts-inventory" && !canReadInventoryReport(user?.role)) ||
      (reportType === "technician-performance" && !canReadTechnicianReport(user?.role))
    ) {
      toast({
        title: "Accès refusé", 
        description: "Ce rapport n'est pas disponible pour votre rôle utilisateur.",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    
    try {
      let success = false;
      
      switch (reportType) {
        case "vehicle-usage":
          success = await exportVehicleUsageReport(startDate, endDate);
          break;
        case "maintenance-costs":
          success = await exportMaintenanceCostReport(startDate, endDate);
          break;
        case "fuel-consumption":
          success = await exportFuelConsumptionReport(startDate, endDate);
          break;
        case "parts-inventory":
          success = await exportPartsInventoryReport(startDate, endDate);
          break;
        case "technician-performance":
          success = await exportTechnicianPerformanceReport(startDate, endDate);
          break;
        default:
          throw new Error("Type de rapport non supporté");
      }

      if (success) {
        toast({
          title: "Rapport généré",
          description: "Le fichier PDF a été téléchargé avec succès.",
        });
      }
    } catch (error) {
      console.error("Erreur génération rapport:", error);
      toast({
        title: "Erreur",
        description: userMessageOf(error, "Une erreur est survenue lors de la génération du rapport."),
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };
  
  const updateVehicleBrandModel = async () => {
    try {
      setIsUpdatingVehicleData(true);
      
      // Récupérer tous les véhicules
      const response = await fetch('/api/vehicles/all');
      if (!response.ok) {
        throw new Error('Erreur lors de la récupération des véhicules');
      }
      
      const vehicles = await response.json();
      let updatedCount = 0;
      
      // Pour chaque véhicule, vérifier et mettre à jour si nécessaire
      for (const vehicle of vehicles) {
        // On vérifie si la marque ou le modèle sont manquants
        if (!vehicle.brand || !vehicle.model) {
          // Rechercher un autre véhicule avec la même immatriculation mais avec brand et model renseignés
          const sourceVehicle = vehicles.find((v: any) => 
            v.id !== vehicle.id && 
            v.registrationNumber === vehicle.registrationNumber && 
            v.brand && 
            v.model
          );
          
          if (sourceVehicle) {
            // Mettre à jour le véhicule
            const updateResponse = await fetch(`/api/vehicles/${vehicle.id}`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                brand: sourceVehicle.brand,
                model: sourceVehicle.model
              }),
            });
            
            if (updateResponse.ok) {
              updatedCount++;
            }
          }
        }
      }
      
      // Invalider le cache pour recharger les données
      queryClient.invalidateQueries({ queryKey: ['/api/vehicles'] });
      
      toast({
        title: "Mise à jour terminée",
        description: `${updatedCount} véhicules ont été mis à jour avec succès.`,
      });
    } catch (error) {
      console.error("Erreur lors de la mise à jour:", error);
      toast({
        title: "Erreur",
        description: "Une erreur est survenue lors de la mise à jour des données.",
        variant: "destructive"
      });
    } finally {
      setIsUpdatingVehicleData(false);
    }
  };

  // Filtrer les types de rapports selon les permissions utilisateur
  const reportTypes = [
    { value: "vehicle-usage", label: "Utilisation des véhicules" },
    // Données financières sensibles - Accès limité
    ...(isFinancialDataAuthorized ? [
      { value: "maintenance-costs", label: "Coûts de maintenance" },
      { value: "fuel-consumption", label: "Consommation de carburant" }
    ] : []),
    // Données opérationnelles : mêmes rôles que les gardes serveur (shared/constants/roles.ts)
    ...(canReadInventoryReport(user?.role) ? [
      { value: "parts-inventory", label: "Inventaire des pièces" },
    ] : []),
    ...(canReadTechnicianReport(user?.role) ? [
      { value: "technician-performance", label: "Performance des techniciens" },
    ] : []),
  ];

  const formatTypes = [
    { value: "pdf", label: "PDF (.pdf)" },
  ];

  // Fonctions d'export pour les données
  const handleExportData = async (exportType: string) => {
    try {
      setExportingStates(prev => ({ ...prev, [exportType]: true }));
      
      const response = await fetch(`/api/exports/${exportType}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Erreur lors de l'export: ${response.status}`);
      }

      // Créer un blob à partir de la réponse
      const blob = await response.blob();
      
      // Déterminer le nom du fichier et l'extension
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `export_${exportType}_${new Date().toISOString().split('T')[0]}`;
      
      if (contentDisposition) {
        const matches = contentDisposition.match(/filename="?([^"]+)"?/);
        if (matches) {
          filename = matches[1];
        }
      } else {
        // Ajouter l'extension appropriée
        if (exportType === 'complete') {
          filename += '.zip';
        } else {
          filename += '.xlsx';
        }
      }

      // Créer un lien de téléchargement
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast({
        title: "Export réussi",
        description: `Le fichier ${filename} a été téléchargé avec succès.`,
      });

    } catch (error) {
      console.error(`Erreur lors de l'export ${exportType}:`, error);
      toast({
        title: "Erreur d'export",
        description: `Impossible d'exporter les données. Veuillez réessayer.`,
        variant: "destructive",
      });
    } finally {
      setExportingStates(prev => ({ ...prev, [exportType]: false }));
    }
  };

  const exportSupplierInvoices = async () => {
    setExportingStates((prev) => ({ ...prev, supplierInvoices: true }));
    try {
      await exportsService.downloadSupplierInvoices();
      toast({ title: "Export réussi", description: "Le fichier des factures fournisseurs a été téléchargé" });
    } catch {
      toast({ title: "Erreur d'export", description: "Impossible de générer le fichier Excel", variant: "destructive" });
    } finally {
      setExportingStates((prev) => ({ ...prev, supplierInvoices: false }));
    }
  };

  const exportFuelStatistics = async () => {
    setExportingStates((prev) => ({ ...prev, fuelStatistics: true }));
    try {
      await exportsService.downloadFuelStatistics({ year: currentYear, month: currentMonth });
      toast({ title: "Export réussi", description: "Les statistiques carburant ont été téléchargées" });
    } catch {
      toast({ title: "Erreur d'export", description: "Impossible de générer le fichier Excel", variant: "destructive" });
    } finally {
      setExportingStates((prev) => ({ ...prev, fuelStatistics: false }));
    }
  };

  const exportClientMissions = async () => {
    setExportingStates((prev) => ({ ...prev, clientMissions: true }));
    try {
      await exportsService.downloadClientMissions();
      toast({ title: "Export réussi", description: "Toutes les missions ont été téléchargées" });
    } catch {
      toast({ title: "Erreur d'export", description: "Impossible de générer le fichier", variant: "destructive" });
    } finally {
      setExportingStates((prev) => ({ ...prev, clientMissions: false }));
    }
  };

  const exportClientMissionsByClient = async (client: string) => {
    setExportingStates((prev) => ({ ...prev, [`client-${client}`]: true } as typeof prev));
    try {
      await exportsService.downloadClientMissions({ client });
      toast({ title: "Export réussi", description: `Les missions ${client} ont été téléchargées` });
    } catch {
      toast({ title: "Erreur d'export", description: "Impossible de générer le fichier", variant: "destructive" });
    } finally {
      setExportingStates((prev) => ({ ...prev, [`client-${client}`]: false } as typeof prev));
    }
  };

  const exportClientInvoices = async () => {
    setExportingStates((prev) => ({ ...prev, clientInvoices: true }));
    try {
      await exportsService.downloadClientInvoices();
      toast({ title: "Export réussi", description: "Les factures clients ont été téléchargées" });
    } catch {
      toast({ title: "Erreur d'export", description: "Impossible de générer le fichier Excel", variant: "destructive" });
    } finally {
      setExportingStates((prev) => ({ ...prev, clientInvoices: false }));
    }
  };

  const reportTypesCount = reportTypes.length;
  const documentationCount = docs?.files?.length || 0;
  const cardClassName = "rounded-2xl border border-gray-100 shadow-sm bg-white";

  const operationalVehicles = Number.parseInt(fleetStats?.operational || "0", 10) || 0;
  const maintenanceVehicles = Number.parseInt(fleetStats?.maintenance || "0", 10) || 0;
  const outOfServiceVehicles = Number.parseInt(fleetStats?.outOfService || "0", 10) || 0;
  const totalVehicles = operationalVehicles + maintenanceVehicles + outOfServiceVehicles;

  const expiredDocumentsCount =
    Number(documentStats?.expiredCarteGrise || 0) +
    Number(documentStats?.expiredAssurance || 0) +
    Number(documentStats?.expiredVisiteTechnique || 0);

  const expiringDocumentsCount =
    Number(documentStats?.expiringCarteGrise || 0) +
    Number(documentStats?.expiringAssurance || 0) +
    Number(documentStats?.expiringVisiteTechnique || 0);

  const pendingRenewalsCount = Array.isArray(renewalRequests)
    ? renewalRequests.filter((r) => r.status === "pending" || r.status === "in_progress").length
    : 0;

  const pendingWorkOrders = Number(workOrderStats?.pending || 0);
  const inProgressWorkOrders = Number(workOrderStats?.inProgress || 0);
  const lowStockFailed = partsStatsView.kind === "error";
  const lowStockCount = Number(partsStats?.lowStockCount || 0);
  const activeMissionsCount = Array.isArray(missionsData)
    ? missionsData.filter((m) => m.status === "in_progress").length
    : 0;
  const exportOptionsCount = user?.role === "admin" ? 11 : 10;

  const kpisLoading =
    fleetLoading ||
    workOrderLoading ||
    partsLoading ||
    documentStatsLoading ||
    ((user?.role === "secretary" || user?.role === "admin" || user?.role === "logistics") && renewalsLoading) ||
    (user?.role === "logistics" && missionsLoading);

  const { headerSubtitle, roleKpis } = useMemo(() => {
    const role = user?.role || "user";

    const adminKpis: ReportsKpiItem[] = [
      {
        key: "fleet",
        label: "Véhicules en service",
        value: operationalVehicles,
        subValue: `sur ${totalVehicles} au total`,
        icon: <Truck className="h-4 w-4" />,
        iconWrapperClassName: "bg-green-50 text-green-600",
      },
      {
        key: "wo",
        label: "OT à traiter",
        value: pendingWorkOrders + inProgressWorkOrders,
        subValue: `${pendingWorkOrders} en attente`,
        icon: <ClipboardList className="h-4 w-4" />,
        iconWrapperClassName: "bg-orange-50 text-orange-600",
        valueClassName: pendingWorkOrders + inProgressWorkOrders > 0 ? "text-orange-700" : undefined,
      },
      {
        key: "docs-expired",
        label: "Documents expirés",
        value: expiredDocumentsCount,
        subValue: `${expiringDocumentsCount} expirent bientôt`,
        icon: <AlertTriangle className="h-4 w-4" />,
        iconWrapperClassName: "bg-red-50 text-red-600",
        valueClassName: expiredDocumentsCount > 0 ? "text-red-700" : undefined,
      },
      {
        key: "stock",
        label: "Pièces sous seuil",
        value: lowStockFailed ? UNAVAILABLE : lowStockCount,
        subValue: "Alertes stock magasin",
        icon: <Package className="h-4 w-4" />,
        iconWrapperClassName: "bg-blue-50 text-blue-600",
        valueClassName: lowStockCount > 0 ? "text-amber-700" : undefined,
      },
    ];

    const workshopManagerKpis: ReportsKpiItem[] = [
      {
        key: "wo-active",
        label: "OT en cours",
        value: inProgressWorkOrders,
        subValue: "Interventions actives",
        icon: <Wrench className="h-4 w-4" />,
        iconWrapperClassName: "bg-blue-50 text-blue-600",
      },
      {
        key: "wo-pending",
        label: "OT en attente",
        value: pendingWorkOrders,
        subValue: "À planifier",
        icon: <Clock className="h-4 w-4" />,
        iconWrapperClassName: "bg-amber-50 text-amber-600",
        valueClassName: pendingWorkOrders > 0 ? "text-amber-700" : undefined,
      },
      {
        key: "reports",
        label: "Rapports PDF",
        value: reportTypesCount,
        subValue: "Prêts à générer",
        icon: <FileText className="h-4 w-4" />,
        iconWrapperClassName: "bg-indigo-50 text-indigo-600",
      },
      {
        key: "docs-expired",
        label: "Documents expirés",
        value: expiredDocumentsCount,
        subValue: "Conformité véhicules",
        icon: <FileCheck className="h-4 w-4" />,
        iconWrapperClassName: "bg-red-50 text-red-600",
        valueClassName: expiredDocumentsCount > 0 ? "text-red-700" : undefined,
      },
    ];

    const secretaryKpis: ReportsKpiItem[] = [
      {
        key: "renewals",
        label: "Renouvellements en cours",
        value: pendingRenewalsCount,
        subValue: "Demandes à suivre",
        icon: <FileCheck className="h-4 w-4" />,
        iconWrapperClassName: "bg-amber-50 text-amber-600",
        valueClassName: pendingRenewalsCount > 0 ? "text-amber-700" : undefined,
      },
      {
        key: "docs-expired",
        label: "Documents expirés",
        value: expiredDocumentsCount,
        subValue: "Priorité conformité",
        icon: <AlertTriangle className="h-4 w-4" />,
        iconWrapperClassName: "bg-red-50 text-red-600",
        valueClassName: expiredDocumentsCount > 0 ? "text-red-700" : undefined,
      },
      {
        key: "reports",
        label: "Rapports PDF",
        value: reportTypesCount,
        subValue: "Exports disponibles",
        icon: <FileText className="h-4 w-4" />,
        iconWrapperClassName: "bg-blue-50 text-blue-600",
      },
    ];

    const logisticsKpis: ReportsKpiItem[] = [
      {
        key: "fleet",
        label: "Véhicules disponibles",
        value: operationalVehicles,
        subValue: `${maintenanceVehicles} en maintenance`,
        icon: <Truck className="h-4 w-4" />,
        iconWrapperClassName: "bg-green-50 text-green-600",
      },
      {
        key: "missions",
        label: "Missions en cours",
        value: activeMissionsCount,
        subValue: "Transport actif",
        icon: <Route className="h-4 w-4" />,
        iconWrapperClassName: "bg-blue-50 text-blue-600",
      },
      {
        key: "docs",
        label: "Docs à renouveler",
        value: expiringDocumentsCount + expiredDocumentsCount,
        subValue: `${expiredDocumentsCount} déjà expirés`,
        icon: <FileCheck className="h-4 w-4" />,
        iconWrapperClassName: "bg-orange-50 text-orange-600",
        valueClassName: expiringDocumentsCount + expiredDocumentsCount > 0 ? "text-orange-700" : undefined,
      },
      {
        key: "reports",
        label: "Rapports PDF",
        value: reportTypesCount,
        subValue: "Flotte & missions",
        icon: <BarChart3 className="h-4 w-4" />,
        iconWrapperClassName: "bg-purple-50 text-purple-600",
      },
    ];

    const clientKpis: ReportsKpiItem[] = [
      {
        key: "reports",
        label: "Rapports disponibles",
        value: reportTypesCount,
        subValue: "Vos exports PDF",
        icon: <FileText className="h-4 w-4" />,
        iconWrapperClassName: "bg-blue-50 text-blue-600",
      },
      {
        key: "fleet",
        label: "Véhicules suivis",
        value: totalVehicles,
        subValue: "Dans votre périmètre",
        icon: <Truck className="h-4 w-4" />,
        iconWrapperClassName: "bg-green-50 text-green-600",
      },
      {
        key: "exports",
        label: "Exports Excel",
        value: exportOptionsCount,
        subValue: "Fichiers téléchargeables",
        icon: <Download className="h-4 w-4" />,
        iconWrapperClassName: "bg-emerald-50 text-emerald-600",
      },
      {
        key: "docs",
        label: "Docs à surveiller",
        value: expiringDocumentsCount,
        subValue: "Expirent sous 30 jours",
        icon: <Clock className="h-4 w-4" />,
        iconWrapperClassName: "bg-amber-50 text-amber-600",
      },
    ];

    const subtitles: Record<string, string> = {
      admin: "Vue globale : flotte, atelier, stock et conformité",
      workshop_manager: "Pilotage atelier, OT et rapports de maintenance",
      secretary: "Documents, renouvellements et exports administratifs",
      logistics: "Flotte, missions et conformité documentaire",
      client: "Vos rapports et exports de suivi",
    };

    const byRole: Record<string, ReportsKpiItem[]> = {
      admin: adminKpis,
      workshop_manager: workshopManagerKpis,
      secretary: secretaryKpis,
      logistics: logisticsKpis,
      client: clientKpis,
    };

    return {
      headerSubtitle: subtitles[role] || "Générez des rapports et exportez vos données",
      roleKpis: byRole[role] || workshopManagerKpis,
    };
  }, [
    user?.role,
    operationalVehicles,
    totalVehicles,
    maintenanceVehicles,
    pendingWorkOrders,
    inProgressWorkOrders,
    expiredDocumentsCount,
    expiringDocumentsCount,
    lowStockCount,
    lowStockFailed,
    reportTypesCount,
    documentationCount,
    pendingRenewalsCount,
    activeMissionsCount,
    exportOptionsCount,
  ]);

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-96 rounded-2xl border border-gray-100 shadow-sm bg-white">
          <CardHeader>
            <CardTitle>Accès non autorisé</CardTitle>
            <CardDescription>Vous devez être connecté pour accéder aux rapports.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <HeaderCard
        moduleLabel="Analyse / Exports"
        title="Exports et rapports"
        subtitle={headerSubtitle}
        icon={<BarChart3 className="h-5 w-5" />}
      >
        <KpiGrid columns={4} withTopBorder>
          {kpisLoading
            ? Array.from({ length: 4 }).map((_, index) => <ReportsKpiSkeleton key={`reports-kpi-skeleton-${index}`} />)
            : roleKpis.map((kpi) => (
                <KpiTile
                  key={kpi.key}
                  label={kpi.label}
                  value={kpi.value}
                  subValue={kpi.subValue}
                  icon={kpi.icon}
                  iconWrapperClassName={kpi.iconWrapperClassName}
                  valueClassName={kpi.valueClassName}
                />
              ))}
        </KpiGrid>
      </HeaderCard>
      
      <Tabs defaultValue="reports" className="space-y-5">
        <PremiumTabsNav
          tabs={[
            {
              value: "reports",
              label: "Rapports",
              icon: <TabIcon icon={FileText} />,
            },
            {
              value: "exports",
              label: "Exports",
              icon: <TabIcon icon={Download} />,
            },
            ...(canReadDocumentation(user?.role)
              ? [{
                  value: "documentation",
                  label: (
                    <span className="flex items-center gap-2">
                      Documentation
                      {documentationCount > 0 && (
                        <span className="ml-1 text-[10px] font-semibold bg-gray-200 text-gray-600 rounded-full px-1.5 py-0.5">
                          {documentationCount}
                        </span>
                      )}
                    </span>
                  ),
                  icon: <TabIcon icon={BookOpen} />,
                }]
              : []),
          ]}
        />

        <TabsContent value="reports" className="space-y-4">
          <Card className={cardClassName}>
            <CardHeader>
              <CardTitle>Générer un rapport</CardTitle>
              <CardDescription>
                Créez des rapports personnalisés en sélectionnant le type et la période
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="report-type">Type de rapport</Label>
                  <Select value={reportType} onValueChange={setReportType}>
                    <SelectTrigger id="report-type">
                      <SelectValue placeholder="Sélectionner un type de rapport" />
                    </SelectTrigger>
                    <SelectContent>
                      {reportTypes.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="format">Format</Label>
                  <Select value={format} onValueChange={setFormat}>
                    <SelectTrigger id="format">
                      <SelectValue placeholder="Sélectionner un format" />
                    </SelectTrigger>
                    <SelectContent>
                      {formatTypes.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label>Date de début</Label>
                  <DatePicker
                    date={startDate}
                    setDate={setStartDate}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label>Date de fin</Label>
                  <DatePicker
                    date={endDate}
                    setDate={setEndDate}
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Button 
                onClick={handleGenerateReport}
                disabled={isGenerating}
              >
                {isGenerating ? (
                  <>
                    <div className="h-4 w-4 mr-2 animate-spin rounded-full border-2 border-background border-t-foreground"></div>
                    Génération en cours...
                  </>
                ) : (
                  <>
                    <i className="fas fa-file-export mr-2"></i>
                    Générer le rapport
                  </>
                )}
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>
        
        <TabsContent value="exports" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <ExportCard
              title="Véhicules"
              subtitle="Flotte & immatriculations"
              description="Informations d'immatriculation, marque, modèle, année, kilométrage et statut."
              icon={<Truck className="h-5 w-5" />}
              tone="blue"
              loading={exportingStates.vehicles}
              onExport={() => handleExportData("vehicles")}
            />
            <ExportCard
              title="Ordres de travail"
              subtitle="Maintenance & interventions"
              description="Détails des interventions, techniciens assignés, pièces utilisées et coûts."
              icon={<Wrench className="h-5 w-5" />}
              tone="amber"
              loading={exportingStates.workOrders}
              onExport={() => handleExportData("work-orders")}
            />
            <ExportCard
              title="Inventaire"
              subtitle="Pièces détachées"
              description="Références, quantités en stock, prix d'achat et fournisseurs."
              icon={<Package className="h-5 w-5" />}
              tone="green"
              loading={exportingStates.inventory}
              onExport={() => handleExportData("inventory")}
            />
            <ExportCard
              title="Carburant"
              subtitle="Consommation & pleins"
              description="Dates, quantités, coûts et véhicules concernés."
              icon={<Fuel className="h-5 w-5" />}
              tone="amber"
              loading={exportingStates.fuel}
              onExport={() => handleExportData("fuel")}
            />
            <ExportCard
              title="Utilisateurs"
              subtitle="Comptes & rôles"
              description="Noms, rôles et coordonnées (sans les mots de passe)."
              icon={<Users className="h-5 w-5" />}
              tone="gray"
              loading={exportingStates.users}
              onExport={() => handleExportData("users")}
            />
            <ExportCard
              title="Base de données complète"
              subtitle="Sauvegarde globale"
              description="Sauvegarde complète de toutes les données pour archivage ou migration."
              icon={<Database className="h-5 w-5" />}
              tone="green"
              formatLabel="Exporter (.zip)"
              loading={exportingStates.complete}
              onExport={() => handleExportData("complete")}
            />
            <ExportCard
              title="Factures fournisseurs"
              subtitle="96 factures importées"
              description="Montants HT, TVA et soldes de toutes les factures fournisseurs."
              icon={<Receipt className="h-5 w-5" />}
              tone="blue"
              loading={exportingStates.supplierInvoices}
              onExport={exportSupplierInvoices}
            />
            <ExportCard
              title="Statistiques carburant"
              subtitle={`Période ${currentMonth}/${currentYear}`}
              description="Analyse détaillée de la consommation sur la période courante."
              icon={<BarChart3 className="h-5 w-5" />}
              tone="amber"
              loading={exportingStates.fuelStatistics}
              onExport={exportFuelStatistics}
            />
            <ExportCard
              title="Missions clients"
              subtitle="Export par client"
              description="Téléchargez les missions par client ou l'ensemble du portefeuille."
              icon={<Route className="h-5 w-5" />}
              tone="blue"
              footer={
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    {CLIENTS.map((client) => {
                      const loading = Boolean((exportingStates as Record<string, boolean>)[`client-${client}`]);
                      return (
                        <Button
                          key={client}
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs gap-1"
                          disabled={loading}
                          onClick={() => exportClientMissionsByClient(client)}
                        >
                          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                          {client}
                        </Button>
                      );
                    })}
                  </div>
                  <Button
                    size="sm"
                    className="w-full h-9 text-xs gap-1.5"
                    disabled={exportingStates.clientMissions}
                    onClick={exportClientMissions}
                  >
                    {exportingStates.clientMissions ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Export en cours...
                      </>
                    ) : (
                      <>
                        <Download className="h-3.5 w-3.5" />
                        Tous les clients
                      </>
                    )}
                  </Button>
                </div>
              }
            />
            <ExportCard
              title="Factures clients"
              subtitle="Facturation & paiements"
              description="Toutes les factures clients avec statuts de paiement."
              icon={<CreditCard className="h-5 w-5" />}
              tone="green"
              loading={exportingStates.clientInvoices}
              onExport={exportClientInvoices}
            />
            {user?.role === "admin" && (
              <ExportCard
                title="Outils d'administration"
                subtitle="Maintenance des données"
                description="Met à jour les marques et modèles des véhicules à partir des immatriculations existantes."
                icon={<Settings2 className="h-5 w-5" />}
                tone="amber"
                className="border-dashed border-amber-200"
                topBarClassName="bg-gradient-to-r from-amber-400 to-orange-400"
                footer={
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full h-9 text-xs gap-1.5"
                    disabled={isUpdatingVehicleData}
                    onClick={updateVehicleBrandModel}
                  >
                    {isUpdatingVehicleData ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Mise à jour en cours...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-3.5 w-3.5" />
                        Mettre à jour marques/modèles
                      </>
                    )}
                  </Button>
                }
              />
            )}
          </div>
        </TabsContent>

        <TabsContent value="documentation" className="space-y-4">
          {isLoadingDocs ? (
            <div className="flex items-center justify-center min-h-[400px]">
              <Loader2 className="h-8 w-8 animate-spin text-primary-text" />
            </div>
          ) : (
            <div className="space-y-6">
              <Card className={cardClassName}>
                <CardHeader>
                  <CardTitle>Documentation</CardTitle>
                  <CardDescription>
                    Exportez les documents de guide utilisateur et cahier de tests en PDF avec l'en-tête officiel
                  </CardDescription>
                </CardHeader>
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {docs?.files.map((doc) => (
                  <Card key={doc.name} className={cardClassName} data-testid={`card-doc-${doc.name}`}>
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                          <FileText className="h-6 w-6 text-primary-text" />
                        </div>
                        <div>
                          <CardTitle>{doc.title}</CardTitle>
                          <CardDescription>{doc.description}</CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          className="flex-1"
                          onClick={() => handlePreview(doc.name)}
                          data-testid={`button-preview-${doc.name}`}
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          Aperçu
                        </Button>
                        <Button
                          className="flex-1"
                          onClick={() => handleExportPDF(doc.name, doc.title)}
                          disabled={isExportingDoc}
                          data-testid={`button-export-${doc.name}`}
                        >
                          {isExportingDoc ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <Download className="h-4 w-4 mr-2" />
                          )}
                          Exporter PDF
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Dialog d'aperçu */}
              <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
                <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Aperçu du document</DialogTitle>
                    <DialogDescription>
                      {docs?.files.find(d => d.name === selectedDoc)?.description}
                    </DialogDescription>
                  </DialogHeader>
                  
                  {isLoadingContent ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-8 w-8 animate-spin text-primary-text" />
                    </div>
                  ) : (
                    <div className="prose prose-sm max-w-none dark:prose-invert">
                      <pre className="whitespace-pre-wrap text-xs bg-muted p-4 rounded-lg">
                        {docContent?.content}
                      </pre>
                    </div>
                  )}
                </DialogContent>
              </Dialog>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
