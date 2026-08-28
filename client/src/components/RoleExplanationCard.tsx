import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { 
  Lightbulb, 
  Wrench, 
  ClipboardList, 
  Calendar, 
  Package, 
  Truck, 
  User,
  ShieldCheck
} from "lucide-react";

type PageType = 
  | "work-orders" 
  | "preventive" 
  | "vehicles" 
  | "parts" 
  | "part-requirements"
  | "fuel" 
  | "suppliers"
  | "missions"
  | "invoices";

interface RoleMessage {
  icon: typeof Lightbulb;
  title: string;
  description: string;
  actions: string[];
}

const roleMessages: Record<string, Record<PageType, RoleMessage>> = {
  admin: {
    "work-orders": {
      icon: ShieldCheck,
      title: "Gestion complète des travaux",
      description: "Vous avez accès à toutes les fonctionnalités. Supervisez l'activité de l'atelier et prenez des décisions stratégiques.",
      actions: [
        "Créer et assigner des ordres de travail aux techniciens",
        "Suivre l'avancement de tous les travaux",
        "Exporter les rapports pour analyse",
        "Valider les travaux terminés"
      ]
    },
    "preventive": {
      icon: Calendar,
      title: "Planification stratégique",
      description: "Définissez les règles de maintenance pour prolonger la durée de vie de votre flotte.",
      actions: [
        "Créer des plannings de maintenance (vidanges, révisions...)",
        "Définir les seuils kilométriques ou temporels",
        "Activer/désactiver les planifications",
        "Voir les prochaines échéances"
      ]
    },
    "vehicles": {
      icon: Truck,
      title: "Gestion de la flotte",
      description: "Vue d'ensemble de tous les véhicules avec leur état et historique.",
      actions: [
        "Ajouter de nouveaux véhicules",
        "Mettre à jour les informations",
        "Consulter l'historique de maintenance",
        "Gérer les documents (assurance, contrôle technique...)"
      ]
    },
    "parts": {
      icon: Package,
      title: "Gestion du stock",
      description: "Contrôlez le stock de pièces et anticipez les besoins.",
      actions: [
        "Consulter les niveaux de stock",
        "Créer des commandes de réapprovisionnement",
        "Gérer les catégories de pièces",
        "Voir l'historique des mouvements"
      ]
    },
    "part-requirements": {
      icon: ClipboardList,
      title: "Supervision des demandes",
      description: "Vous supervisez tout le processus de réapprovisionnement avec contrôle total.",
      actions: [
        "Approuver ou rejeter les demandes",
        "Voir toutes les demandes et leur statut",
        "Décider des annulations après commande",
        "Superviser les réceptions et sorties de stock"
      ]
    },
    "fuel": {
      icon: Truck,
      title: "Suivi carburant",
      description: "Analysez la consommation et détectez les anomalies.",
      actions: [
        "Consulter les consommations par véhicule",
        "Détecter les surconsommations anormales",
        "Gérer les cartes carburant",
        "Exporter les rapports"
      ]
    },
    "suppliers": {
      icon: ClipboardList,
      title: "Gestion des fournisseurs",
      description: "Gérez vos partenaires et suivez les commandes.",
      actions: [
        "Ajouter et modifier les fournisseurs",
        "Suivre les commandes en cours",
        "Évaluer la performance des fournisseurs",
        "Gérer les factures"
      ]
    },
    "missions": {
      icon: Truck,
      title: "Suivi des missions",
      description: "Gérez les missions clients et la facturation.",
      actions: [
        "Créer de nouvelles missions",
        "Assigner des véhicules",
        "Suivre l'avancement",
        "Générer les factures"
      ]
    },
    "invoices": {
      icon: ClipboardList,
      title: "Facturation",
      description: "Gérez la facturation clients.",
      actions: [
        "Créer des factures",
        "Suivre les paiements",
        "Exporter en PDF",
        "Voir l'historique"
      ]
    }
  },
  
  workshop_manager: {
    "work-orders": {
      icon: Wrench,
      title: "Pilotez votre atelier",
      description: "Organisez le travail de vos techniciens et assurez le bon déroulement des interventions.",
      actions: [
        "Créer des ordres de travail pour les pannes signalées",
        "Assigner les travaux aux techniciens disponibles",
        "Suivre l'avancement en temps réel",
        "Valider les travaux terminés"
      ]
    },
    "preventive": {
      icon: Calendar,
      title: "Anticipez les pannes",
      description: "Planifiez les entretiens réguliers pour éviter les pannes coûteuses.",
      actions: [
        "Créer des plannings de maintenance préventive",
        "Définir les intervalles (km ou temps)",
        "Voir les prochaines échéances",
        "Générer automatiquement les ordres de travail"
      ]
    },
    "vehicles": {
      icon: Truck,
      title: "État de la flotte",
      description: "Consultez l'état technique de chaque véhicule.",
      actions: [
        "Voir l'historique de maintenance",
        "Identifier les véhicules problématiques",
        "Consulter les documents",
        "Signaler les problèmes"
      ]
    },
    "parts": {
      icon: Package,
      title: "Besoins en pièces",
      description: "Vérifiez la disponibilité des pièces avant d'assigner un travail.",
      actions: [
        "Consulter le stock disponible",
        "Réserver des pièces pour un OT",
        "Signaler les ruptures de stock",
        "Demander des commandes"
      ]
    },
    "part-requirements": {
      icon: ClipboardList,
      title: "Validation des demandes",
      description: "Vous validez les demandes et supervisez le processus de réapprovisionnement.",
      actions: [
        "Approuver ou rejeter les demandes des techniciens",
        "Vérifier la pertinence des pièces demandées",
        "Prioriser les demandes urgentes",
        "Demander l'annulation après commande si nécessaire"
      ]
    },
    "fuel": {
      icon: Truck,
      title: "Consommation",
      description: "Surveillez la consommation pour détecter les problèmes mécaniques.",
      actions: [
        "Consulter les consommations",
        "Identifier les surconsommations",
        "Signaler les anomalies"
      ]
    },
    "suppliers": {
      icon: ClipboardList,
      title: "Fournisseurs",
      description: "Consultez les informations des fournisseurs de pièces.",
      actions: [
        "Voir les contacts fournisseurs",
        "Consulter les délais de livraison",
        "Voir l'historique des commandes"
      ]
    },
    "missions": {
      icon: Truck,
      title: "Missions",
      description: "Consultez les missions pour planifier la disponibilité des véhicules.",
      actions: [
        "Voir les missions en cours",
        "Anticiper les retours véhicules",
        "Planifier les maintenances"
      ]
    },
    "invoices": {
      icon: ClipboardList,
      title: "Factures",
      description: "Consultez les factures liées aux interventions.",
      actions: [
        "Voir les factures",
        "Consulter les détails"
      ]
    }
  },
  
  technician: {
    "work-orders": {
      icon: Wrench,
      title: "Vos travaux du jour",
      description: "Voici les interventions qui vous sont assignées. Mettez à jour l'avancement au fur et à mesure.",
      actions: [
        "Voir les travaux qui vous sont assignés",
        "Marquer un travail comme \"En cours\"",
        "Ajouter les pièces utilisées",
        "Marquer un travail comme \"Terminé\""
      ]
    },
    "preventive": {
      icon: Calendar,
      title: "Maintenances planifiées",
      description: "Consultez les maintenances préventives à venir pour vous organiser.",
      actions: [
        "Voir les prochaines maintenances prévues",
        "Consulter les procédures à suivre"
      ]
    },
    "vehicles": {
      icon: Truck,
      title: "Informations véhicules",
      description: "Consultez les caractéristiques des véhicules sur lesquels vous travaillez.",
      actions: [
        "Voir les spécifications techniques",
        "Consulter l'historique des réparations",
        "Trouver les pièces compatibles"
      ]
    },
    "parts": {
      icon: Package,
      title: "Pièces disponibles",
      description: "Vérifiez si les pièces dont vous avez besoin sont en stock.",
      actions: [
        "Rechercher une pièce",
        "Vérifier la disponibilité",
        "Voir l'emplacement en stock"
      ]
    },
    "part-requirements": {
      icon: ClipboardList,
      title: "Demandes de pièces",
      description: "Créez des demandes de pièces pour vos interventions. Le chef d'atelier les validera.",
      actions: [
        "Créer une demande de pièce pour un OT",
        "Suivre l'état de vos demandes",
        "Sortir les pièces reçues du stock",
        "Confirmer l'utilisation des pièces"
      ]
    },
    "fuel": {
      icon: Truck,
      title: "Carburant",
      description: "Consultez les informations carburant si nécessaire.",
      actions: [
        "Voir les niveaux"
      ]
    },
    "suppliers": {
      icon: ClipboardList,
      title: "Fournisseurs",
      description: "Vous n'avez pas accès à cette section.",
      actions: []
    },
    "missions": {
      icon: Truck,
      title: "Missions",
      description: "Vous n'avez pas accès à cette section.",
      actions: []
    },
    "invoices": {
      icon: ClipboardList,
      title: "Factures",
      description: "Vous n'avez pas accès à cette section.",
      actions: []
    }
  },
  
  secretary: {
    "work-orders": {
      icon: ClipboardList,
      title: "Suivi administratif",
      description: "Suivez l'état des travaux pour la facturation et les rapports.",
      actions: [
        "Consulter tous les ordres de travail",
        "Exporter les rapports",
        "Préparer les éléments pour facturation",
        "Imprimer les bons de travail"
      ]
    },
    "preventive": {
      icon: Calendar,
      title: "Planning de maintenance",
      description: "Consultez le planning pour anticiper les besoins.",
      actions: [
        "Voir les maintenances planifiées",
        "Préparer les convocations véhicules"
      ]
    },
    "vehicles": {
      icon: Truck,
      title: "Documents véhicules",
      description: "Gérez les documents administratifs des véhicules.",
      actions: [
        "Mettre à jour les documents",
        "Suivre les échéances (assurance, CT...)",
        "Archiver les documents"
      ]
    },
    "parts": {
      icon: Package,
      title: "Inventaire",
      description: "Consultez l'état du stock pour les commandes.",
      actions: [
        "Consulter les niveaux de stock",
        "Voir les besoins de réapprovisionnement"
      ]
    },
    "part-requirements": {
      icon: ClipboardList,
      title: "Suivi des demandes",
      description: "Suivez les demandes de pièces pour la traçabilité et les rapports.",
      actions: [
        "Consulter toutes les demandes",
        "Exporter les rapports de demandes",
        "Suivre les coûts estimés"
      ]
    },
    "fuel": {
      icon: Truck,
      title: "Rapports carburant",
      description: "Générez les rapports de consommation.",
      actions: [
        "Exporter les données carburant",
        "Préparer les rapports mensuels"
      ]
    },
    "suppliers": {
      icon: ClipboardList,
      title: "Gestion fournisseurs",
      description: "Gérez les contacts et documents fournisseurs.",
      actions: [
        "Mettre à jour les coordonnées",
        "Archiver les factures",
        "Suivre les paiements"
      ]
    },
    "missions": {
      icon: Truck,
      title: "Missions clients",
      description: "Suivez les missions pour la facturation.",
      actions: [
        "Consulter les missions",
        "Préparer les factures"
      ]
    },
    "invoices": {
      icon: ClipboardList,
      title: "Facturation",
      description: "Gérez la facturation clients.",
      actions: [
        "Créer des factures",
        "Suivre les paiements",
        "Exporter en PDF",
        "Envoyer les relances"
      ]
    }
  },
  
  warehouse: {
    "work-orders": {
      icon: Package,
      title: "Besoins en pièces",
      description: "Voyez les pièces nécessaires pour les travaux en cours.",
      actions: [
        "Voir les pièces demandées par les techniciens",
        "Préparer les kits de pièces",
        "Signaler les indisponibilités"
      ]
    },
    "preventive": {
      icon: Calendar,
      title: "Anticipation stock",
      description: "Anticipez les besoins pour les maintenances planifiées.",
      actions: [
        "Voir les maintenances à venir",
        "Préparer les pièces nécessaires"
      ]
    },
    "vehicles": {
      icon: Truck,
      title: "Véhicules",
      description: "Consultez les véhicules pour identifier les pièces compatibles.",
      actions: [
        "Voir les caractéristiques",
        "Identifier les pièces compatibles"
      ]
    },
    "parts": {
      icon: Package,
      title: "Gestion du stock",
      description: "Gérez les entrées, sorties et inventaire des pièces.",
      actions: [
        "Enregistrer les réceptions",
        "Effectuer les sorties de stock",
        "Faire l'inventaire",
        "Signaler les seuils bas"
      ]
    },
    "part-requirements": {
      icon: ClipboardList,
      title: "Traitement des demandes",
      description: "Vous êtes responsable des commandes et réceptions de pièces.",
      actions: [
        "Passer les commandes aux fournisseurs",
        "Réceptionner les livraisons (partielles ou complètes)",
        "Sortir les pièces du stock pour les techniciens",
        "Suivre les commandes en cours"
      ]
    },
    "fuel": {
      icon: Truck,
      title: "Carburant",
      description: "Vous n'avez pas accès à cette section.",
      actions: []
    },
    "suppliers": {
      icon: ClipboardList,
      title: "Réceptions fournisseurs",
      description: "Réceptionnez les livraisons et vérifiez les commandes.",
      actions: [
        "Réceptionner les commandes",
        "Vérifier la conformité",
        "Signaler les écarts"
      ]
    },
    "missions": {
      icon: Truck,
      title: "Missions",
      description: "Vous n'avez pas accès à cette section.",
      actions: []
    },
    "invoices": {
      icon: ClipboardList,
      title: "Factures",
      description: "Vous n'avez pas accès à cette section.",
      actions: []
    }
  },
  
  logistics: {
    "work-orders": {
      icon: Truck,
      title: "État des véhicules",
      description: "Vérifiez quels véhicules sont disponibles ou en réparation.",
      actions: [
        "Voir les véhicules en maintenance",
        "Estimer les délais de réparation",
        "Planifier les rotations"
      ]
    },
    "preventive": {
      icon: Calendar,
      title: "Planning maintenance",
      description: "Anticipez les indisponibilités pour vos plannings.",
      actions: [
        "Voir les maintenances prévues",
        "Planifier autour des indisponibilités"
      ]
    },
    "vehicles": {
      icon: Truck,
      title: "Disponibilité flotte",
      description: "Gérez la disponibilité des véhicules pour les missions.",
      actions: [
        "Voir l'état de chaque véhicule",
        "Planifier les affectations",
        "Signaler les besoins de maintenance"
      ]
    },
    "parts": {
      icon: Package,
      title: "Stock",
      description: "Consultez le stock si besoin.",
      actions: [
        "Voir les disponibilités"
      ]
    },
    "part-requirements": {
      icon: ClipboardList,
      title: "Demandes de pièces",
      description: "Consultez l'état des demandes de pièces.",
      actions: [
        "Voir les demandes en cours",
        "Suivre les livraisons attendues"
      ]
    },
    "fuel": {
      icon: Truck,
      title: "Carburant",
      description: "Gérez le carburant et les cartes.",
      actions: [
        "Suivre les consommations",
        "Gérer les cartes carburant",
        "Analyser les coûts"
      ]
    },
    "suppliers": {
      icon: ClipboardList,
      title: "Fournisseurs",
      description: "Consultez les fournisseurs de transport.",
      actions: [
        "Voir les contacts"
      ]
    },
    "missions": {
      icon: Truck,
      title: "Gestion des missions",
      description: "Planifiez et suivez les missions de transport.",
      actions: [
        "Créer des missions",
        "Assigner les véhicules et chauffeurs",
        "Suivre en temps réel",
        "Clôturer les missions"
      ]
    },
    "invoices": {
      icon: ClipboardList,
      title: "Facturation",
      description: "Suivez la facturation des missions.",
      actions: [
        "Voir les factures",
        "Suivre les paiements"
      ]
    }
  },
  
  client: {
    "work-orders": {
      icon: User,
      title: "Suivi de vos véhicules",
      description: "Consultez l'état des interventions sur vos véhicules.",
      actions: [
        "Voir les travaux en cours sur vos véhicules",
        "Consulter l'historique des réparations",
        "Télécharger les rapports"
      ]
    },
    "preventive": {
      icon: Calendar,
      title: "Maintenances prévues",
      description: "Consultez les maintenances planifiées pour vos véhicules.",
      actions: [
        "Voir les prochaines échéances"
      ]
    },
    "vehicles": {
      icon: Truck,
      title: "Vos véhicules",
      description: "Consultez les informations de vos véhicules.",
      actions: [
        "Voir l'état de vos véhicules",
        "Consulter l'historique",
        "Télécharger les documents"
      ]
    },
    "parts": {
      icon: Package,
      title: "Pièces",
      description: "Vous n'avez pas accès à cette section.",
      actions: []
    },
    "part-requirements": {
      icon: ClipboardList,
      title: "Demandes de pièces",
      description: "Vous n'avez pas accès à cette section.",
      actions: []
    },
    "fuel": {
      icon: Truck,
      title: "Consommation",
      description: "Consultez la consommation de vos véhicules.",
      actions: [
        "Voir les rapports de consommation"
      ]
    },
    "suppliers": {
      icon: ClipboardList,
      title: "Fournisseurs",
      description: "Vous n'avez pas accès à cette section.",
      actions: []
    },
    "missions": {
      icon: Truck,
      title: "Vos missions",
      description: "Suivez vos missions de transport.",
      actions: [
        "Voir vos missions en cours",
        "Consulter l'historique"
      ]
    },
    "invoices": {
      icon: ClipboardList,
      title: "Vos factures",
      description: "Consultez et payez vos factures.",
      actions: [
        "Voir vos factures",
        "Télécharger les PDF",
        "Consulter l'historique des paiements"
      ]
    }
  }
};

