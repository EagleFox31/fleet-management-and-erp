# Yaro FleetOS - Fonctionnalités et Niveaux d'Accès par Profil

## Vue d'ensemble
Document détaillant les fonctionnalités accessibles et les niveaux de permission pour chaque profil utilisateur dans Yaro FleetOS.

---

## 1. Administrateur (admin)

### Accès Global
✅ **Accès complet** à toutes les fonctionnalités du système

### Dashboard
- KPIs globaux : flotte totale, véhicules opérationnels, budget maintenance
- Alertes système prioritaires
- Vue d'ensemble utilisateurs et activités
- Statistiques financières globales

### Fonctionnalités Principales

#### Gestion Utilisateurs
- Créer, modifier, supprimer des comptes utilisateurs
- Attribuer et modifier les rôles
- Gérer l'onboarding des nouveaux utilisateurs
- Consulter l'historique des activités utilisateurs

#### Gestion de Flotte
- Enregistrement de nouveaux véhicules
- Modification et suppression de véhicules
- Gestion des documents véhicules (carte grise, assurance)
- Suivi statut : opérationnel, en maintenance, hors service
- Historique complet de tous les véhicules

#### Maintenance (GMAO)
- Création et validation des plannings de maintenance préventive
- Suivi de tous les work orders (toutes équipes)
- Attribution des techniciens
- Validation et clôture des interventions
- Gestion du catalogue de pannes

#### Gestion de Stock
- Vue complète inventaire : **98,573,959 FCFA** de valeur de stock
- **487 pièces** en stock
- Gestion des mouvements (entrées/sorties)
- Paramétrage des seuils d'alerte
- Gestion des fournisseurs et bons de commande
- Évaluation fournisseurs : qualité, fiabilité délais, compétitivité prix
- Calcul automatique des notes fournisseurs (admin uniquement)
- **38 alertes** de réapprovisionnement

#### Carburant
- Solde carte carburant : **14,117,712 FCFA**
- Recharges et consommations
- Détection anomalies de consommation
- Statistiques par véhicule et par client
- Export historique complet

#### Pneus
- Inventaire complet des pneus
- Planification rotations et inspections
- Suivi positions et état

#### Reporting & Export
- Export Excel de toutes les données
- Génération PDF des rapports
- Statistiques financières et KPIs
- Tableaux de bord personnalisables

---

## 2. Chef d'Atelier (workshop_manager)

### Accès Étendu
✅ Gestion complète de l'atelier et des work orders  
🟡 Lecture seule sur les finances globales

### Dashboard
- Work orders actifs et en retard
- Équipe disponible (techniciens)
- Planning maintenance préventive
- Alertes maintenance prioritaires

### Fonctionnalités Principales

#### Gestion Work Orders
- Créer et assigner des work orders
- Modifier statut et priorité
- Ajouter des notes d'intervention
- Valider la complétion
- Historique complet des interventions

#### Gestion Équipe
- Vue planning techniciens
- Attribution des tâches
- Suivi performances équipe
- Gestion disponibilités

#### Maintenance Préventive
- Créer des plannings de maintenance
- Définir fréquences d'intervention
- Déclencher automatiquement les work orders
- Modifier les plannings existants

#### Stock (Lecture & Écriture Limitée)
- Consulter l'inventaire des pièces
- Créer demandes de pièces pour work orders
- Enregistrer sorties de stock (consommation)
- ❌ **Pas d'accès** aux entrées de stock ni aux prix
- Évaluer la **qualité** des fournisseurs (catégories autorisées)

#### Carburant (Recharge)
- **Recharger** la carte carburant
- Consulter solde et historique
- ❌ **Pas d'enregistrement** de consommation

#### Pneus
- Consulter inventaire pneus en stock
- Planifier rotations sur véhicules
- Enregistrer inspections et changements (montage / démontage)
- ❌ **Pas de création** de fiche pneu en stock (magasinier)

---

## 3. Technicien (technician)

### Accès Limité
✅ Work orders assignés personnellement  
❌ Pas d'accès aux données financières

### Dashboard
- **9 work orders** personnels
- Interventions du jour
- Pièces requises pour ses tâches
- Historique de ses interventions

### Fonctionnalités Principales

#### Work Orders Personnels
- Consulter les work orders qui lui sont assignés
- Modifier le statut (en cours, terminé)
- Ajouter notes et observations
- Enregistrer temps d'intervention
- Prendre photos des réparations

#### Demandes de Pièces
- Voir les pièces requises pour ses work orders
- Créer des demandes de pièces
- ❌ **Pas d'accès** direct au stock

#### Consultation Véhicules
- Voir les détails des véhicules assignés
- Consulter l'historique maintenance du véhicule
- ❌ **Pas de modification** des données véhicules

