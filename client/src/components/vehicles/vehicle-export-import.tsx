import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useQuery } from '@tanstack/react-query';
import { vehiclesToExcel, excelToVehicles, downloadExcel } from '@/lib/excel-utils';
import { queryClient } from '@/lib/queryClient';
import { Vehicle, InsertVehicle } from '@shared/schema';
import { Download, Upload, FileText, CheckCircle, AlertCircle, FileDown } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { useErrorHandler } from '@/lib/errorHandling';
import { downloadTemplate, TemplateType } from '@/lib/template-generator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function VehicleExportButton() {
  const { toast } = useToast();
  const { showError } = useErrorHandler();

  // Récupérer tous les véhicules pour l'export
  const { data, isLoading } = useQuery<any>({
    queryKey: ['/api/vehicles'],
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: false,
  });
  
  // Extraire les véhicules à partir de la réponse (structure { vehicles: Vehicle[], total: number })
  const vehicles = data?.vehicles || [];

  const handleExport = async () => {
    // Si nous avons des véhicules dans la base de données, les exporter normalement
    if (vehicles && vehicles.length > 0) {
      try {
        const excelData = vehiclesToExcel(vehicles);
        downloadExcel(excelData, `export_vehicules_${new Date().toLocaleDateString('fr-FR').replace(/\//g, '-')}.xlsx`);
        
        toast({
          title: 'Exportation réussie',
          description: `${vehicles.length} véhicule(s) ont été exportés avec succès.`,
          variant: 'default',
        });
      } catch (error) {
        showError(error);
      }
    } else {
      // Si aucun véhicule n'existe, générer un modèle avec des exemples
      try {
        toast({
          title: 'Aucun véhicule à exporter',
          description: 'Un modèle avec des exemples sera généré à la place.',
          variant: 'default',
        });
        
        // Attendre un peu pour que l'utilisateur puisse voir le message
        setTimeout(() => {
          downloadTemplate(TemplateType.VEHICLES, { includeExamples: true });
        }, 500);
      } catch (error) {
        showError(error);
      }
    }
  };

  return (
    <Button 
      variant="outline" 
      size="sm" 
      className="mr-2" 
      onClick={handleExport} 
      disabled={isLoading}
    >
      <Download className="mr-2 h-4 w-4" />
      Exporter
    </Button>
  );
}