const defaultMessage: RoleMessage = {
  icon: Lightbulb,
  title: "Bienvenue",
  description: "Utilisez cette page pour gérer vos opérations.",
  actions: ["Consultez les données disponibles"]
};

interface RoleExplanationCardProps {
  pageType: PageType;
  className?: string;
  collapsed?: boolean;
}

export function RoleExplanationCard({ pageType, className = "", collapsed = false }: RoleExplanationCardProps) {
  const { user } = useAuth();
  const role = user?.role || "client";
  
  const message = roleMessages[role]?.[pageType] || defaultMessage;
  const IconComponent = message.icon;
  
  if (message.actions.length === 0 && message.description.includes("pas accès")) {
    return null;
  }
  
  if (collapsed) {
    return (
      <div className={`flex items-center gap-2 text-sm text-muted-foreground bg-muted/30 px-4 py-2 rounded-lg ${className}`}>
        <IconComponent className="h-4 w-4" />
        <span className="font-medium">{message.title}</span>
        <span className="hidden md:inline">— {message.description}</span>
      </div>
    );
  }
  
  return (
    <Card className={`border-l-4 border-l-primary bg-gradient-to-r from-primary/5 to-transparent ${className}`} data-testid="role-explanation-card">
      <CardContent className="py-4">
        <div className="flex items-start gap-4">
          <div className="p-2 rounded-lg bg-primary/10">
            <IconComponent className="h-6 w-6 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-lg mb-1" data-testid="role-card-title">{message.title}</h3>
            <p className="text-muted-foreground text-sm mb-3" data-testid="role-card-description">{message.description}</p>
            {message.actions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {message.actions.map((action, index) => (
                  <span 
                    key={index}
                    className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-secondary text-secondary-foreground"
                    data-testid={`role-card-action-${index}`}
                  >
                    {action}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