---

## 4. Secrétaire (secretary)

### Accès Administratif
✅ Documents, alertes administratives, planning  
❌ Pas d'accès technique (maintenance, stock)

### Dashboard
- Documents véhicules expirant
- Alertes administratives
- Planning général
- Tâches administratives en cours

### Fonctionnalités Principales

#### Gestion Documents
- Upload documents véhicules (carte grise, assurance, etc.)
- Suivi dates d'expiration
- Archivage et versioning
- Alertes automatiques avant expiration

#### Alertes Système
- Consulter toutes les alertes
- Marquer comme traitées
- Créer alertes personnalisées
- Notifications aux équipes

#### Planning
- Consulter planning maintenance
- Voir disponibilités techniciens
- Coordonner rendez-vous clients
- ❌ **Pas de création** de work orders

#### Achats & Fournisseurs
- Créer et modifier les fiches fournisseurs (avec admin)
- Évaluer la **compétitivité prix** des fournisseurs
- ❌ **Pas de calcul automatique** des notes fournisseurs

#### Véhicules (Lecture Seule)
- Consulter liste des véhicules
- Voir statuts et documents
- ❌ **Pas de modification** technique

---

## 5. Logistique (logistics)

### Accès Carburant & Missions
✅ Gestion complète carburant et missions  
🟡 Consultation flotte

### Dashboard
- Solde carte carburant : **14,117,712 FCFA**
- Consommations du mois
- Missions actives
- Anomalies de consommation

### Fonctionnalités Principales

#### Carburant
- **Enregistrer consommations** de carburant
- Consulter solde carte
- Historique par véhicule
- Détection anomalies
- Statistiques par client (MAERSK, CNPCC)
- Export rapports mensuels

#### Missions
- Créer missions de transport
- Assigner véhicules
- Suivre destinations et kilométrage
- Lier carburant aux missions
- Statistiques par destination

#### Fournisseurs (Performance)
- Évaluer la **fiabilité délais** des fournisseurs
- Consultation des autres notes (qualité/prix) en lecture

#### Flotte (Lecture Seule)
- Consulter liste véhicules
- Voir statut et disponibilité
- Consulter kilométrage
- ❌ **Pas de modification** technique

---

## 6. Magasinier (warehouse)

### Accès Stock
✅ Gestion complète inventaire et stock  
❌ Pas d'accès finances globales

### Dashboard
- **Valeur stock** : **98,573,959 FCFA**
- **487 pièces** en stock
- **38 alertes** de réapprovisionnement
- Mouvements récents

### Fonctionnalités Principales

#### Inventaire
- Consulter inventaire complet
- Rechercher pièces
- Voir détails (référence, prix, quantité, seuil)
- Export liste des pièces

#### Mouvements de Stock
- **Enregistrer entrées** (réceptions fournisseurs)
- **Enregistrer sorties** (consommations work orders)
- Historique des mouvements
- Justification des mouvements

#### Alertes Réapprovisionnement
- **38 alertes actives** (pièces sous seuil)
- Alertes stock bas **pneus** (`/inventory/tires`)
- Calculer quantités à commander
- Générer bons de commande
- Suivi commandes fournisseurs
- Évaluer la **qualité** des fournisseurs de pièces

#### Demandes de Pièces
- Consulter demandes des techniciens/chef d'atelier
- Valider et préparer pièces
- Marquer comme distribuées

#### Statistiques
- Pièces les plus utilisées
- Valeur stock par catégorie
- Coût réapprovisionnement estimé

#### Pneus (référentiel stock)
- **Créer / modifier** fiches pneu en stock (wizard `/inventory/tires`)
- Réception fournisseur, quantités, emplacement, seuils
- ❌ **Pas de montage** sur véhicule ni rotations (atelier)

---

## 7. Client (client)

### Accès Vue Client
✅ Consultation de sa flotte uniquement  
❌ Aucune modification

### Dashboard
- Véhicules du client
- Statut de sa flotte
- Coûts de maintenance (son compte)
- Historique interventions

### Fonctionnalités Principales

#### Flotte Client
- Consulter uniquement SES véhicules
- Voir statuts (opérationnel, en maintenance)
- Consulter kilométrage
- ❌ **Pas d'accès** aux autres clients

#### Maintenance (Lecture Seule)
- Historique des interventions sur ses véhicules
- Work orders actifs
- Coûts de maintenance
- ❌ **Pas de création** de work orders

#### Rapports
- Export PDF historique maintenance
- Statistiques de sa flotte
- Coûts mensuels

---

## Matrice de Permissions

