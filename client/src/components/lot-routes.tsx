import { Route } from "wouter";
import AppLayout from "@/components/layout/app-layout";
import { FeatureGate } from "@/components/feature-gate";
import { LOT_SCREENS, type LotScreen } from "@/config/lot-screens";
import { LOT_SCREEN_COMPONENTS } from "@/config/lot-screen-components";
import ScreenPlaceholder from "@/pages/lot/screen-placeholder";
import { useAuth } from "@/hooks/useAuth";
import { useEffect, type ReactNode } from "react";
import { useLocation } from "wouter";
import NotFound from "@/pages/not-found";

function ScreenBody({ screen, params }: { screen: LotScreen; params: Record<string, string | undefined> }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) setLocation("/login");
  }, [isLoading, isAuthenticated, setLocation]);

  if ((isLoading && !user) || !isAuthenticated || !user) return null;
  if (screen.roles !== "authenticated" && !screen.roles.includes(user.role as never)) return <NotFound />;

  const Component = LOT_SCREEN_COMPONENTS[screen.id];
  const body: ReactNode = Component ? <Component screen={screen} params={params} /> : <ScreenPlaceholder screen={screen} />;
  return screen.feature ? <FeatureGate feature={screen.feature}>{body}</FeatureGate> : <>{body}</>;
}

/** Routes des écrans du lot, générées depuis `config/lot-screens.ts`. À poser avant les routes à `:id`. */
export function renderLotRoutes() {
  return LOT_SCREENS.map((screen) => (
    <Route key={screen.id} path={screen.path}>
      {(params) => {
        const content = <ScreenBody screen={screen} params={params as Record<string, string | undefined>} />;
        return screen.standalone ? content : <AppLayout>{content}</AppLayout>;
      }}
    </Route>
  ));
}
