import { CheckCircle2, FlaskConical, CalendarClock } from "lucide-react";
import { PageLayout } from "@/components/layout/page-layout";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFeatureFlags } from "@/hooks/use-feature";
import { DELIVERED_ITEMS, NEXT_LOTS, featuresByLevel } from "@/lib/scope-overview";

export default function ScopePage() {
  const flags = useFeatureFlags();
  const mustFeatures = featuresByLevel("must", flags);
  const trial = featuresByLevel("should", flags);

  return (
    <PageLayout>
      <PageHeader
        title="Périmètre et prochains lots"
        subtitle="Ce qui est livré, ce qui est en essai et ce qui vient ensuite."
      />
      <p className="mb-6 max-w-3xl text-sm text-muted-foreground">
        Cette recette porte sur le coeur du cahier des charges : parc et documents, atelier, magasin et pneus,
        achats, carburant, chauffeurs, comptes et droits. Ce qui n'est pas prêt n'est pas montré à moitié :
        cette page dit ce qui est livré, ce qui est en essai et ce qui vient ensuite.
      </p>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4 text-primary-text" aria-hidden="true" />
              Livré pour la recette du lundi 2 novembre
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-foreground">
              {mustFeatures.map((f) => (
                <li key={f.key}>
                  {f.label}
                  {f.enabled ? "" : " (momentanément coupé)"}
                </li>
              ))}
              {DELIVERED_ITEMS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FlaskConical className="h-4 w-4 text-primary-text" aria-hidden="true" />
              En essai
            </CardTitle>
            <p className="text-sm text-muted-foreground">Activés seulement s'ils sont validés à la répétition.</p>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 sm:grid-cols-2">
              {trial.map((f) => (
                <li key={f.key} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                  <span className="text-foreground">{f.label}</span>
                  <Badge variant={f.enabled ? "default" : "outline"}>{f.enabled ? "Activé" : "En essai"}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4 text-primary-text" aria-hidden="true" />
              Prochains lots
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Aucune date n'est promise ici : les dates cibles seront ajoutées après vos réponses.
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Sujet</th>
                  <th className="py-2 pr-4 font-medium">Pourquoi pas lundi</th>
                  <th className="py-2 font-medium">Ce dont nous avons besoin</th>
                </tr>
              </thead>
              <tbody>
                {NEXT_LOTS.map((lot) => (
                  <tr key={lot.subject} className="border-b align-top last:border-0">
                    <td className="py-2 pr-4 font-medium text-foreground">{lot.subject}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{lot.reason}</td>
                    <td className="py-2 text-muted-foreground">{lot.need}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}
