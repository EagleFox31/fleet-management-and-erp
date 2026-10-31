import { Construction } from "lucide-react";
import { PageLayout } from "@/components/layout/page-layout";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import type { LotScreen } from "@/config/lot-screens";

/**
 * Page vide d'un écran du lot (T-09). Remplacée, écran par écran, en déclarant
 * le vrai composant dans `config/lot-screen-components.ts`.
 */
export default function ScreenPlaceholder({ screen }: { screen: LotScreen }) {
  return (
    <PageLayout>
      <PageHeader title={screen.title} subtitle={screen.description} />
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <Construction className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">Cet écran n'est pas encore disponible.</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Il est prévu dans cette livraison ; son contenu arrive avec la tâche {screen.task}.
          </p>
        </CardContent>
      </Card>
    </PageLayout>
  );
}
