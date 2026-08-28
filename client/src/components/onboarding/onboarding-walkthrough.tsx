import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { FleetMascot, FleetMascotVariants } from "./fleet-mascot";
import { useLocation } from "wouter";
import { 
  Truck, 
  Settings, 
  Plus, 
  BarChart3, 
  Wrench, 
  Fuel,
  FileText,
  Users,
  CheckCircle,
  ArrowRight,
  X,
  ChevronRight,
  ChevronLeft
} from "lucide-react";

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  content: string;
  mascotMessage: string;
  mascotVariant: "default" | "happy" | "thinking" | "celebrating" | "warning";
  icon: React.ReactNode;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  highlight?: {
    selector: string;
    description: string;
  };
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: "welcome",
    title: "Bienvenue dans FleetManager Pro",
    description: "Votre système de gestion de flotte intelligent",
    content: "Je suis FleetBot, votre assistant virtuel ! Je vais vous guider dans la découverte de toutes les fonctionnalités qui vous aideront à gérer efficacement votre flotte de véhicules.",
    mascotMessage: "Salut ! Je suis ravi de vous accompagner dans cette découverte !",
    mascotVariant: "happy",
    icon: <Truck className="w-6 h-6" />,
    action: {
      label: "Commencer la visite",
    }
  },
  {
    id: "dashboard",
    title: "Tableau de bord principal",
    description: "Vue d'ensemble de votre flotte",
    content: "Le tableau de bord vous donne une vue complète de l'état de votre flotte : véhicules opérationnels, en maintenance, statistiques de carburant et alertes importantes.",
    mascotMessage: "Ici vous pouvez voir tout ce qui se passe avec vos véhicules d'un coup d'œil !",
    mascotVariant: "default",
    icon: <BarChart3 className="w-6 h-6" />,
    action: {
      label: "Voir le tableau de bord",
      href: "/"
    }
  },
  {
    id: "vehicles",
    title: "Gestion des véhicules",
    description: "Centralisation de votre flotte",
    content: "Gérez tous vos véhicules depuis un seul endroit : ajoutez de nouveaux véhicules, consultez leurs détails, suivez leur statut et gérez leur documentation.",
    mascotMessage: "C'est ici que vous pouvez ajouter et gérer tous vos véhicules !",
    mascotVariant: "thinking",
    icon: <Truck className="w-6 h-6" />,
    action: {
      label: "Gérer les véhicules",
      href: "/vehicles"
    },
    highlight: {
      selector: "[data-testid='add-vehicle-button']",
      description: "Cliquez ici pour ajouter un nouveau véhicule"
    }
  },
  {
    id: "maintenance",
    title: "Maintenance préventive",
    description: "Gardez vos véhicules en parfait état",
    content: "Planifiez et suivez toutes vos opérations de maintenance : révisions, réparations, pièces détachées et historique complet des interventions.",
    mascotMessage: "La maintenance préventive vous fera économiser du temps et de l'argent !",
    mascotVariant: "default",
    icon: <Wrench className="w-6 h-6" />,
    action: {
      label: "Voir la maintenance",
      href: "/maintenance"
    }
  },
  {
    id: "fuel",
    title: "Suivi carburant",
    description: "Optimisez votre consommation",
    content: "Enregistrez tous vos pleins, analysez la consommation, détectez les anomalies et générez des rapports détaillés pour optimiser vos coûts.",
    mascotMessage: "Suivez votre consommation pour réduire vos coûts de carburant !",
    mascotVariant: "default",
    icon: <Fuel className="w-6 h-6" />,
    action: {
      label: "Gérer le carburant",
      href: "/fuel"
    }
  },
  {
    id: "inventory",
    title: "Inventaire des pièces",
    description: "Gérez votre stock intelligemment",
    content: "Tenez l'inventaire de toutes vos pièces détachées, recevez des alertes de stock bas et suivez l'utilisation pour chaque véhicule.",
    mascotMessage: "Un bon inventaire évite les pannes et les temps d'arrêt !",
    mascotVariant: "thinking",
    icon: <Settings className="w-6 h-6" />,
    action: {
      label: "Voir l'inventaire",
      href: "/inventory"
    }
  },
  {
    id: "users",
    title: "Gestion des utilisateurs",
    description: "Contrôlez les accès et permissions",
    content: "Gérez votre équipe : mécaniciens, chauffeurs, gestionnaires. Attribuez les rôles et permissions appropriés pour chaque utilisateur.",
    mascotMessage: "Organisez votre équipe avec les bons rôles et permissions !",
    mascotVariant: "default",
    icon: <Users className="w-6 h-6" />,
    action: {
      label: "Gérer les utilisateurs",
      href: "/users"
    }
  },
  {
    id: "complete",
    title: "Félicitations !",
    description: "Vous êtes prêt à utiliser FleetManager Pro",
    content: "Vous avez maintenant une vue d'ensemble complète du système. N'hésitez pas à cliquer sur mon icône si vous avez besoin d'aide !",
    mascotMessage: "Bravo ! Vous maîtrisez maintenant les bases de FleetManager Pro !",
    mascotVariant: "celebrating",
    icon: <CheckCircle className="w-6 h-6" />,
    action: {
      label: "Commencer à utiliser",
    }
  }
];

