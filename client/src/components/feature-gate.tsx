import type { ReactNode } from "react";
import type { FeatureKey } from "@shared/feature-flags";
import { useFeature } from "@/hooks/use-feature";
import NotFound from "@/pages/not-found";

interface FeatureGateProps {
  feature: FeatureKey;
  children: ReactNode;
  /** Rendu quand le drapeau est coupé. Par défaut : page introuvable (pas d'écran blanc). */
  fallback?: ReactNode;
}

export function FeatureGate({ feature, children, fallback }: FeatureGateProps) {
  const enabled = useFeature(feature);
  if (enabled) return <>{children}</>;
  return <>{fallback === undefined ? <NotFound /> : fallback}</>;
}
