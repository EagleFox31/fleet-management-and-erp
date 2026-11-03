import { Hourglass } from "lucide-react";
import { PageLayout } from "@/components/layout/page-layout";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { CDC_SCREENS } from "@/config/cdc-screens";

/**
 * Page vide d'un écran du chantier CDC (lot CDC-0b). Le lot fonctionnel remplace le contenu de
 * `pages/cdc/<id>.tsx` et n'a plus besoin de ce composant.
 */
export function CdcComingSoon({ screenId }: { screenId: string }) {
  const screen = CDC_SCREENS.find((entry) => entry.id === screenId);
  return (
    <PageLayout>
      <PageHeader title={screen?.title ?? "Écran"} subtitle={screen?.description} />
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <Hourglass className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">Bientôt disponible</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Cet écran est en cours de construction et s'ouvrira avec la prochaine livraison.
          </p>
        </CardContent>
      </Card>
    </PageLayout>
  );
}
