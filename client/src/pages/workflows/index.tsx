import React from 'react';
import { useLocation } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Truck, Wrench, Package, Fuel, FileText, AlertTriangle, Calendar, Settings } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { canManageFleetVehicles } from '@/lib/auth';

interface WorkflowCategory {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<any>;
  workflows: WorkflowItem[];
  color: string;
}

interface WorkflowItem {
  id: string;
  title: string;
  description: string;
  route: string;
  status: 'active' | 'coming_soon' | 'beta';
  estimatedTime: string;
}

export function WorkflowsIndex() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const canAddVehicle = canManageFleetVehicles(user);

  const workflowCategories: WorkflowCategory[] = [
    {
      id: 'vehicles',
      title: 'Gestion des Véhicules',
      description: 'Workflows pour l\'acquisition, maintenance et suivi des véhicules',
      icon: Truck,
      color: 'bg-blue-50 border-blue-200 text-blue-800',
      workflows: [
        {
          id: 'vehicle-acquisition',
          title: 'Acquisition de Véhicule',
          description: 'Processus complet d\'intégration d\'un nouveau véhicule dans la flotte',
          route: '/workflows/vehicle-acquisition',
          status: 'active',
          estimatedTime: '15-20 min'
        },
        {
          id: 'vehicle-handover',
          title: 'Mise en Service',
          description: 'Contrôle technique, vérification assurance et mise en circulation',
          route: '/workflows/vehicle-handover',
          status: 'coming_soon',
          estimatedTime: '30 min'
        },
        {
          id: 'vehicle-inspection',
          title: 'Contrôle Périodique',
          description: 'Vérification documents et renouvellement automatique',
          route: '/workflows/vehicle-inspection',
          status: 'coming_soon',
          estimatedTime: '10 min'
        }
      ]
    },
    {
      id: 'maintenance',
      title: 'Maintenance',
      description: 'Workflows de maintenance préventive et corrective',
      icon: Wrench,
      color: 'bg-green-50 border-green-200 text-green-800',
      workflows: [
        {
          id: 'preventive-maintenance',
          title: 'Maintenance Préventive',
          description: 'Planification automatique et suivi des interventions préventives',
          route: '/workflows/preventive-maintenance',
          status: 'coming_soon',
          estimatedTime: '10 min'
        },
        {
          id: 'corrective-maintenance',
          title: 'Maintenance Corrective',
          description: 'Processus de signalement et traitement des pannes',
          route: '/workflows/corrective-maintenance',
          status: 'coming_soon',
          estimatedTime: '5 min'
        },
        {
          id: 'emergency-maintenance',
          title: 'Maintenance d\'Urgence',
          description: 'Protocole d\'intervention rapide pour pannes critiques',
          route: '/workflows/emergency-maintenance',
          status: 'coming_soon',
          estimatedTime: '2 min'
        }
      ]
    },
    {
      id: 'inventory',
      title: 'Gestion des Stocks',
      description: 'Workflows pour pièces détachées et consommables',
      icon: Package,
      color: 'bg-purple-50 border-purple-200 text-purple-800',
      workflows: [
        {
          id: 'parts-replenishment',
          title: 'Réapprovisionnement',
          description: 'Déclenchement automatique des commandes de pièces',
          route: '/workflows/parts-replenishment',
          status: 'coming_soon',
          estimatedTime: '5 min'
        },
        {
          id: 'inventory-rotation',
          title: 'Rotation des Stocks',
          description: 'Optimisation des niveaux et liquidation obsolètes',
          route: '/workflows/inventory-rotation',
          status: 'coming_soon',
          estimatedTime: '15 min'
        }
      ]
    },
    {
      id: 'fuel',
      title: 'Gestion Carburant',
      description: 'Workflows d\'approvisionnement et suivi carburant',
      icon: Fuel,
      color: 'bg-orange-50 border-orange-200 text-orange-800',
      workflows: [
        {
          id: 'fuel-supply',
          title: 'Approvisionnement Carburant',
          description: 'Planification commandes et livraisons carburant',
          route: '/workflows/fuel-supply',
          status: 'coming_soon',
          estimatedTime: '10 min'
        },
        {
          id: 'fuel-monitoring',
          title: 'Surveillance Consommation',
          description: 'Analyse rendement et détection anomalies',
          route: '/workflows/fuel-monitoring',
          status: 'coming_soon',
          estimatedTime: '5 min'
        }
      ]
    },
    {
      id: 'work-orders',
      title: 'Ordres de Travail',
      description: 'Workflows de création et suivi des interventions',
      icon: FileText,
      color: 'bg-red-50 border-red-200 text-red-800',
      workflows: [
        {
          id: 'work-order-creation',
          title: 'Création d\'OT',
          description: 'Processus guidé de création d\'ordre de travail',
          route: '/workflows/work-order-creation',
          status: 'coming_soon',
          estimatedTime: '5 min'
        },
        {
          id: 'work-order-urgent',
          title: 'OT d\'Urgence',
          description: 'Mobilisation immédiate pour interventions critiques',
          route: '/workflows/work-order-urgent',
          status: 'coming_soon',
          estimatedTime: '2 min'
        }
      ]
    },
    {
      id: 'alerts',
      title: 'Alertes et Notifications',
      description: 'Workflows de gestion des alertes automatiques',
      icon: AlertTriangle,
      color: 'bg-yellow-50 border-yellow-200 text-yellow-800',
      workflows: [
        {
          id: 'preventive-alerts',
          title: 'Alertes Préventives',
          description: 'Configuration et suivi des alertes automatiques',
          route: '/workflows/preventive-alerts',
          status: 'coming_soon',
          estimatedTime: '10 min'
        },
        {
          id: 'escalation-workflow',
          title: 'Escalade d\'Alertes',
          description: 'Processus d\'escalade hiérarchique automatique',
          route: '/workflows/escalation-workflow',
          status: 'coming_soon',
          estimatedTime: '5 min'
        }
      ]
    }
  ];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-green-100 text-green-800 border-green-300">Disponible</Badge>;
      case 'beta':
        return <Badge className="bg-blue-100 text-blue-800 border-blue-300">Bêta</Badge>;
      case 'coming_soon':
        return <Badge variant="secondary">Bientôt disponible</Badge>;
      default:
        return null;
    }
  };

  const handleWorkflowClick = (workflow: WorkflowItem) => {
    if (workflow.status === 'active') {
      setLocation(workflow.route);
    }
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* En-tête */}
      <div className="text-center space-y-2 bg-green-50 border border-green-200 rounded-lg p-6">
        <h1 className="text-3xl font-bold text-green-800 flex items-center justify-center gap-2">
          <Settings className="h-8 w-8" />
          Workflows Automatisés
        </h1>
        <p className="text-green-700 text-lg">
          Processus guidés pour optimiser la gestion de votre flotte de transport
        </p>
      </div>

      {/* Statistiques rapides */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-blue-600">
              {workflowCategories.reduce((acc, cat) => acc + cat.workflows.length, 0)}
            </div>
            <div className="text-sm text-muted-foreground">Workflows Total</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-green-600">
              {workflowCategories.reduce((acc, cat) => acc + cat.workflows.filter(w => w.status === 'active').length, 0)}
            </div>
            <div className="text-sm text-muted-foreground">Disponibles</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-orange-600">
              {workflowCategories.reduce((acc, cat) => acc + cat.workflows.filter(w => w.status === 'beta').length, 0)}
            </div>
            <div className="text-sm text-muted-foreground">En test</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-gray-600">
              {workflowCategories.reduce((acc, cat) => acc + cat.workflows.filter(w => w.status === 'coming_soon').length, 0)}
            </div>
            <div className="text-sm text-muted-foreground">En développement</div>
          </CardContent>
        </Card>
      </div>

      {/* Catégories de workflows */}
      <div className="space-y-8">
        {workflowCategories.map((category) => {
          const workflows = category.workflows.filter(
            (workflow) => workflow.id !== "vehicle-acquisition" || canAddVehicle,
          );
          if (workflows.length === 0) {
            return null;
          }
          const Icon = category.icon;
          return (
            <div key={category.id} className="space-y-4">
              <div className={`${category.color} p-4 rounded-lg border`}>
                <div className="flex items-center gap-3">
                  <Icon className="h-6 w-6" />
                  <div>
                    <h2 className="text-xl font-semibold">{category.title}</h2>
                    <p className="text-sm opacity-80">{category.description}</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {workflows.map((workflow) => (
                  <Card 
                    key={workflow.id} 
                    className={`cursor-pointer transition-all hover:shadow-md ${
                      workflow.status === 'active' 
                        ? 'hover:border-primary' 
                        : 'opacity-75 cursor-not-allowed'
                    }`}
                    onClick={() => handleWorkflowClick(workflow)}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <CardTitle className="text-lg">{workflow.title}</CardTitle>
                        {getStatusBadge(workflow.status)}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        {workflow.description}
                      </p>
                      
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Durée: {workflow.estimatedTime}
                        </span>
                      </div>

                      {workflow.status === 'active' && (
                        <Button className="w-full" size="sm">
                          Démarrer le workflow
                        </Button>
                      )}
                      
                      {workflow.status === 'coming_soon' && (
                        <Button variant="outline" className="w-full" size="sm" disabled>
                          Bientôt disponible
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Pied de page informatif */}
      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="p-6 text-center">
          <h3 className="text-lg font-semibold text-blue-800 mb-2">
            Optimisation Continue
          </h3>
          <p className="text-blue-700 text-sm">
            Les workflows sont conçus pour réduire les tâches répétitives, assurer la conformité 
            et améliorer l'efficacité opérationnelle de votre flotte de transport.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}