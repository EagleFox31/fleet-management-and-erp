import { Route } from "wouter";
import AppLayout from "@/components/layout/app-layout";
import { FeatureGate } from "@/components/feature-gate";
import { LOT_SCREENS, type LotScreen } from "@/config/lot-screens";
import { LOT_SCREEN_COMPONENTS } from "@/config/lot-screen-components";
import { CDC_SCREENS } from "@/config/cdc-screens";
import { CDC_SCREEN_COMPONENTS } from "@/config/cdc-screen-components";
import ScreenPlaceholder from "@/pages/lot/screen-placeholder";
import { useAuth } from "@/hooks/useAuth";
import { Suspense, useEffect, type ReactNode } from "react";
import { useLocation } from "wouter";
import NotFound from "@/pages/not-found";

function ScreenLoading() {
  return (
    <div role="status" className="p-6 text-sm text-muted-foreground">
      Chargement en cours...
    </div>
  );
}

/** Écrans du lot recette, puis ceux du chantier CDC. Les ids sont uniques (cdc-screens.test.ts). */
const ALL_SCREENS: readonly LotScreen[] = [...LOT_SCREENS, ...CDC_SCREENS];

function ScreenBody({ screen, params }: { screen: LotScreen; params: Record<string, string | undefined> }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) setLocation("/login");
  }, [isLoading, isAuthenticated, setLocation]);

  if ((isLoading && !user) || !isAuthenticated || !user) return null;
  if (screen.roles !== "authenticated" && !screen.roles.includes(user.role as never)) return <NotFound />;

  const Component = LOT_SCREEN_COMPONENTS[screen.id] ?? CDC_SCREEN_COMPONENTS[screen.id];
  const body: ReactNode = Component ? (
    // Les pages sont chargées à la demande : sans frontière, un composant `lazy` fait tomber l'arbre.
    <Suspense fallback={<ScreenLoading />}>
      <Component screen={screen} params={params} />
    </Suspense>
  ) : (
    <ScreenPlaceholder screen={screen} />
  );
  return screen.feature ? <FeatureGate feature={screen.feature}>{body}</FeatureGate> : <>{body}</>;
}

/** Routes des écrans du lot et du chantier CDC (`config/lot-screens.ts`, `config/cdc-screens.ts`). À poser avant les routes à `:id`. */
export function renderLotRoutes() {
  return ALL_SCREENS.map((screen) => (
    <Route key={screen.id} path={screen.path}>
      {(params) => {
        const content = <ScreenBody screen={screen} params={params as Record<string, string | undefined>} />;
        return screen.standalone ? content : <AppLayout>{content}</AppLayout>;
      }}
    </Route>
  ));
}
