import { userMessageOf } from "@/lib/api-error";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Upload, FileSpreadsheet, CheckCircle, XCircle, AlertCircle, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import * as XLSX from "xlsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ImportExcelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ImportResult {
  success: number;
  failed: number;
  total: number;
  errors: Array<{
    row: number;
    message: string;
  }>;
}

export function ImportExcelDialog({ open, onOpenChange }: ImportExcelDialogProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const { toast } = useToast();

  const downloadTemplate = () => {
    // Créer les données du template avec les en-têtes et une ligne d'exemple
    const templateData = [
      {
        "Numéro Facture": "FACT-2025-001",
        "Fournisseur": "Entreprise XYZ",
        "Date Facture": "15/01/2025",
        "Date Échéance": "15/02/2025",
        "Montant HT": "100000",
        "TVA (%)": "19.25",
        "Montant TTC": "119250",
        "N° Commande": "CMD-2025-001"
      }
    ];

    // Créer un nouveau workbook
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Factures");

    // Ajuster la largeur des colonnes
    const colWidths = [
      { wch: 20 }, // Numéro Facture
      { wch: 25 }, // Fournisseur
      { wch: 15 }, // Date Facture
      { wch: 15 }, // Date Échéance
      { wch: 15 }, // Montant HT
      { wch: 10 }, // TVA (%)
      { wch: 15 }, // Montant TTC
      { wch: 20 }, // N° Commande
    ];
    ws['!cols'] = colWidths;

    // Télécharger le fichier
    XLSX.writeFile(wb, "template_factures_fournisseurs.xlsx");

    toast({
      title: "Template téléchargé",
      description: "Le fichier template a été téléchargé avec succès.",
    });
  };

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      
      const response = await fetch("/api/supplier-invoices/import", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Erreur lors de l'import");
      }

      return response.json() as Promise<ImportResult>;
    },
    onSuccess: (data: ImportResult) => {
      setImportResult(data);
      
      if (data.success > 0) {
        queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices"] });
        
        toast({
          title: "Import réussi",
          description: `${data.success} facture(s) importée(s) avec succès.`,
        });
      }

      if (data.failed > 0) {
        toast({
          title: "Erreurs d'import",
          description: `${data.failed} facture(s) n'ont pas pu être importées.`,
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Erreur d'import",
        description: userMessageOf(error, "Une erreur s'est produite lors de l'import."),
        variant: "destructive",
      });
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setImportResult(null);
    }
  };

  const handleImport = () => {
    if (!selectedFile) return;
    uploadMutation.mutate(selectedFile);
  };

  const handleClose = () => {
    setSelectedFile(null);
    setImportResult(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Importer des factures depuis Excel
          </DialogTitle>
          <DialogDescription>
            Uploadez un fichier Excel (.xlsx) contenant les factures fournisseurs à importer en masse.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Instructions */}
          <div className="flex gap-3">
            <Alert className="flex-1">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Format attendu</AlertTitle>
              <AlertDescription className="text-sm space-y-1">
                <p>Le fichier Excel doit contenir les colonnes suivantes :</p>
                <ul className="list-disc list-inside ml-2 mt-2 space-y-1">
                  <li><strong>Numéro Facture</strong> : Numéro unique de la facture</li>
                  <li><strong>Fournisseur</strong> : Nom du fournisseur</li>
                  <li><strong>Date Facture</strong> : Format JJ/MM/AAAA</li>
                  <li><strong>Date Échéance</strong> : Format JJ/MM/AAAA</li>
                  <li><strong>Montant HT</strong> : Montant hors taxes</li>
                  <li><strong>TVA (%)</strong> : Taux de TVA (ex: 19.25)</li>
                  <li><strong>Montant TTC</strong> : Montant toutes taxes comprises</li>
                  <li><strong>N° Commande</strong> (optionnel) : Numéro de bon de commande</li>
                </ul>
              </AlertDescription>
            </Alert>
            <div className="flex items-start pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={downloadTemplate}
                data-testid="button-download-template"
                className="whitespace-nowrap"
              >
                <Download className="mr-2 h-4 w-4" />
                Télécharger Template
              </Button>
            </div>
          </div>

          {/* Zone de sélection de fichier */}
          <div className="border-2 border-dashed rounded-lg p-8 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="rounded-full bg-primary/10 p-4">
                <Upload className="h-8 w-8 text-primary-text" />
              </div>
              
              {selectedFile ? (
                <div className="space-y-2">
                  <p className="font-medium">{selectedFile.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {(selectedFile.size / 1024).toFixed(2)} KB
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="font-medium">Sélectionnez un fichier Excel</p>
                  <p className="text-sm text-muted-foreground">
                    Formats acceptés : .xlsx
                  </p>
                </div>
              )}

              <input
                type="file"
                accept=".xlsx"
                onChange={handleFileSelect}
                className="hidden"
                id="excel-upload"
                data-testid="input-excel-file"
              />
              <label htmlFor="excel-upload">
                <Button variant="outline" type="button" asChild>
                  <span>Choisir un fichier</span>
                </Button>
              </label>
            </div>
          </div>

          {/* Résultats de l'import */}
          {importResult && (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-lg border p-4 bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800">
                  <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
                    <CheckCircle className="h-4 w-4" />
                    <span className="font-medium">Succès</span>
                  </div>
                  <p className="text-2xl font-bold mt-2 text-green-700 dark:text-green-300">
                    {importResult.success}
                  </p>
                </div>

                <div className="rounded-lg border p-4 bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800">
                  <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
                    <XCircle className="h-4 w-4" />
                    <span className="font-medium">Échecs</span>
                  </div>
                  <p className="text-2xl font-bold mt-2 text-red-700 dark:text-red-300">
                    {importResult.failed}
                  </p>
                </div>

                <div className="rounded-lg border p-4 bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
                  <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
                    <FileSpreadsheet className="h-4 w-4" />
                    <span className="font-medium">Total</span>
                  </div>
                  <p className="text-2xl font-bold mt-2 text-blue-700 dark:text-blue-300">
                    {importResult.total}
                  </p>
                </div>
              </div>

              {/* Erreurs détaillées */}
              {importResult.errors.length > 0 && (
                <div className="rounded-lg border border-red-200 dark:border-red-800 p-4 max-h-64 overflow-y-auto">
                  <h4 className="font-medium text-red-700 dark:text-red-300 mb-2">
                    Erreurs détaillées :
                  </h4>
                  <ul className="space-y-2 text-sm">
                    {importResult.errors.map((error, index) => (
                      <li key={index} className="text-red-600 dark:text-red-400">
                        <strong>Ligne {error.row}:</strong> {error.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Barre de progression */}
          {uploadMutation.isPending && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Import en cours...</p>
              <Progress value={undefined} className="w-full" />
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={handleClose} data-testid="button-cancel-import">
              {importResult ? "Fermer" : "Annuler"}
            </Button>
            {!importResult && (
              <Button
                onClick={handleImport}
                disabled={!selectedFile || uploadMutation.isPending}
                data-testid="button-start-import"
              >
                <Upload className="mr-2 h-4 w-4" />
                {uploadMutation.isPending ? "Import..." : "Importer"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