| Fonctionnalité | Admin | Workshop Mgr | Technician | Secretary | Logistics | Warehouse | Client |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Véhicules** |
| Créer/Modifier | ✅ | 🟡 | ❌ | ❌ | ❌ | ❌ | ❌ |
| Consulter | ✅ | ✅ | 🟡 | ✅ | ✅ | 🟡 | 🟡 |
| Supprimer | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Maintenance** |
| Work Orders (Tous) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Work Orders (Perso) | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Plannings préventifs | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Stock** |
| Inventaire complet | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Entrées stock | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Sorties stock | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Demandes pièces | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| **Fournisseurs** |
| CRUD fournisseurs | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Évaluation qualité | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Évaluation fiabilité délais | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Évaluation compétitivité prix | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Calcul automatique notes | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Carburant** |
| Recharges | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Consommations | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Statistiques | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | 🟡 |
| **Pneus** |
| Fiche stock (création / modification) | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Montage, rotation, inspection | ✅ | ✅ | 🟡 | ❌ | ❌ | ❌ | ❌ |
| Consultation inventaire | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | 🟡 |
| **Documents** |
| Upload/Gestion | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Consultation | ✅ | ✅ | 🟡 | ✅ | 🟡 | ❌ | 🟡 |
| **Utilisateurs** |
| Gestion complète | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Consulter équipe | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| **Rapports/Export** |
| Tous rapports | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Rapports équipe | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Rapports perso | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**Légende:**
- ✅ **Accès complet** (lecture + écriture + suppression)
- 🟡 **Accès partiel** (lecture seule ou limité à son scope)
- ❌ **Pas d'accès**

Note: les évaluations fournisseurs sont aussi soumises au périmètre de catégorie (ex: pièces/carburant/télécom) selon les règles métier.

---

## Données Actuelles dans PostgreSQL

### Stock (Warehouse)
- **487 pièces** détachées en inventaire
- **Valeur totale** : 98,573,959 FCFA
- **38 alertes** de réapprovisionnement actives
- Fournisseurs : ONE WORLD BUSINESS S.A, AUTO SERVICES, etc.

### Carburant (Logistics)
- **39 enregistrements** fuel (août 2025)
- **Solde actuel** : 14,117,712 FCFA
- **Total crédits** : 24,778,056 FCFA
- **Total débits** : 10,660,344 FCFA

### Flotte
- **37 véhicules** enregistrés
- Clients : MAERSK, CNPCC, COTIFRAN, etc.
- Statuts : opérationnel, maintenance, hors service

### Maintenance
- **Work orders actifs** pour tous les véhicules
- **9 work orders** assignés au technicien test
- Maintenance préventive configurée

---

## Sécurité & Authentification

### Gestion des Sessions
- Session-based authentication (express-session)
- Cookies httpOnly sécurisés
- Durée de session : 24 heures
- Store en mémoire (MemoryStore)

### Middlewares d'Authentification
- `authenticate` : Vérifie la présence d'une session valide
- `isAdmin` : Réservé aux administrateurs uniquement
- `isWorkshopManager` : Administrateurs + Chefs d'atelier
- `isTechnician` : Administrateurs + Chefs d'atelier + Techniciens

### Routes Publiques (Sans Auth)
- `/api/auth/login` - Connexion
- `/api/health` - Health check
- `/dev/profiles` - Interface de test (développement uniquement)

### Routes Protégées
- Toutes les autres routes nécessitent une session valide
- Vérification du rôle pour les endpoints sensibles (création, modification, suppression)

---

## Notes Techniques

### Architecture API Modulaire (Phase 2 Sprint 1)
- **Routes modulaires** : `server/api/warehouse.routes.ts`, `server/api/fuel-card.routes.ts`
- **Services métier** : `server/services/*` (business logic séparée)
- **Router principal** : `server/api/index.ts` monte les sous-routers
- **Montage** : `app.use("/api", apiRouter)` dans `server/routes.ts`

### Tests
- **54 tests backend** ✅ (Vitest)
- **21 tests frontend** ✅ (Vitest)
- **Tests e2e** Playwright : 6 parcours critiques dans `e2e/` (voir `e2e/README.md`). ⚠️ Aucun ne valide les dashboards par rôle — la suite ne joue qu'un seul compte (`E2E_USERNAME`, `admin` par défaut).

### État Actuel
⚠️ **Problème connu** : Les dashboards affichent des zéros au lieu des données PostgreSQL réelles pour les endpoints modulaires `/api/warehouse/*` et `/api/fuel-card/*`. Investigation en cours sur la propagation de la session aux sous-routers.

---

*Document généré le 30 septembre 2025*  
*Mise à jour partielle: 22 février 2026 (ratings fournisseurs par métrique et par rôle)*  
*Yaro FleetOS v1.0 - Phase 2 Sprint 2*