export function VehicleImportButton() {
  const { toast } = useToast();
  const { showError } = useErrorHandler();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [importSummary, setImportSummary] = useState<{
    total: number;
    success: number;
    errors: number;
    errorMessages: string[];
  } | null>(null);
  
  // État pour suivre l'onglet actif
  const [activeTab, setActiveTab] = useState('upload');

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    setSelectedFile(file);
    // Reset import summary when new file is selected
    setImportSummary(null);
  };
  
  // Fonction pour télécharger le modèle d'import
  const handleDownloadTemplate = () => {
    try {
      downloadTemplate(TemplateType.VEHICLES, { includeExamples: true });
      toast({
        title: 'Modèle téléchargé',
        description: 'Le modèle d\'importation a été téléchargé avec succès',
        variant: 'default',
      });
    } catch (error) {
      showError(error);
    }
  };

  const handleImport = async () => {
    if (!selectedFile) {
      toast({
        title: 'Aucun fichier sélectionné',
        description: 'Veuillez sélectionner un fichier Excel à importer.',
        variant: 'destructive',
      });
      return;
    }

    setIsUploading(true);
    setProgress(10);

    try {
      // Parse Excel file
      const vehiclesData = await excelToVehicles(selectedFile);
      setProgress(30);

      if (vehiclesData.length === 0) {
        toast({
          title: 'Fichier vide',
          description: 'Le fichier ne contient aucune donnée de véhicule valide.',
          variant: 'destructive',
        });
        setIsUploading(false);
        return;
      }

      const results = {
        total: vehiclesData.length,
        success: 0,
        errors: 0,
        errorMessages: [] as string[],
      };

      // Process each vehicle one by one
      for (let i = 0; i < vehiclesData.length; i++) {
        const vehicleData = vehiclesData[i];
        
        try {
          // Check if vehicle with this registration already exists
          if (vehicleData.registrationNumber) {
            const checkResponse = await fetch(`/api/vehicles/check/${vehicleData.registrationNumber}`);
            const existingVehicle = await checkResponse.json();
            
            if (existingVehicle && existingVehicle.id) {
              // Update existing vehicle
              await fetch(`/api/vehicles/${existingVehicle.id}`, {
                method: 'PATCH',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify(vehicleData),
                credentials: 'include'
              });
            } else {
              // Create new vehicle
              await fetch('/api/vehicles', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify(vehicleData),
                credentials: 'include'
              });
            }
            
            results.success++;
          } else {
            results.errors++;
            results.errorMessages.push(`Ligne ${i + 1}: Immatriculation manquante`);
          }
        } catch (error) {
          results.errors++;
          results.errorMessages.push(`Ligne ${i + 1}: ${(error as Error).message || 'Erreur inconnue'}`);
        }
        
        // Update progress
        setProgress(30 + Math.floor((i + 1) / vehiclesData.length * 70));
      }

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['/api/vehicles'] });
      
      setImportSummary(results);
      
      toast({
        title: 'Importation terminée',
        description: `${results.success} véhicules importés avec succès. ${results.errors} erreurs.`,
        variant: results.errors > 0 ? 'destructive' : 'default',
      });
    } catch (error) {
      showError(error);
    } finally {
      setIsUploading(false);
      setProgress(100);
    }
  };

  return (
    <>
      <Button 
        variant="outline" 
        size="sm" 
        onClick={() => setIsOpen(true)}
      >
        <Upload className="mr-2 h-4 w-4" />
        Importer
      </Button>
      
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Importer des véhicules</DialogTitle>
            <DialogDescription>
              Importez des véhicules depuis un fichier Excel ou téléchargez un modèle à remplir.
            </DialogDescription>
          </DialogHeader>
          
          <Tabs defaultValue="upload" value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="upload">Importer un fichier</TabsTrigger>
              <TabsTrigger value="template">Télécharger un modèle</TabsTrigger>
            </TabsList>
            
            <TabsContent value="upload" className="mt-4">
              <div className="grid gap-4 py-2">
                <div className="flex flex-col gap-2">
                  <label htmlFor="file-upload" className="text-sm font-medium">
                    Fichier Excel
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="file-upload"
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={handleFileChange}
                      className="hidden"
                      disabled={isUploading}
                    />
                    <Button
                      variant="outline"
                      onClick={() => document.getElementById('file-upload')?.click()}
                      disabled={isUploading}
                      className="w-full justify-start"
                    >
                      <FileText className="mr-2 h-4 w-4" />
                      {selectedFile ? selectedFile.name : 'Choisir un fichier'}
                    </Button>
                  </div>
                </div>
                
                {isUploading && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Progression</span>
                      <span>{progress}%</span>
                    </div>
                    <Progress value={progress} className="h-2" />
                  </div>
                )}
                
                {importSummary && (
                  <div className="border rounded-md p-3 bg-secondary/20">
                    <div className="flex items-center gap-2 font-medium">
                      {importSummary.errors === 0 ? (
                        <CheckCircle className="h-5 w-5 text-green-500" />
                      ) : (
                        <AlertCircle className="h-5 w-5 text-yellow-500" />
                      )}
                      <span>Résumé de l'importation</span>
                    </div>
                    <div className="mt-2 space-y-1 text-sm">
                      <p>Total: {importSummary.total} véhicules</p>
                      <p className="text-green-600">Réussis: {importSummary.success} véhicules</p>
                      {importSummary.errors > 0 && (
                        <>
                          <p className="text-red-600">Erreurs: {importSummary.errors} véhicules</p>
                          <div className="mt-2 max-h-32 overflow-y-auto">
                            <ul className="list-disc list-inside text-sm text-red-600">
                              {importSummary.errorMessages.map((error, index) => (
                                <li key={index}>{error}</li>
                              ))}
                            </ul>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
              
              <div className="mt-4 flex justify-between">
                <Button 
                  variant="outline" 
                  onClick={() => setIsOpen(false)}
                  disabled={isUploading}
                >
                  Annuler
                </Button>
                <Button 
                  onClick={handleImport} 
                  disabled={!selectedFile || isUploading}
                >
                  {isUploading ? 'Importation en cours...' : 'Importer'}
                </Button>
              </div>
            </TabsContent>
            
            <TabsContent value="template" className="mt-4">
              <div className="flex flex-col gap-4">
                <div className="text-sm text-muted-foreground">
                  <p>Téléchargez un modèle Excel préconfiguré pour préparer vos données d'importation.</p>
                  <ul className="mt-2 list-disc list-inside">
                    <li>Le modèle contient toutes les colonnes nécessaires</li>
                    <li>Des exemples sont inclus pour vous guider</li>
                    <li>Après avoir rempli le fichier, revenez à l'onglet "Importer"</li>
                  </ul>
                </div>
                
                <Button 
                  className="mt-2 w-full"
                  onClick={handleDownloadTemplate}
                >
                  <FileDown className="mr-2 h-4 w-4" />
                  Télécharger le modèle
                </Button>
                
                <div className="flex flex-col text-sm text-muted-foreground mt-4">
                  <p className="font-semibold">Comment utiliser le modèle :</p>
                  <ol className="list-decimal list-inside mt-1 space-y-1">
                    <li>Téléchargez le modèle Excel</li>
                    <li>Remplissez les colonnes avec vos données de véhicules</li>
                    <li>Conservez les en-têtes de colonnes d'origine</li>
                    <li>Enregistrez le fichier au format Excel (.xlsx)</li>
                    <li>Revenez à l'onglet "Importer un fichier" pour télécharger votre fichier</li>
                  </ol>
                </div>
              </div>
              
              <div className="mt-4 flex justify-end">
                <Button 
                  variant="outline" 
                  onClick={() => setActiveTab('upload')}
                >
                  Retour à l'import
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}