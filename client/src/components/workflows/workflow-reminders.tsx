import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { useLocation } from 'wouter';
import { apiRequest } from '@/lib/queryClient';
import { userMessageOf } from '@/lib/api-error';
import { 
  Clock, 
  AlertTriangle, 
  PlayCircle, 
  XCircle, 
  Car, 
  Calendar,
  TrendingUp
} from 'lucide-react';

interface ActiveWorkflow {
  id: number;
  sessionId: string;
  currentStep: number;
  workflowData: any;
  vehicleInfo: {
    registrationNumber: string;
    brand: string;
    model: string;
    vin: string;
  };
  progress: number;
  timeInfo: {
    daysElapsed: number;
    isRecent: boolean;
    isStale: boolean;
    lastActivity: string;
  };
  createdAt: string;
  updatedAt: string;
}

interface WorkflowStats {
  total: number;
  inProgress: number;
  completed: number;
  abandoned: number;
  thisMonth: number;
}

export function WorkflowReminders({ compact = false }: { compact?: boolean }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Récupérer les workflows actifs
  const { data: activeWorkflows = [], isLoading } = useQuery<ActiveWorkflow[]>({
    queryKey: ['/api/workflows/active'],
    refetchInterval: 30000, // Refetch toutes les 30 secondes
  });

  // Récupérer les statistiques
  const { data: stats } = useQuery<WorkflowStats>({
    queryKey: ['/api/workflows/stats'],
  });

  // Mutation pour abandonner un workflow : l'id passe par les variables.
  const abandonMutation = useMutation({
    mutationFn: async ({ sessionId }: { sessionId: string }) => {
      const response = await apiRequest('PATCH', `/api/workflows/active/${encodeURIComponent(sessionId)}/abandon`);
      return response.json();
    },
    onSuccess: (_data, { sessionId }) => {
      // Couche 1 : retrait immediat du brouillon dans le cache local.
      queryClient.setQueryData<ActiveWorkflow[]>(['/api/workflows/active'], (prev) =>
        prev ? prev.filter((w) => w.sessionId !== sessionId) : prev,
      );
      // Couche 3 : liste, statistiques et reprise du brouillon abandonne.
      // Couche 2 : le brouillon est propre a son auteur, aucun autre profil
      // n'affiche cette liste, donc pas d'evenement WebSocket.
      queryClient.invalidateQueries({ queryKey: ['/api/workflows/active'] });
      queryClient.invalidateQueries({ queryKey: ['/api/workflows/stats'] });
      queryClient.invalidateQueries({ queryKey: [`/api/workflows/vehicle-acquisition/${sessionId}`] });
      toast({
        title: "Workflow abandonné",
        description: "Le workflow d'acquisition a été abandonné avec succès.",
      });
    },
    onError: (error) => {
      toast({
        title: "Erreur",
        description: userMessageOf(error, "Impossible d'abandonner le workflow."),
        variant: "destructive",
      });
    },
  });

  const handleContinueWorkflow = (sessionId: string) => {
    setLocation(`/workflows/vehicle-acquisition?resumeSession=${sessionId}`);
  };

  const handleAbandonWorkflow = (sessionId: string) => {
    abandonMutation.mutate({ sessionId });
  };

  const getStepName = (step: number): string => {
    const steps = [
      'Informations véhicule',
      'Validation VIN',
      'Documents',
      'Maintenance',
      'Activation'
    ];
    return steps[step - 1] || 'Étape inconnue';
  };

  const getPriorityBadge = (timeInfo: any) => {
    if (timeInfo.isStale) {
      return <Badge variant="destructive" className="text-xs">Urgent</Badge>;
    }
    if (timeInfo.daysElapsed > 3) {
      return <Badge variant="secondary" className="text-xs">Attention</Badge>;
    }
    if (timeInfo.isRecent) {
      return <Badge variant="default" className="text-xs">Récent</Badge>;
    }
    return null;
  };

  // ── Mode compact (bannière horizontale au-dessus du tableau) ──────────────
  if (compact) {
    if (isLoading) {
      return null;
    }

    if (activeWorkflows.length === 0) {
      return null;
    }

    return (
      <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 bg-orange-50 border border-orange-200 rounded-md">
        <div className="flex items-center gap-2 shrink-0">
          <AlertTriangle className="h-4 w-4 text-orange-600" />
          <span className="text-sm font-medium text-orange-800">Workflows en cours</span>
          <Badge variant="secondary" className="text-xs">{activeWorkflows.length}</Badge>
        </div>
        <div className="flex flex-wrap gap-2 flex-1">
          {activeWorkflows.map((workflow) => (
            <div
              key={workflow.sessionId}
              className="flex items-center gap-3 bg-white border border-orange-200 rounded-md px-3 py-1.5 text-sm"
            >
              <span className="font-medium text-gray-800">
                {workflow.vehicleInfo.brand} {workflow.vehicleInfo.model}
              </span>
              <span className="text-gray-500 text-xs">{workflow.vehicleInfo.registrationNumber}</span>
              <span className="text-xs text-gray-500">Étape {workflow.currentStep}/5</span>
              <Progress value={workflow.progress} className="h-1.5 w-16" />
              <span className="text-xs font-medium">{workflow.progress}%</span>
              {getPriorityBadge(workflow.timeInfo)}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleContinueWorkflow(workflow.sessionId)}
                className="h-6 px-2 text-xs text-orange-700 hover:bg-orange-100"
              >
                <PlayCircle className="h-3 w-3 mr-1" />
                Continuer
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleAbandonWorkflow(workflow.sessionId)}
                disabled={abandonMutation.isPending}
                className="h-6 px-2 text-xs text-red-700 hover:bg-red-50"
                aria-label={`Abandonner l'acquisition ${workflow.vehicleInfo.registrationNumber}`}
              >
                <XCircle className="h-3 w-3 mr-1" />
                Abandonner
              </Button>
            </div>
          ))}
        </div>
        {stats && (
          <span className="text-xs text-gray-500 shrink-0">{stats.completed} terminé{stats.completed > 1 ? 's' : ''}</span>
        )}
      </div>
    );
  }

  // ── Mode normal (sidebar verticale) ───────────────────────────────────────
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Workflows en cours
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="text-sm text-muted-foreground mt-2">Chargement...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (activeWorkflows.length === 0) {
    return (
      <Card className="bg-green-50 border-green-200">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2 text-green-800">
            <TrendingUp className="h-5 w-5" />
            Workflows d'acquisition
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4">
            <Car className="h-12 w-12 text-green-600 mx-auto mb-2" />
            <p className="text-green-700 font-medium">Aucun workflow en cours</p>
            <p className="text-sm text-green-600">Tous vos workflows d'acquisition sont terminés.</p>
            {stats && stats.thisMonth > 0 && (
              <p className="text-xs text-green-500 mt-2">
                {stats.thisMonth} acquisition{stats.thisMonth > 1 ? 's' : ''} ce mois
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-orange-50 border-orange-200">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2 text-orange-800">
          <AlertTriangle className="h-5 w-5" />
          Workflows d'acquisition en cours
          <Badge variant="secondary" className="ml-auto">
            {activeWorkflows.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {activeWorkflows.map((workflow) => (
          <div
            key={workflow.sessionId}
            className="bg-white border border-orange-200 rounded-lg p-4 space-y-3"
          >
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h4 className="font-medium text-gray-900">
                    {workflow.vehicleInfo.brand} {workflow.vehicleInfo.model}
                  </h4>
                  {getPriorityBadge(workflow.timeInfo)}
                </div>
                <p className="text-sm text-gray-600">
                  {workflow.vehicleInfo.registrationNumber}
                </p>
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {workflow.timeInfo.daysElapsed === 0
                      ? "Aujourd'hui"
                      : `Il y a ${workflow.timeInfo.daysElapsed} jour${workflow.timeInfo.daysElapsed > 1 ? 's' : ''}`
                    }
                  </span>
                  <span>Étape {workflow.currentStep}: {getStepName(workflow.currentStep)}</span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Progression</span>
                <span className="font-medium">{workflow.progress}%</span>
              </div>
              <Progress value={workflow.progress} className="h-2" />
            </div>

            <div className="flex items-center justify-between pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleAbandonWorkflow(workflow.sessionId)}
                disabled={abandonMutation.isPending}
                className="text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                <XCircle className="h-4 w-4 mr-1" />
                Abandonner
              </Button>

              <Button
                size="sm"
                onClick={() => handleContinueWorkflow(workflow.sessionId)}
                className="bg-orange-600 hover:bg-orange-700"
              >
                <PlayCircle className="h-4 w-4 mr-1" />
                Continuer
              </Button>
            </div>
          </div>
        ))}

        {stats && (
          <div className="border-t border-orange-200 pt-4 mt-4">
            <div className="grid grid-cols-2 gap-4 text-xs text-gray-600">
              <div>
                <span className="font-medium">{stats.completed}</span> terminé{stats.completed > 1 ? 's' : ''}
              </div>
              <div>
                <span className="font-medium">{stats.thisMonth}</span> ce mois
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}