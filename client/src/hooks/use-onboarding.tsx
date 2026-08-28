import React, { createContext, useContext, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface OnboardingData {
  id: number;
  userId: number;
  onboardingCompleted: boolean;
  completedAt: string | null;
  currentStep: number;
  stepsCompleted: string[];
  mascotHidden: boolean;
  createdAt: string;
  updatedAt: string;
}

interface OnboardingContextType {
  isOnboardingCompleted: boolean;
  isOnboardingActive: boolean;
  currentTour: string | null;
  onboardingData: OnboardingData | null;
  isLoading: boolean;
  startOnboarding: () => void;
  completeOnboarding: () => void;
  skipOnboarding: () => void;
  startTour: (tourId: string) => void;
  endTour: () => void;
  shouldShowMascot: boolean;
  showMascot: () => void;
  hideMascot: () => void;
  updateStep: (step: number, stepsCompleted: string[]) => void;
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined);

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [currentTour, setCurrentTour] = useState<string | null>(null);
  const [isOnboardingActive, setIsOnboardingActive] = useState<boolean>(false);
  const queryClient = useQueryClient();

  // Récupérer le statut d'onboarding depuis l'API
  const { data: onboardingData, isLoading } = useQuery<OnboardingData>({
    queryKey: ["/api/onboarding/status"],
    retry: false,
  });

  // Mutation pour mettre à jour l'étape
  const updateStepMutation = useMutation({
    mutationFn: (data: { currentStep: number; stepsCompleted: string[] }) =>
      apiRequest(`/api/onboarding/step`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/status"] });
    },
  });

  // Mutation pour compléter l'onboarding
  const completeOnboardingMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/api/onboarding/complete`, {
        method: "PATCH",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/status"] });
      setIsOnboardingActive(false);
      setCurrentTour(null);
    },
  });

  // Mutation pour masquer/afficher la mascotte
  const updateMascotMutation = useMutation({
    mutationFn: (mascotHidden: boolean) =>
      apiRequest(`/api/onboarding/mascot`, {
        method: "PATCH",
        body: JSON.stringify({ mascotHidden }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/status"] });
    },
  });

  // Vérifier si l'onboarding est déjà terminé
  useEffect(() => {
    if (onboardingData && !onboardingData.onboardingCompleted) {
      // Vérifier si l'onboarding n'a pas déjà été démarré dans cette session
      const sessionOnboardingStarted = sessionStorage.getItem("onboarding_started");
      if (!sessionOnboardingStarted) {
        setIsOnboardingActive(true);
        setCurrentTour("dashboard");
        sessionStorage.setItem("onboarding_started", "true");
      }
    }
  }, [onboardingData]);

  const startOnboarding = () => {
    setIsOnboardingActive(true);
    setCurrentTour("dashboard");
    sessionStorage.setItem("onboarding_started", "true");
  };

  const completeOnboarding = () => {
    completeOnboardingMutation.mutate();
    sessionStorage.removeItem("onboarding_started");
  };

  const skipOnboarding = () => {
    completeOnboardingMutation.mutate();
    sessionStorage.removeItem("onboarding_started");
  };

  const startTour = (tourId: string) => {
    setCurrentTour(tourId);
    setIsOnboardingActive(true);
  };

  const endTour = () => {
    setCurrentTour(null);
    setIsOnboardingActive(false);
  };

  const updateStep = (step: number, stepsCompleted: string[]) => {
    updateStepMutation.mutate({ currentStep: step, stepsCompleted });
  };

  const showMascot = () => {
    updateMascotMutation.mutate(false);
  };

  const hideMascot = () => {
    updateMascotMutation.mutate(true);
  };

  const value: OnboardingContextType = {
    isOnboardingCompleted: onboardingData?.onboardingCompleted || false,
    isOnboardingActive,
    currentTour,
    onboardingData: onboardingData ?? null,
    isLoading,
    startOnboarding,
    completeOnboarding,
    skipOnboarding,
    startTour,
    endTour,
    shouldShowMascot: !onboardingData?.mascotHidden,
    showMascot,
    hideMascot,
    updateStep,
  };

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (context === undefined) {
    throw new Error("useOnboarding must be used within an OnboardingProvider");
  }
  return context;
}
