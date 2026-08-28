import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FleetMascot } from "./fleet-mascot";
import { useOnboarding } from "@/hooks/use-onboarding";
import { 
  HelpCircle, 
  X, 
  Lightbulb, 
  BookOpen, 
  MessageSquare,
  Settings
} from "lucide-react";

const HELP_MESSAGES = {
  dashboard: "Voici votre tableau de bord ! Vous pouvez voir l'état de tous vos véhicules et les statistiques importantes.",
  vehicles: "Gérez tous vos véhicules ici. Cliquez sur 'Ajouter un véhicule' pour commencer !",
  maintenance: "Planifiez vos maintenances pour éviter les pannes. La prévention vous fera économiser !",
  fuel: "Suivez votre consommation de carburant pour optimiser vos coûts. Chaque litre compte !",
  inventory: "Gardez un œil sur votre stock de pièces détachées. Les alertes vous préviendront quand c'est nécessaire.",
  users: "Organisez votre équipe avec les bons rôles et permissions pour chaque utilisateur.",
  default: "Besoin d'aide ? Je suis là pour vous accompagner dans l'utilisation de FleetManager Pro !"
};

const QUICK_TIPS = [
  {
    title: "Astuce du jour",
    content: "Utilisez les filtres rapides pour trouver rapidement vos véhicules par statut ou type.",
    icon: <Lightbulb className="w-4 h-4" />
  },
  {
    title: "Le saviez-vous ?",
    content: "Vous pouvez exporter toutes vos données en Excel pour vos rapports personnalisés.",
    icon: <BookOpen className="w-4 h-4" />
  },
  {
    title: "Conseil pratique",
    content: "Programmez vos maintenances préventives pour éviter 80% des pannes imprévues.",
    icon: <Settings className="w-4 h-4" />
  }
];

interface MascotHelperProps {
  currentPage?: string;
}

export function MascotHelper({ currentPage = "default" }: MascotHelperProps) {
  const { shouldShowMascot, hideMascot, startOnboarding } = useOnboarding();
  const [showQuickHelp, setShowQuickHelp] = useState(false);
  const [currentTip, setCurrentTip] = useState(0);
  const [showMessageBubble, setShowMessageBubble] = useState(true);

  const bubbleStorageKey = `fleet-mascot-bubble-hidden:${currentPage}`;

  React.useEffect(() => {
    try {
      const isHidden = window.sessionStorage.getItem(bubbleStorageKey) === "1";
      setShowMessageBubble(!isHidden);
    } catch {
      setShowMessageBubble(true);
    }
  }, [bubbleStorageKey]);

  const getCurrentMessage = () => {
    return HELP_MESSAGES[currentPage as keyof typeof HELP_MESSAGES] || HELP_MESSAGES.default;
  };

  const handleMascotClick = () => {
    setShowQuickHelp(!showQuickHelp);
  };

  const handleNextTip = () => {
    setCurrentTip((prev) => (prev + 1) % QUICK_TIPS.length);
  };

  const handleRestartTour = () => {
    setShowQuickHelp(false);
    startOnboarding();
  };

  const handleCloseBubble = () => {
    setShowMessageBubble(false);
    try {
      window.sessionStorage.setItem(bubbleStorageKey, "1");
    } catch {
      // Ignore storage errors silently (private mode, quota, etc.)
    }
  };

  if (!shouldShowMascot) {
    return null;
  }

  return (
    <>
      {/* Main Mascot */}
      <FleetMascot
        message={getCurrentMessage()}
        isVisible={shouldShowMascot && !showQuickHelp}
        position="bottom-right"
        animation="bounce"
        showBubble={showMessageBubble}
        onCloseBubble={handleCloseBubble}
        onClick={handleMascotClick}
      />

      {/* Quick Help Panel */}
      <AnimatePresence>
        {showQuickHelp && (
          <motion.div
            className="fixed bottom-4 right-4 z-50"
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 20 }}
            transition={{ duration: 0.3 }}
          >
            <Card className="w-80 shadow-xl border-blue-200 dark:border-blue-800">
              <CardContent className="p-4">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-2">
                    <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center">
                      <HelpCircle className="w-4 h-4 text-white" />
                    </div>
                    <h3 className="font-medium text-sm">Assistant FleetBot</h3>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowQuickHelp(false)}
                    className="h-6 w-6 p-0"
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>

                {/* Current Tip */}
                <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border-l-3 border-blue-500">
                  <div className="flex items-start space-x-2">
                    <div className="text-blue-600 dark:text-blue-400 mt-0.5">
                      {QUICK_TIPS[currentTip].icon}
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium text-xs text-blue-900 dark:text-blue-100 mb-1">
                        {QUICK_TIPS[currentTip].title}
                      </h4>
                      <p className="text-xs text-blue-800 dark:text-blue-200">
                        {QUICK_TIPS[currentTip].content}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="space-y-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleNextTip}
                    className="w-full text-xs h-8"
                  >
                    <Lightbulb className="w-3 h-3 mr-2" />
                    Autre astuce
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRestartTour}
                    className="w-full text-xs h-8"
                  >
                    <BookOpen className="w-3 h-3 mr-2" />
                    Reprendre la visite
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={hideMascot}
                    className="w-full text-xs h-8 text-muted-foreground"
                  >
                    Masquer l'assistant
                  </Button>
                </div>

                {/* Tip Navigation */}
                <div className="flex justify-center mt-3 space-x-1">
                  {QUICK_TIPS.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => setCurrentTip(index)}
                      className={`w-2 h-2 rounded-full transition-colors ${
                        index === currentTip 
                          ? "bg-blue-500" 
                          : "bg-gray-300 dark:bg-gray-600"
                      }`}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// Hook pour afficher des messages contextuels
export function useMascotMessages() {
  const [message, setMessage] = useState<string>("");
  const [isVisible, setIsVisible] = useState(false);

  const showMessage = (text: string, duration = 5000) => {
    setMessage(text);
    setIsVisible(true);
    
    if (duration > 0) {
      setTimeout(() => {
        setIsVisible(false);
      }, duration);
    }
  };

  const hideMessage = () => {
    setIsVisible(false);
  };

  return {
    message,
    isVisible,
    showMessage,
    hideMessage
  };
}
