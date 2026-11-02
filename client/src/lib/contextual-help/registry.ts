import type { PageHelpEntry, PageHelpMatcher } from "./types";

export const DEFAULT_PAGE_HELP: PageHelpEntry = {
  title: "Besoin d'aide ?",
  intro: "Choisissez une action — on vous montre où cliquer.",
  steps: [
    {
      label: "Ouvrir le menu de navigation",
      target: '[data-help-target="app-sidebar"]',
    },
  ],
};

export const PAGE_HELP_MATCHERS: PageHelpMatcher[] = [
  {
    test: (p) => p === "/dashboard" || p === "/",
    entry: {
      title: "Page d'accueil",
      intro: "Cliquez sur une action pour être guidé.",
      steps: [
        { label: "Voir le menu principal", target: '[data-help-target="app-sidebar"]' },
        { label: "Consulter vos alertes", target: '[data-testid="button-contextual-help"]' },
      ],
    },
  },
  {
    test: (p) => p === "/admin/dashboard",
    entry: {
      title: "Tableau de bord direction",
      intro: "Cliquez pour aller à la zone concernée.",
      steps: [
        { label: "Voir les chiffres de la flotte", target: '[data-testid="admin-kpi-fleet"]', roles: ["admin"] },
        { label: "Voir le stock de pièces", target: '[data-testid="admin-kpi-parts"]', roles: ["admin"] },
        { label: "Changer d'onglet (Finances, Utilisateurs…)", target: '[data-help-target="admin-dashboard-tabs"]', roles: ["admin"] },
      ],
    },
  },

  // ── Réparations — liste ─────────────────────────────────────
  {
    test: (p) => p === "/maintenance/work-orders",
    entry: {
      title: "Ordres de travail",
      intro: "Touchez une ligne ci-dessous — on vous montre où agir.",
      steps: [
        { label: "Voir le détail d'une réparation", target: '[data-help-target="wo-table"]' },
        { label: "Créer une nouvelle réparation", target: '[data-help-target="wo-new"]', roles: ["admin", "workshop_manager"] },
        { label: "Filtrer par état (en attente, en cours…)", target: '[data-testid="filter-pending"]' },
        { label: "Chercher une réparation", target: '[data-testid="input-search-work-orders"]' },
        { label: "Démarrer une réparation depuis la liste", target: '[data-help-target="wo-table-actions"]', roles: ["admin", "workshop_manager", "technician"] },
      ],
    },
  },
  {
    test: (p) => p.includes("/maintenance/work-orders/new"),
    entry: {
      title: "Nouvelle réparation",
      intro: "Remplissez le formulaire puis validez en bas.",
      steps: [
        { label: "Remplir le formulaire", target: '[data-help-target="wo-form"]' },
      ],
    },
  },
  {
    test: (p) => /\/maintenance\/work-orders\/\d+/.test(p),
    entry: {
      title: "Détail réparation",
      intro: "Cliquez — on vous emmène au bon endroit.",
      steps: [
        { label: "Mettre le travail en cours", target: '[data-help-target="wo-start"]', roles: ["admin", "workshop_manager", "technician"] },
        { label: "Demander une pièce", target: '[data-help-target="wo-add-part"]', prepareAction: "wo-tab-parts", roles: ["admin", "workshop_manager", "technician"] },
        { label: "Voir l'onglet Pièces", target: '[data-help-target="wo-tab-parts"]', prepareAction: "wo-tab-parts" },
        { label: "Terminer la réparation", target: '[data-help-target="wo-complete"]', roles: ["admin", "workshop_manager", "technician"] },
        { label: "Lire la description et le diagnostic", target: '[data-help-target="wo-details"]', prepareAction: "wo-tab-details" },
        { label: "Retour à la liste", target: '[data-testid="btn-back-work-orders"]' },
      ],
    },
  },

  // ── Technicien ──────────────────────────────────────────────
  {
    test: (p) => p.startsWith("/technician/my-work-orders"),
    entry: {
      title: "Mes réparations",
      intro: "Vos tâches du jour — cliquez pour voir où agir.",
      steps: [
        { label: "Voir les réparations en attente", target: '[data-help-target="tech-wo-tabs"]' },
        { label: "Commencer une réparation", target: '[data-help-target="tech-wo-start"]', roles: ["technician"] },
        { label: "Mettre à jour une réparation en cours", target: '[data-help-target="tech-wo-update"]', roles: ["technician"] },
        { label: "Demander une pièce au magasin", target: '[data-help-target="tech-wo-parts"]', prepareAction: "tech-open-update-modal", roles: ["technician"] },
      ],
    },
  },

  // ── Véhicules ───────────────────────────────────────────────
  {
    test: (p) => p === "/vehicles/new",
    entry: {
      title: "Ajouter un camion",
      steps: [
        { label: "Remplir le formulaire du camion", target: '[data-help-target="vehicle-form"]' },
      ],
    },
  },
  {
    test: (p) => p === "/vehicles" || (p.startsWith("/vehicles") && !p.includes("/documents")),
    entry: {
      title: "Liste des camions",
      intro: "Cliquez pour localiser l'action sur l'écran.",
      steps: [
        { label: "Voir la liste des camions", target: '[data-help-target="vehicle-table"]' },
        { label: "Ajouter un camion", target: '[data-help-target="vehicle-add"]', roles: ["admin", "workshop_manager"] },
        { label: "Ouvrir la fiche d'un camion", target: '[data-help-target="vehicle-table"]' },
      ],
    },
  },

  // ── Stock ───────────────────────────────────────────────────
  {
    test: (p) => p === "/inventory/new" || /^\/inventory\/\d+/.test(p),
    entry: {
      title: "Pièce — ajout ou modification",
      steps: [
        { label: "Remplir la fiche pièce", target: '[data-help-target="part-form"]' },
      ],
    },
  },
  {
    test: (p) => p.startsWith("/inventory-requests"),
    entry: {
      title: "Demandes de pièces",
      intro: "Cliquez pour voir où faire chaque action.",
      steps: [
        { label: "Voir les demandes en cours", target: '[data-help-target="part-requests-list"]' },
        { label: "Créer une nouvelle demande", target: '[data-help-target="part-request-new"]', roles: ["admin", "workshop_manager", "technician", "warehouse"] },
      ],
    },
  },
  {
    test: (p) => p.startsWith("/inventory"),
    entry: {
      title: "Magasin de pièces",
      intro: "Cliquez — on vous montre où agir.",
      steps: [
        { label: "Chercher une pièce", target: '[data-help-target="inventory-search"]' },
        { label: "Ajouter une pièce", target: '[data-testid="header-btn-add-part"]', roles: ["admin", "warehouse"] },
        { label: "Voir les alertes stock bas", target: '[data-help-target="inventory-alerts"]' },
        { label: "Voir la liste des pièces", target: '[data-help-target="inventory-table"]' },
      ],
    },
  },

  // ── Missions ────────────────────────────────────────────────
  {
    test: (p) => p.includes("/missions/new"),
    entry: {
      title: "Nouvelle mission",
      steps: [{ label: "Remplir la mission", target: '[data-help-target="mission-form"]' }],
    },
  },
  {
    test: (p) => p.startsWith("/missions"),
    entry: {
      title: "Missions transport",
      intro: "Cliquez pour vous rendre au bon endroit.",
      steps: [
        { label: "Voir la liste des missions", target: '[data-testid="table-missions"]' },
        { label: "Créer une mission", target: '[data-testid="btn-new-mission"]', roles: ["admin", "logistics"] },
      ],
    },
  },

  // ── Facturation ─────────────────────────────────────────────
  {
    test: (p) => p.startsWith("/operations"),
    entry: {
      title: "Facturation client",
      intro: "Cliquez pour localiser l'action.",
      steps: [
        { label: "Changer d'onglet (Clients / Factures)", target: '[data-testid="tab-clients"]' },
        { label: "Ajouter un client", target: '[data-testid="btn-create-client"]', roles: ["admin", "secretary"] },
        { label: "Voir la liste des clients", target: '[data-help-target="clients-list"]' },
      ],
    },
  },

  // ── Fournisseurs / commandes ────────────────────────────────
  {
    test: (p) => p.startsWith("/procurement/suppliers"),
    entry: {
      title: "Fournisseurs",
      steps: [
        { label: "Voir la liste des fournisseurs", target: '[data-help-target="suppliers-list"]' },
        { label: "Ajouter un fournisseur", target: '[data-help-target="supplier-add"]', roles: ["admin", "logistics", "warehouse", "secretary"] },
      ],
    },
  },
  {
    test: (p) => p.startsWith("/procurement/orders"),
    entry: {
      title: "Commandes",
      steps: [
        { label: "Voir les commandes", target: '[data-help-target="orders-list"]' },
        { label: "Créer une commande", target: '[data-help-target="order-new"]', roles: ["admin", "logistics", "warehouse"] },
      ],
    },
  },

  // ── Chauffeur ───────────────────────────────────────────────
  {
    test: (p) => p.startsWith("/driver"),
    entry: {
      title: "Application chauffeur",
      intro: "Touchez une action — on vous montre le bouton.",
      steps: [
        { label: "Voir ma mission", target: '[data-help-target="driver-mission-tab"]', roles: ["driver"] },
        { label: "Changer le statut (en route / livré)", target: '[data-help-target="driver-status-action"]', roles: ["driver"] },
      ],
    },
  },

  {
    test: (p) => p.startsWith("/alerts"),
    entry: {
      title: "Alertes",
      steps: [{ label: "Voir toutes les alertes", target: '[data-help-target="alerts-list"]' }],
    },
  },
];
