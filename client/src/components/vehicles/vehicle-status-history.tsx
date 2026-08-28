import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { formatDistance, format } from "date-fns";
import { fr } from "date-fns/locale";
import { Activity, FileText, CheckCircle2, Clock, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface VehicleStatusHistoryProps {
  vehicleId: number;
  className?: string;
}

// ── Helpers statuts véhicule ──────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  operational: "bg-green-100 text-green-800",
  maintenance: "bg-yellow-100 text-yellow-800",
  out_of_service: "bg-red-100 text-red-800",
};

const STATUS_LABEL: Record<string, string> = {
  operational: "Opérationnel",
  maintenance: "En maintenance",
  out_of_service: "Hors service",
};

// ── Helpers demandes de renouvellement ───────────────────────────────────────

const DOC_TYPE_LABELS: Record<string, string> = {
  carte_grise: "Carte grise",
  assurance: "Assurance",
  visite_technique: "Visite technique",
  taxe: "Taxe",
  autre: "Document",
};

const RENEWAL_STATUS_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending:     { label: "En attente",  color: "bg-amber-100 text-amber-800",  icon: <Clock className="h-3.5 w-3.5" /> },
  in_progress: { label: "En cours",   color: "bg-blue-100 text-blue-800",    icon: <Activity className="h-3.5 w-3.5" /> },
  completed:   { label: "Traité",     color: "bg-green-100 text-green-800",  icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  rejected:    { label: "Rejeté",     color: "bg-red-100 text-red-800",      icon: <XCircle className="h-3.5 w-3.5" /> },
};

// ── Composant ─────────────────────────────────────────────────────────────────

export function VehicleStatusHistory({ vehicleId, className }: VehicleStatusHistoryProps) {
  const { data: statusHistory = [], isLoading: historyLoading } = useQuery<any[]>({
    queryKey: ["/api/vehicles", vehicleId, "status-history"],
    queryFn: () => fetch(`/api/vehicles/${vehicleId}/status-history`).then((r) => r.json()),
    staleTime: 0,
    refetchOnMount: "always",
  });

  const { data: renewalRequests = [], isLoading: renewalLoading } = useQuery<any[]>({
    queryKey: ["/api/document-renewals/requests", vehicleId],
    queryFn: () => fetch(`/api/document-renewals/requests?vehicleId=${vehicleId}`).then((r) => r.json()),
    staleTime: 0,
    refetchOnMount: "always",
  });

  const isLoading = historyLoading || renewalLoading;

  // Fusionner les deux sources en timeline unifiée triée par date desc
  const timeline = useMemo(() => {
    const statusEntries = (statusHistory as any[]).map((e) => ({
      kind: "status" as const,
      date: new Date(e.createdAt || e.date),
      data: e,
    }));

    const renewalEntries = (renewalRequests as any[]).map((r) => ({
      kind: "renewal" as const,
      date: new Date(r.createdAt),
      data: r,
    }));

    return [...statusEntries, ...renewalEntries].sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [statusHistory, renewalRequests]);

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <div className="w-7 h-7 rounded-lg bg-purple-50 flex items-center justify-center">
              <Activity className="h-3.5 w-3.5 text-purple-600" />
            </div>
            Historique santé du véhicule
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("rounded-2xl border border-gray-100 shadow-sm", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <div className="w-7 h-7 rounded-lg bg-purple-50 flex items-center justify-center">
            <Activity className="h-3.5 w-3.5 text-purple-600" />
          </div>
          Historique santé du véhicule
          {timeline.length > 0 && (
            <span className="ml-1 text-[10px] font-semibold bg-gray-100 text-gray-500 rounded-full px-1.5 py-0.5">{timeline.length}</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {timeline.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">
            Aucun historique disponible
          </div>
        ) : (
          <div className="relative">
            {/* Ligne verticale de timeline */}
            <div className="absolute left-[18px] top-2 bottom-2 w-px bg-gray-100" />

            <div className="space-y-0">
              {timeline.map((entry, index) => {
                if (entry.kind === "status") {
                  const e = entry.data;
                  return (
                    <div key={`s-${e.id}`} className="flex items-start gap-4 pb-5 relative">
                      {/* Dot */}
                      <div className={cn(
                        "shrink-0 w-9 h-9 rounded-full flex items-center justify-center border-2 border-white shadow-sm z-10",
                        e.status === "operational" ? "bg-green-100" :
                        e.status === "maintenance" ? "bg-yellow-100" : "bg-red-100"
                      )}>
                        <Activity className={cn("h-3.5 w-3.5",
                          e.status === "operational" ? "text-green-600" :
                          e.status === "maintenance" ? "text-yellow-600" : "text-red-600"
                        )} />
                      </div>
                      {/* Contenu */}
                      <div className="flex-1 min-w-0 pt-1">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <Badge className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", STATUS_COLOR[e.status] ?? "bg-gray-100 text-gray-700")}>
                              {STATUS_LABEL[e.status] ?? e.status}
                            </Badge>
                            <p className="text-[13px] text-gray-700 mt-1 leading-snug">
                              {e.notes || `Statut changé vers ${STATUS_LABEL[e.status] ?? e.status}`}
                            </p>
                            {e.updatedBy && (
                              <p className="text-[11px] text-gray-400 mt-0.5">Modifié par {e.updatedBy}</p>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-[11px] text-gray-400">
                              {formatDistance(entry.date, new Date(), { addSuffix: true, locale: fr })}
                            </p>
                            <p className="text-[10px] text-gray-300 mt-0.5">
                              {format(entry.date, "dd MMM yyyy", { locale: fr })}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }

                // Entrée demande de renouvellement
                const r = entry.data;
                const meta = RENEWAL_STATUS_META[r.status] ?? RENEWAL_STATUS_META.pending;
                return (
                  <div key={`r-${r.id}`} className="flex items-start gap-4 pb-5 relative">
                    {/* Dot */}
                    <div className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center border-2 border-white shadow-sm z-10 bg-amber-50">
                      <FileText className="h-3.5 w-3.5 text-amber-500" />
                    </div>
                    {/* Contenu */}
                    <div className="flex-1 min-w-0 pt-1">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <Badge className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1", meta.color)}>
                            {meta.icon}
                            Renouvellement {meta.label.toLowerCase()}
                          </Badge>
                          <p className="text-[13px] text-gray-700 mt-1 leading-snug">
                            Demande de renouvellement — <span className="font-medium">{DOC_TYPE_LABELS[r.documentType] ?? r.documentType}</span>
                          </p>
                          {r.requestedByName && (
                            <p className="text-[11px] text-gray-400 mt-0.5">Demandé par {r.requestedByName}</p>
                          )}
                          {r.comment && (
                            <p className="text-[11px] text-gray-400 mt-0.5 italic">"{r.comment}"</p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-[11px] text-gray-400">
                            {formatDistance(entry.date, new Date(), { addSuffix: true, locale: fr })}
                          </p>
                          <p className="text-[10px] text-gray-300 mt-0.5">
                            {format(entry.date, "dd MMM yyyy", { locale: fr })}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
