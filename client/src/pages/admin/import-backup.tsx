import { userMessageOf } from "@/lib/api-error";
import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, AlertCircle, Upload, Database } from "lucide-react";

export default function ImportBackup() {
  const { toast } = useToast();
  const [importResult, setImportResult] = useState<any>(null);

  const importMutation = useMutation({
    mutationFn: () => apiRequest("/api/admin/import-backup", "POST"),
    onSuccess: (data) => {
      setImportResult(data);
      toast({
        title: "Import réussi !",
        description: "Toutes vos données ont été importées avec succès.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Erreur d'import",
        description: userMessageOf(error, "Une erreur est survenue lors de l'import"),
        variant: "destructive",
      });
    },
  });

  const handleImport = () => {
    if (confirm("Êtes-vous sûr de vouloir importer les données de sauvegarde ? Cela remplacera les données existantes.")) {
      importMutation.mutate();
    }
  };

  return (
    <div>
      <PageHeader 
        title="Import de données" 
        subtitle="Restaurer vos données de sauvegarde après déploiement"
      />
      
      <div className="max-w-2xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Database className="h-5 w-5 mr-2" />
              Import des données de sauvegarde
            </CardTitle>
            <CardDescription>
              Cette fonction va importer toutes vos données sauvegardées (véhicules, pièces, ordres de travail, etc.) 
              dans votre nouvelle installation déployée.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!importResult && (
              <>
                <div className="bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                  <div className="flex items-start">
                    <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mt-0.5 mr-3" />
                    <div>
                      <h4 className="font-medium text-yellow-800 dark:text-yellow-300">Attention</h4>
                      <p className="text-sm text-yellow-700 dark:text-yellow-400 mt-1">
                        Cet import va remplacer toutes les données existantes (sauf les utilisateurs). 
                        Assurez-vous d'avoir fait une sauvegarde si nécessaire.
                      </p>
                    </div>
                  </div>
                </div>
                
                <Button 
                  onClick={handleImport}
                  disabled={importMutation.isPending}
                  className="w-full"
                  size="lg"
                >
                  {importMutation.isPending ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Import en cours...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" />
                      Importer les données de sauvegarde
                    </>
                  )}
                </Button>
              </>
            )}

            {importResult && (
              <div className="space-y-4">
                <div className="bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800 rounded-lg p-4">
                  <div className="flex items-center">
                    <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 mr-3" />
                    <div>
                      <h4 className="font-medium text-green-800 dark:text-green-300">Import réussi !</h4>
                      <p className="text-sm text-green-700 dark:text-green-400 mt-1">
                        {importResult.message}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                    <div className="text-sm text-gray-600 dark:text-gray-400">Utilisateurs</div>
                    <div className="text-2xl font-bold">{importResult.stats?.users || 0}</div>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                    <div className="text-sm text-gray-600 dark:text-gray-400">Véhicules</div>
                    <div className="text-2xl font-bold">{importResult.stats?.vehicles || 0}</div>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                    <div className="text-sm text-gray-600 dark:text-gray-400">Pièces</div>
                    <div className="text-2xl font-bold">{importResult.stats?.parts || 0}</div>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                    <div className="text-sm text-gray-600 dark:text-gray-400">Ordres de travail</div>
                    <div className="text-2xl font-bold">{importResult.stats?.workOrders || 0}</div>
                  </div>
                </div>

                <Button 
                  onClick={() => window.location.href = "/"}
                  className="w-full"
                  variant="outline"
                >
                  Retour au tableau de bord
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}