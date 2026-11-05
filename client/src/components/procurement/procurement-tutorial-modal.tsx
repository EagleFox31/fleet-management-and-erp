import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Package, Store, ShoppingCart, FileText, CheckCircle2, ArrowRight, Info, PenLine, FileSpreadsheet, SearchCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface ProcurementTutorialModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProcurementTutorialModal({ open, onOpenChange }: ProcurementTutorialModalProps) {
  const [currentStep, setCurrentStep] = useState(0);

  const steps = [
    {
      title: "Bienvenue dans l'Approvisionnement",
      icon: Package,
      content: (
        <div className="space-y-4">
          <p className="text-muted-foreground">
            Le module d'approvisionnement vous permet de gérer efficacement vos fournisseurs, 
            commandes et factures reçues en un seul endroit.
          </p>
          <div className="grid gap-3 mt-4">
            <Card className="p-4 border-l-4 border-l-blue-500">
              <div className="flex items-start gap-3">
                <Store className="w-5 h-5 text-blue-500 mt-0.5" />
                <div>
                  <h4 className="font-medium">Fournisseurs</h4>
                  <p className="text-sm text-muted-foreground">Gérez votre base de fournisseurs</p>
                </div>
              </div>
            </Card>
            <Card className="p-4 border-l-4 border-l-green-500">
              <div className="flex items-start gap-3">
                <ShoppingCart className="w-5 h-5 text-green-500 mt-0.5" />
                <div>
                  <h4 className="font-medium">Commandes</h4>
                  <p className="text-sm text-muted-foreground">Créez et suivez vos bons de commande</p>
                </div>
              </div>
            </Card>
            <Card className="p-4 border-l-4 border-l-orange-500">
              <div className="flex items-start gap-3">
                <FileText className="w-5 h-5 text-orange-500 mt-0.5" />
                <div>
                  <h4 className="font-medium">Factures Reçues</h4>
                  <p className="text-sm text-muted-foreground">Gérez les factures de vos fournisseurs</p>
                </div>
              </div>
            </Card>
          </div>
        </div>
      ),
    },
    {
      title: "Gestion des Fournisseurs",
      icon: Store,
      content: (
        <div className="space-y-4">
          <p className="text-muted-foreground">
            Centralisez toutes les informations de vos fournisseurs pour faciliter vos achats.
          </p>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5 shrink-0" />
              <div>
                <h4 className="font-medium text-sm">Ajoutez vos fournisseurs</h4>
                <p className="text-sm text-muted-foreground">
                  Enregistrez les coordonnées, contacts et conditions commerciales
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5 shrink-0" />
              <div>
                <h4 className="font-medium text-sm">Suivez les performances</h4>
                <p className="text-sm text-muted-foreground">
                  Évaluez la qualité et les délais de livraison
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5 shrink-0" />
              <div>
                <h4 className="font-medium text-sm">Optimisez vos achats</h4>
                <p className="text-sm text-muted-foreground">
                  Comparez les prix et négociez les meilleures conditions
                </p>
              </div>
            </div>
          </div>
        </div>
      ),
    },
    {
      title: "Gestion des Commandes",
      icon: ShoppingCart,
      content: (
        <div className="space-y-4">
          <p className="text-muted-foreground">
            Créez des bons de commande groupés pour optimiser vos coûts et obtenir de meilleurs tarifs.
          </p>
          <div className="bg-blue-50 dark:bg-blue-950/30 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-blue-500 mt-0.5 shrink-0" />
              <div>
                <h4 className="font-medium text-sm text-blue-900 dark:text-blue-100">Groupement automatique</h4>
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  Les demandes de pièces d'un même fournisseur sont automatiquement regroupées 
                  pour obtenir des remises de volume (5-10% d'économies ciblées).
                </p>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <Badge variant="outline" className="text-xs">Statuts disponibles</Badge>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-yellow-500"></div>
                <span>En attente</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                <span>Confirmée</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-purple-500"></div>
                <span>En cours</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500"></div>
                <span>Livrée</span>
              </div>
            </div>
          </div>
        </div>
      ),
    },
    {
      title: "Gestion des Factures Reçues",
      icon: FileText,
      content: (
        <div className="space-y-4">
          <p className="text-muted-foreground">
            Gérez les factures de vos fournisseurs avec validation automatique et suivi des paiements.
          </p>
          <div className="space-y-3">
            <Card className="p-3 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 border-green-200 dark:border-green-800">
              <h4 className="font-medium text-sm mb-2"><PenLine className="inline h-4 w-4 mr-1.5 align-text-bottom" aria-hidden />Saisie manuelle</h4>
              <p className="text-xs text-muted-foreground">
                Enregistrez vos factures une par une avec tous les détails
              </p>
            </Card>
            <Card className="p-3 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border-blue-200 dark:border-blue-800">
              <h4 className="font-medium text-sm mb-2"><FileSpreadsheet className="inline h-4 w-4 mr-1.5 align-text-bottom" aria-hidden />Import Excel</h4>
              <p className="text-xs text-muted-foreground">
                Importez plusieurs factures en masse depuis un fichier Excel
              </p>
            </Card>
            <Card className="p-3 bg-gradient-to-r from-purple-50 to-violet-50 dark:from-purple-950/30 dark:to-violet-950/30 border-purple-200 dark:border-purple-800">
              <h4 className="font-medium text-sm mb-2"><SearchCheck className="inline h-4 w-4 mr-1.5 align-text-bottom" aria-hidden />Validation automatique</h4>
              <p className="text-xs text-muted-foreground">
                Rapprochement automatique facture/commande pour détecter les écarts
              </p>
            </Card>
          </div>
          <div className="bg-amber-50 dark:bg-amber-950/30 p-3 rounded-lg border border-amber-200 dark:border-amber-800">
            <p className="text-xs text-amber-900 dark:text-amber-100">
              <strong>Astuce :</strong> Téléchargez le template Excel pour voir le format attendu avant votre premier import.
            </p>
          </div>
        </div>
      ),
    },
  ];

  const currentStepData = steps[currentStep];
  const IconComponent = currentStepData.icon;

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      onOpenChange(false);
      setCurrentStep(0);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto" data-testid="procurement-tutorial-modal">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <IconComponent className="w-6 h-6 text-primary-text" />
            </div>
            <div>
              <DialogTitle className="text-xl">{currentStepData.title}</DialogTitle>
              <DialogDescription>
                Étape {currentStep + 1} sur {steps.length}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="py-4">
          {currentStepData.content}
        </div>

        <div className="flex items-center justify-between pt-4 border-t">
          <div className="flex gap-1">
            {steps.map((_, index) => (
              <div
                key={index}
                className={`h-2 w-8 rounded-full transition-colors ${
                  index === currentStep
                    ? "bg-primary"
                    : index < currentStep
                    ? "bg-primary/50"
                    : "bg-muted"
                }`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {currentStep > 0 && (
              <Button
                variant="outline"
                onClick={handlePrevious}
                data-testid="button-previous-step"
              >
                Précédent
              </Button>
            )}
            <Button
              onClick={handleNext}
              data-testid="button-next-step"
            >
              {currentStep < steps.length - 1 ? (
                <>
                  Suivant
                  <ArrowRight className="w-4 h-4 ml-2" />
                </>
              ) : (
                "Terminer"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