interface OnboardingWalkthroughProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
}

export function OnboardingWalkthrough({ isOpen, onClose, onComplete }: OnboardingWalkthroughProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [, setLocation] = useLocation();

  const currentStep = ONBOARDING_STEPS[currentStepIndex];
  const progress = ((currentStepIndex + 1) / ONBOARDING_STEPS.length) * 100;

  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
    }
  }, [isOpen]);

  const handleNext = () => {
    if (currentStepIndex < ONBOARDING_STEPS.length - 1) {
      setCurrentStepIndex(currentStepIndex + 1);
    } else {
      handleComplete();
    }
  };

  const handlePrevious = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(currentStepIndex - 1);
    }
  };

  const handleComplete = () => {
    setIsVisible(false);
    setTimeout(() => {
      onComplete();
      onClose();
    }, 300);
  };

  const handleSkip = () => {
    setIsVisible(false);
    setTimeout(() => {
      onClose();
    }, 300);
  };

  const handleStepAction = () => {
    if (currentStep.action?.href) {
      // Utiliser la navigation interne au lieu du rechargement de page
      setLocation(currentStep.action.href);
      // Si c'est le dernier step, on complete d'abord
      if (currentStepIndex === ONBOARDING_STEPS.length - 1) {
        handleComplete();
      } else {
        // Passer à l'étape suivante après navigation
        handleNext();
      }
    } else if (currentStep.action?.onClick) {
      currentStep.action.onClick();
    } else {
      handleNext();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Overlay */}
          <motion.div
            className="fixed inset-0 bg-black/50 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: isVisible ? 1 : 0 }}
            exit={{ opacity: 0 }}
            onClick={handleSkip}
          />

          {/* Onboarding Modal */}
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ 
              opacity: isVisible ? 1 : 0, 
              scale: isVisible ? 1 : 0.9 
            }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.3 }}
          >
            <Card className="w-full max-w-2xl max-h-[90vh] overflow-hidden">
              <CardHeader className="relative pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <FleetMascotVariants 
                      variant={currentStep.mascotVariant} 
                      size="sm" 
                    />
                    <div>
                      <CardTitle className="text-xl">{currentStep.title}</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {currentStep.description}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleSkip}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>

                {/* Progress Bar */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">
                      Étape {currentStepIndex + 1} sur {ONBOARDING_STEPS.length}
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      {Math.round(progress)}%
                    </Badge>
                  </div>
                  <Progress value={progress} className="h-2" />
                </div>
              </CardHeader>

              <CardContent className="space-y-6">
                {/* Step Content */}
                <motion.div
                  key={currentStep.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3 }}
                  className="space-y-4"
                >
                  {/* Step Icon */}
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center text-blue-600 dark:text-blue-400">
                      {currentStep.icon}
                    </div>
                    <div className="flex-1">
                      <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
                        {currentStep.content}
                      </p>
                    </div>
                  </div>

                  {/* Mascot Message */}
                  <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border-l-4 border-blue-500">
                    <div className="flex items-start space-x-3">
                      <FleetMascotVariants 
                        variant={currentStep.mascotVariant} 
                        size="sm" 
                      />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-1">
                          FleetBot dit :
                        </p>
                        <p className="text-sm text-blue-800 dark:text-blue-200">
                          {currentStep.mascotMessage}
                        </p>
                      </div>
                    </div>
                  </div>
                </motion.div>

                {/* Navigation */}
                <div className="flex items-center justify-between pt-4 border-t">
                  <Button
                    variant="outline"
                    onClick={handlePrevious}
                    disabled={currentStepIndex === 0}
                    className="flex items-center space-x-2"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>Précédent</span>
                  </Button>

                  <div className="flex items-center space-x-2">
                    <Button
                      variant="ghost"
                      onClick={handleSkip}
                      className="text-muted-foreground"
                    >
                      Ignorer la visite
                    </Button>

                    <Button
                      onClick={currentStep.action ? handleStepAction : handleNext}
                      className="flex items-center space-x-2"
                    >
                      <span>
                        {currentStep.action?.label || 
                         (currentStepIndex === ONBOARDING_STEPS.length - 1 ? "Terminer" : "Suivant")}
                      </span>
                      {currentStepIndex !== ONBOARDING_STEPS.length - 1 && (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}