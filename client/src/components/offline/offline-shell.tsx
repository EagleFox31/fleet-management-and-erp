import type { ComponentType, ReactNode } from "react";
import { Redirect, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { isOfflineReadOnly, offlineHomePathFor } from "@/lib/offline-read-only";
import DriverDashboard from "@/pages/driver/dashboard";

/**
 * Accueil de chaque profil de lecture hors ligne. Le chemin est dans `OFFLINE_HOME_PATH_BY_PROFILE`
 * (`lib/offline-read-only.ts`) ; ici, le composant qui s'y affiche. Une seule table, pas de test de rôle.
 */
const OFFLINE_HOME_BY_PROFILE: Readonly<Record<string, ComponentType>> = {
  driver: DriverDashboard,
};

/**
 * Shell restreint de la consultation seule : tant que `/api/auth/me` n'a pas répondu mais que la lecture hors
 * ligne est ouverte (`offlineGrant`, `user` nul), seul l'accueil du profil est monté ; toute autre adresse y
 * redirige. La garde lit le profil de lecture du marqueur, jamais un rôle. Sinon, les routes de l'application.
 */
export function OfflineShellGate({ children }: { children: ReactNode }) {
  const { user, offlineGrant } = useAuth();
  const [location] = useLocation();
  if (!offlineGrant || !isOfflineReadOnly({ user, offlineGrant })) return <>{children}</>;

  const home = offlineHomePathFor(offlineGrant.profile);
  const Home = OFFLINE_HOME_BY_PROFILE[offlineGrant.profile];
  if (home === null || !Home) return null;
  if (location !== home) return <Redirect to={home} replace />;
  return <Home />;
}
