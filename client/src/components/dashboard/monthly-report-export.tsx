import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, Download, Loader2 } from "lucide-react";

const MONTHS = [
  { value: 1,  label: 'Janvier' },
  { value: 2,  label: 'Février' },
  { value: 3,  label: 'Mars' },
  { value: 4,  label: 'Avril' },
  { value: 5,  label: 'Mai' },
  { value: 6,  label: 'Juin' },
  { value: 7,  label: 'Juillet' },
  { value: 8,  label: 'Août' },
  { value: 9,  label: 'Septembre' },
  { value: 10, label: 'Octobre' },
  { value: 11, label: 'Novembre' },
  { value: 12, label: 'Décembre' },
];

export function MonthlyReportExport() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentYear = now.getFullYear();
  const years = [currentYear - 1, currentYear, currentYear + 1];

  const handleExport = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/exports/monthly-report?year=${year}&month=${month}`,
        { credentials: 'include' }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Erreur ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rapport_mensuel_${String(month).padStart(2, '0')}_${year}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message ?? 'Erreur lors de l\'export');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4" />
          Export rapport mensuel
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Génère un fichier Excel avec les factures fournisseurs, factures clients et données carburant du mois sélectionné.
        </p>

        <div className="flex gap-2">
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {MONTHS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>

          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="w-24 h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}

        <Button
          onClick={handleExport}
          disabled={isLoading}
          className="w-full gap-2"
          size="sm"
        >
          {isLoading
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Génération...</>
            : <><Download className="h-3.5 w-3.5" /> Télécharger (.xlsx)</>}
        </Button>
      </CardContent>
    </Card>
  );
}
