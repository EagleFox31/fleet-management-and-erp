import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Download, Eye, Loader2 } from "lucide-react";
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import jsPDF from 'jspdf';
import headerImage from '@assets/TAY-header-final.png';

interface DocumentFile {
  name: string;
  title: string;
  description: string;
}

interface DocumentContent {
  content: string;
  filename: string;
}

export default function Documentation() {
  const { toast } = useToast();
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Charger la liste des documents
  const { data: docs, isLoading } = useQuery<{ files: DocumentFile[] }>({
    queryKey: ['/api/documentation'],
  });

  // Charger le contenu d'un document
  const { data: docContent, isLoading: isLoadingContent } = useQuery<DocumentContent>({
    queryKey: ['/api/documentation', selectedDoc],
    enabled: !!selectedDoc && previewOpen,
  });

  const handlePreview = (filename: string) => {
    setSelectedDoc(filename);
    setPreviewOpen(true);
  };

  const addPDFHeader = (doc: jsPDF) => {
    const pageWidth = doc.internal.pageSize.width;
    
    try {
      // Dimensions de l'en-tête
      const pixelToMm = 25.4 / 72;
      const headerWidth = 1067 * pixelToMm * 0.4;
      const headerHeight = 236 * pixelToMm * 0.4;
      
      // Centrer horizontalement
      const headerX = (pageWidth - headerWidth) / 2;
      const headerY = 10;
      
      // Ajouter l'image d'en-tête
      doc.addImage(headerImage, 'PNG', headerX, headerY, headerWidth, headerHeight);
      
      // Ligne horizontale sous l'en-tête
      doc.setLineWidth(0.5);
      doc.line(15, headerY + headerHeight + 5, pageWidth - 15, headerY + headerHeight + 5);
      
      return headerY + headerHeight + 15;
    } catch (error) {
      console.error('Erreur lors du chargement de l\'image d\'en-tête:', error);
      
      // Fallback texte
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
    
    // Ligne horizontale
    doc.setLineWidth(0.3);
    doc.line(15, pageHeight - 20, pageWidth - 15, pageHeight - 20);
    
    // Informations du pied de page
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    
    const currentDate = new Date().toLocaleDateString('fr-FR');
    doc.text(`Document généré le ${currentDate}`, 15, pageHeight - 10);
    
    // Numéro de page
    const pageNumber = doc.getCurrentPageInfo().pageNumber;
    doc.text(`Page ${pageNumber}`, pageWidth - 15, pageHeight - 10, { align: 'right' });
  };

  const convertMarkdownToPDF = (content: string, title: string, filename: string) => {
    setIsExporting(true);
    
    try {
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      const pageWidth = doc.internal.pageSize.width;
      const pageHeight = doc.internal.pageSize.height;
      const margin = 15;
      const maxWidth = pageWidth - 2 * margin;
      
      // Ajouter l'en-tête
      let currentY = addPDFHeader(doc);
      
      // Titre du document
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text(title, pageWidth / 2, currentY, { align: 'center' });
      currentY += 12;
      
      // Traiter le contenu markdown ligne par ligne
      const lines = content.split('\n');
      
      for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        
        // Vérifier si on doit créer une nouvelle page
        if (currentY > pageHeight - 35) {
          doc.addPage();
          currentY = addPDFHeader(doc);
        }
        
        // Titres de niveau 1 (# )
        if (line.startsWith('# ')) {
          doc.setFontSize(16);
          doc.setFont('helvetica', 'bold');
          const text = line.substring(2);
          doc.text(text, margin, currentY);
          currentY += 10;
        }
        // Titres de niveau 2 (## )
        else if (line.startsWith('## ')) {
          doc.setFontSize(14);
          doc.setFont('helvetica', 'bold');
          const text = line.substring(3);
          doc.text(text, margin, currentY);
          currentY += 8;
        }
        // Titres de niveau 3 (### )
        else if (line.startsWith('### ')) {
          doc.setFontSize(12);
          doc.setFont('helvetica', 'bold');
          const text = line.substring(4);
          doc.text(text, margin, currentY);
          currentY += 7;
        }
        // Titres de niveau 4 (#### )
        else if (line.startsWith('#### ')) {
          doc.setFontSize(11);
          doc.setFont('helvetica', 'bold');
          const text = line.substring(5);
          doc.text(text, margin, currentY);
          currentY += 6;
        }
        // Lignes horizontales (---)
        else if (line.trim() === '---') {
          doc.setLineWidth(0.3);
          doc.line(margin, currentY, pageWidth - margin, currentY);
          currentY += 5;
        }
        // Listes à puces (- ou *)
        else if (line.match(/^[\s]*[-*]\s/)) {
          doc.setFontSize(10);
          doc.setFont('helvetica', 'normal');
          const indent = (line.match(/^[\s]*/)?.[0].length || 0) * 2;
          const text = line.replace(/^[\s]*[-*]\s/, '');
          const bullet = '•';
          doc.text(bullet, margin + indent, currentY);
          
          // Gérer le texte multiligne si trop long
          const splitText = doc.splitTextToSize(text, maxWidth - indent - 5);
          doc.text(splitText, margin + indent + 5, currentY);
          currentY += splitText.length * 5;
        }
        // Listes numérotées (1. 2. etc.)
        else if (line.match(/^[\s]*\d+\.\s/)) {
          doc.setFontSize(10);
          doc.setFont('helvetica', 'normal');
          const indent = (line.match(/^[\s]*/)?.[0].length || 0) * 2;
          const parts = line.match(/^[\s]*(\d+\.)\s(.*)$/);
          if (parts) {
            const number = parts[1];
            const text = parts[2];
            doc.text(number, margin + indent, currentY);
            
            const splitText = doc.splitTextToSize(text, maxWidth - indent - 10);
            doc.text(splitText, margin + indent + 10, currentY);
            currentY += splitText.length * 5;
          }
        }
        // Texte gras (**texte**)
        else if (line.includes('**')) {
          doc.setFontSize(10);
          const cleanedLine = line.replace(/\*\*/g, '');
          if (cleanedLine.trim()) {
            doc.setFont('helvetica', 'bold');
            const splitText = doc.splitTextToSize(cleanedLine, maxWidth);
            doc.text(splitText, margin, currentY);
            currentY += splitText.length * 5;
          }
        }
        // Ligne vide
        else if (line.trim() === '') {
          currentY += 3;
        }
        // Texte normal
        else if (line.trim()) {
          doc.setFontSize(10);
          doc.setFont('helvetica', 'normal');
          const cleanedLine = line.replace(/[#*`]/g, '').trim();
          if (cleanedLine) {
            const splitText = doc.splitTextToSize(cleanedLine, maxWidth);
            doc.text(splitText, margin, currentY);
            currentY += splitText.length * 5;
          }
        }
        
        // Ajouter le pied de page sur chaque page
        addPDFFooter(doc);
      }
      
      // Télécharger le PDF
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
      setIsExporting(false);
    }
  };

  const handleExportPDF = async (filename: string, title: string) => {
    try {
      const response = await fetch(`/api/documentation/${filename}`);
      const data: DocumentContent = await response.json();
      
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold" data-testid="heading-documentation">Documentation</h1>
        <p className="text-muted-foreground mt-2">
          Exportez les documents de guide utilisateur et cahier de tests en PDF avec l'en-tête officiel
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {docs?.files.map((doc) => (
          <Card key={doc.name} data-testid={`card-doc-${doc.name}`}>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <FileText className="h-6 w-6 text-primary" />
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
                  disabled={isExporting}
                  data-testid={`button-export-${doc.name}`}
                >
                  {isExporting ? (
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
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
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
  );
}
