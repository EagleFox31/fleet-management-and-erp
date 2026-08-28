# 📘 Guide Utilisateur Yaro FleetOS

<div align="center">

![Version](https://img.shields.io/badge/version-1.0-blue.svg)
![Status](https://img.shields.io/badge/status-production-green.svg)
![License](https://img.shields.io/badge/license-proprietary-red.svg)

**Plateforme de Gestion de Flotte & CMMS**  
*Solution professionnelle pour l'optimisation de vos opérations de transport*

---

**Société Transport ABOUBAKAR YARORO**  
Document Confidentiel - Usage Interne Uniquement

</div>

---

## 📑 Table des Matières

- [**1. Vue d'ensemble**](#1-vue-densemble)
  - [1.1 Introduction à la plateforme](#11-introduction-à-la-plateforme)
  - [1.2 Architecture fonctionnelle](#12-architecture-fonctionnelle)
  - [1.3 Bénéfices métier](#13-bénéfices-métier)
- [**2. Prise en main**](#2-prise-en-main)
  - [2.1 Accès sécurisé](#21-accès-sécurisé)
  - [2.2 Interface utilisateur](#22-interface-utilisateur)
  - [2.3 Navigation optimisée](#23-navigation-optimisée)
- [**3. Modules fonctionnels**](#3-modules-fonctionnels)
  - [3.1 Gestion de flotte](#31-gestion-de-flotte)
  - [3.2 Maintenance (CMMS)](#32-maintenance-cmms)
  - [3.3 Approvisionnement](#33-approvisionnement)
  - [3.4 Opérations & missions](#34-opérations--missions)
  - [3.5 Analyse & reporting](#35-analyse--reporting)
- [**4. Référentiel des rôles**](#4-référentiel-des-rôles)
- [**5. Support & assistance**](#5-support--assistance)

---

## 1. Vue d'ensemble

### 1.1 Introduction à la plateforme

**Yaro FleetOS** est une solution intégrée de **Fleet Management** et **CMMS** (Computerized Maintenance Management System) développée pour répondre aux exigences opérationnelles des flottes de véhicules lourds.

#### 🎯 Objectifs stratégiques

La plateforme vise à :
- Optimiser le **TCO** (Total Cost of Ownership) de votre flotte
- Améliorer la **disponibilité opérationnelle** des véhicules
- Renforcer la **conformité réglementaire** et documentaire
- Digitaliser les **processus métier** de bout en bout

#### 💡 Positionnement métier

Yaro FleetOS s'adresse aux acteurs du transport routier de marchandises nécessitant :
- Une traçabilité exhaustive des opérations
- Un pilotage en temps réel des ressources
- Une maîtrise des coûts d'exploitation
- Une gestion rigoureuse de la maintenance préventive et corrective

---

### 1.2 Architecture fonctionnelle

#### Modules Core

| Module | Description | Utilisateurs cibles |
|--------|-------------|---------------------|
| **Fleet Management** | Suivi du parc véhicules, documents, kilométrage | Admin, Logistique |
| **CMMS** | Planification maintenance, ordres de travail, pièces | Atelier, Techniciens |
| **Procurement** | Achats, fournisseurs, commandes groupées | Admin, Magasinier |
| **Operations** | Missions clients, facturation, performance | Logistique, Secrétariat |
| **Analytics** | Tableaux de bord, KPIs, exports | Direction, Admin |

#### Couverture fonctionnelle

```
┌─────────────────────────────────────────────────────┐
│                  YARO FLEETOS                       │
├─────────────────────────────────────────────────────┤
│  Véhicules → Maintenance → Pièces → Approvisionnement
│      ↓           ↓           ↓            ↓         │
│  Documents   Planification  Stock   Fournisseurs   │
│      ↓           ↓           ↓            ↓         │
│  Alertes     Interventions  Pneus    Commandes     │
│      ↓           ↓           ↓            ↓         │
│  Carburant   Ordres travail Demandes  Factures     │
└─────────────────────────────────────────────────────┘
```

---

### 1.3 Bénéfices métier

#### Pour la Direction
- 📊 Vision 360° de la performance opérationnelle
- 💰 Réduction des coûts de maintenance jusqu'à 25%
- 📈 ROI mesurable et traçable
- 🎯 Aide à la décision basée sur la data

#### Pour l'Atelier
- 🔧 Planification optimisée des interventions
- 📦 Gestion efficace des pièces détachées
- 👥 Meilleure répartition des charges techniciens
- 📱 Mobilité et accès terrain

#### Pour la Logistique
- 🚛 Suivi temps réel des missions
- 📍 Optimisation des tournées
- 📄 Facturation automatisée
- 🔔 Alertes proactives

---

## 2. Prise en main

### 2.1 Accès sécurisé

#### 🔐 Connexion à la plateforme

1. **Accéder à l'URL** fournie par votre administrateur système
2. **Page d'accueil** : présentation vidéo et navigation rapide
3. **Bouton "Connexion"** : situé en haut à droite de l'en-tête

#### Identifiants de connexion (environnement courant)

> ⚠️ **Référence à jour** : `docs/qa/COMPTES_ENVIRONNEMENT.md` — comptes réels de la base Neon connectée au projet.

| Profil | Login | Nom affiché | Mot de passe | Permissions |
|--------|-------|-------------|--------------|-------------|
| 👤 **Administrateur** | `admin` | Administrateur Système | `admin123` | Accès complet |
| 🔧 **Chef d'atelier** | `terry` | Terry Koulibaly | *(création compte)* | Maintenance + Stock |
| 👷 **Technicien** | `ali` | Ali Sawadogo | *(création compte)* | Interventions |
| 📝 **Secrétaire** | `dana` | Dana Del Rey | *(création compte)* | Opérations + Factures |
| 📦 **Logistique** | `issouf` | Issouf Coulibaly | *(création compte)* | Missions + Véhicules |
| 🏪 **Magasinier** | `fatou` | Fatoumata Diallo | *(création compte)* | Stock + Commandes |
| 🚗 **Chauffeur** | `jean.mballa` | Jean Mballa | *(création compte / PIN)* | Interface mobile chauffeur |

#### Première connexion

Au chargement initial :
1. **Écran de démarrage** : animation corporate avec camion
2. **Barre de progression** en 3 étapes :
   - ⚡ Chargement de la flotte
   - 🔧 Initialisation du système
   - ✅ Prêt à l'emploi
3. **Redirection** vers votre tableau de bord personnalisé

---

### 2.2 Interface utilisateur

#### Structure de l'écran

```
┌────────────────────────────────────────────────────┐
│  LOGO         [Notifications]  [Mon profil ▾]      │ ← En-tête
├──────────┬─────────────────────────────────────────┤
│          │                                          │
│  MENU    │        ZONE DE CONTENU                  │
│  LATERAL │        (Tableaux, formulaires...)        │
│          │                                          │
│          │                                          │
└──────────┴─────────────────────────────────────────┘
```

#### En-tête (Header)

| Élément | Description | Action |
|---------|-------------|--------|
| **Logo Yaro FleetOS** | Identification visuelle | Retour à l'accueil (clic) |
| **🔔 Notifications** | Alertes temps réel | Ouvre le panneau d'alertes |
| **👤 Mon profil** | Menu utilisateur | Profil, paramètres, déconnexion |

#### Menu latéral (Sidebar)

Navigation hiérarchique adaptée selon vos permissions :

- **📊 Tableau de bord** : Vue synthétique et KPIs
- **🚛 Ressources Véhicules**
  - Parc véhicules
  - Gestion carburant
  - Chauffeurs
- **🔧 Maintenance**
  - Interventions en cours
  - Ordres de travail
  - Maintenance préventive
- **📦 Gestion de stock**
  - Inventaire pièces
  - Gestion des pneus
  - Demandes d'approvisionnement
- **🛒 Approvisionnement**
  - Catalogue fournisseurs
  - Commandes d'achat
  - Factures fournisseurs
- **🎯 Opérations**
  - Missions clients
  - Facturation
  - Statistiques
- **👨‍🔧 Techniciens**
  - Équipe technique
  - Planning interventions
- **📄 Documents**
  - Alertes documentaires
  - Workflows d'acquisition
- **📈 Analyse**
  - Rapports personnalisés
  - Exports de données
- **⚙️ Administration** *(admin)*
  - Gestion utilisateurs
  - Paramètres système

---

### 2.3 Navigation optimisée

#### Fil d'Ariane (Breadcrumb)

Toujours visible en haut du contenu :
```
Accueil > Maintenance > Ordres de travail > OT-2024-001
```

#### Recherche globale

- **Raccourci clavier** : `Ctrl + K` (Windows) ou `Cmd + K` (Mac)
- **Portée** : Véhicules, OT, pièces, fournisseurs, missions
- **Filtres** : Par type, statut, période

#### Actions contextuelles

Chaque page propose des actions adaptées :
- **Boutons primaires** : Actions principales (bleu)
- **Boutons secondaires** : Actions complémentaires (gris)
- **Actions rapides** : Menu d'actions (⋮)

---

## 3. Modules fonctionnels

### 3.1 Gestion de flotte

#### Vue d'ensemble

Centralisez la gestion complète de votre parc roulant :

| Fonctionnalité | Description | Bénéfices |
|----------------|-------------|-----------|
| **Fiche véhicule** | Données techniques, documents, historique | Vision 360° |
| **Suivi kilométrage** | Mise à jour manuelle ou automatique | Planification maintenance |
| **Documents réglementaires** | Assurance, CT, vignette, permis | Conformité garantie |
| **Cartes carburant** | Recharges, consommations, anomalies | Contrôle des coûts |
| **Alertes proactives** | Expiration documents, seuils km | Anticipation risques |

#### Workflow d'acquisition véhicule

Processus guidé en 5 étapes :

```
1. Informations générales
   ↓
2. Documents administratifs
   ↓
3. Équipements & options
   ↓
4. Création OT initial
   ↓
5. Validation & activation
```

#### Indicateurs clés

- **Disponibilité flotte** : % véhicules opérationnels
- **Coût au km** : Total exploitation / km parcourus
- **Âge moyen parc** : En années
- **Taux conformité** : Documents à jour / total

---

### 3.2 Maintenance (CMMS)

#### Architecture du module

```
Maintenance Préventive ──┬──→ Planning automatique
                         ├──→ Seuils kilométriques
                         └──→ Échéances temporelles

Maintenance Corrective ──┬──→ Signalement panne
                         ├──→ Diagnostic technique
                         └──→ Ordre de travail

Pièces détachées ────────┬──→ Stock temps réel
                         ├──→ Seuils réapprovisionnement
                         └──→ Historique consommations
```

#### Cycle de vie d'un ordre de travail

| Étape | Acteur | Statut | Actions |
|-------|--------|--------|---------|
| **1. Création** | Atelier/Auto | `pending` | Définir intervention |
| **2. Assignation** | Chef atelier | `assigned` | Affecter technicien |
| **3. Intervention** | Technicien | `in_progress` | Diagnostic + réparation |
| **4. Contrôle** | Chef atelier | `review` | Validation travaux |
| **5. Clôture** | Chef atelier | `completed` | Facture + archivage |

#### Fonctionnalités avancées

- **🔍 Diagnostic assisté** : Catalogues pannes par modèle
- **📋 Check-lists** : Points de contrôle standardisés
- **📸 Photos** : Documentation visuelle interventions
- **🧾 Pièces utilisées** : Traçabilité consommations
- **⏱️ Temps passé** : Valorisation main d'œuvre
- **💰 Coûts réels** : Pièces + MO + fournitures

#### Maintenance préventive

Automatisation des planifications :

| Type | Critère | Fréquence | Exemple |
|------|---------|-----------|---------|
| **Vidange** | Kilométrage | 20 000 km | Huile moteur + filtres |
| **Révision** | Temps | 12 mois | Contrôle général |
| **Contrôle technique** | Réglementaire | 12 mois | Inspection légale |
| **Pneus** | Mixte | 50 000 km ou usure | Rotation/remplacement |

---

### 3.3 Approvisionnement

#### Vision stratégique

Optimisez vos achats et relations fournisseurs :

```
Fournisseurs ──→ Performance rating
               ├→ Conditions négociées
               └→ Historique achats

Commandes ─────→ Groupage automatique
               ├→ Codes de livraison
               └→ Suivi temps réel

Factures ──────→ Rapprochement 3 voies
               ├→ Validation écarts
               └→ Comptabilisation
```

#### Commandes groupées

**Innovation métier** : Le système groupe automatiquement les demandes par fournisseur pour :
- 💰 Obtenir de meilleurs tarifs (effet volume)
- ⏱️ Réduire les délais de livraison
- 📦 Optimiser la logistique
- 🎯 Simplifier le suivi

#### Rapprochement 3 voies

Contrôle automatisé **Commande → Réception → Facture** :

| Vérification | Tolérance | Action si écart |
|--------------|-----------|-----------------|
| **Quantités** | ±5% | Alerte gestionnaire |
| **Prix unitaires** | Stricte | Blocage paiement |
| **Montant total** | ±2% | Validation manuelle |

#### Import Excel factures

Fonctionnalité de **saisie accélérée** :
1. Télécharger le modèle Excel
2. Remplir les lignes de facturation
3. Importer le fichier (validation automatique)
4. Corriger les erreurs signalées
5. Valider le lot complet

---

### 3.4 Opérations & missions

#### Gestion des missions clients

Pilotage intégral du cycle commercial :

```
Client ──→ Création mission
         ├→ Affectation véhicule + chauffeur
         ├→ Suivi GPS (optionnel)
         ├→ Validation livraison
         └→ Facturation automatique
```

#### Tableau de bord opérationnel

Indicateurs temps réel :

| KPI | Définition | Utilité |
|-----|------------|---------|
| **Missions actives** | En cours de réalisation | Charge opérationnelle |
| **CA période** | Chiffre d'affaires facturé | Performance commerciale |
| **Taux occupation** | Véhicules affectés / total | Optimisation ressources |
| **Délai moyen** | Création → livraison | Efficacité processus |

#### Facturation clients

- **Numérotation auto** : FACT-YYYYMMDD-XXX avec verrous concurrence
- **TVA 19,25%** : Application réglementaire
- **Multi-échéances** : Acompte, solde, paiement partiel
- **Export PDF** : Facture brandée avec en-tête officiel
- **Historique** : Traçabilité complète paiements

---

### 3.5 Analyse & reporting

#### Rapports disponibles

| Rapport | Contenu | Format | Périodicité |
|---------|---------|--------|-------------|
| **Flotte** | État parc, coûts, disponibilité | PDF/Excel | Mensuel |
| **Maintenance** | Interventions, pièces, délais | PDF/Excel | Mensuel |
| **Approvisionnement** | Achats, fournisseurs, économies | Excel | Trimestriel |
| **Opérations** | Missions, CA, clients | PDF/Excel | Mensuel |
| **Consolidé** | Vue globale multi-modules | PDF | Mensuel |

#### Exports de données

- **📊 Excel** : Tous les tableaux de données
- **📄 PDF** : Rapports formatés avec branding
- **🔄 Automatisation** : Programmation envois email
- **🎯 Filtres** : Période, statut, client, véhicule...

#### Tableaux de bord personnalisés

Configurez vos KPIs prioritaires :
- Drag & drop des widgets
- Choix des périodes d'analyse
- Sauvegarde de vos vues
- Partage avec d'autres utilisateurs

---

## 4. Référentiel des rôles

### 🔐 Matrice des permissions

| Fonctionnalité | Admin | Atelier | Tech | Secrét. | Logist. | Magasin | Client |
|----------------|:-----:|:-------:|:----:|:-------:|:-------:|:-------:|:------:|
| **Véhicules** | ✅ | ✅ | 👁️ | 👁️ | ✅ | 👁️ | ❌ |
| **Maintenance** | ✅ | ✅ | ✅* | 👁️ | 👁️ | ❌ | ❌ |
| **Pièces** | ✅ | ✅ | ✅* | ❌ | ❌ | ✅ | ❌ |
| **Achats** | ✅ | ✅* | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Missions** | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | 👁️ |
| **Facturation** | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | 👁️ |
| **Utilisateurs** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Rapports** | ✅ | ✅ | 👁️ | ✅ | ✅ | 👁️ | 👁️* |

**Légende** :
- ✅ : Accès complet (lecture + écriture)
- 👁️ : Lecture seule
- ✅* : Accès limité à son périmètre
- ❌ : Pas d'accès

### Descriptions détaillées

#### 👤 Administrateur
**Rôle stratégique** : Responsable système et gestion globale

**Responsabilités** :
- Paramétrage plateforme
- Gestion utilisateurs et droits
- Supervision de tous les modules
- Validation des budgets importants
- Export des données sensibles

**Tableaux de bord** : Vue consolidée multi-modules

---

#### 🔧 Chef d'atelier
**Rôle opérationnel** : Pilotage de la maintenance

**Responsabilités** :
- Planification des interventions
- Affectation des techniciens
- Validation des diagnostics
- Gestion du stock pièces
- Reporting performance atelier

**Tableaux de bord** : OT, charge techniciens, consommation pièces

---

#### 👷 Technicien
**Rôle terrain** : Exécution des interventions

**Responsabilités** :
- Réalisation des réparations
- Saisie diagnostics techniques
- Consommation pièces
- Reporting temps passé
- Contrôle qualité sortie atelier

**Tableaux de bord** : Mes OT, mes interventions

---

#### 📝 Secrétaire
**Rôle administratif** : Support opérations et facturation

**Responsabilités** :
- Création missions clients
- Facturation et suivi paiements
- Gestion documentaire
- Suivi alertes administratives
- Relation clients

**Tableaux de bord** : Missions, factures, alertes documents

---

#### 📦 Logistique
**Rôle opérationnel** : Gestion des missions

**Responsabilités** :
- Planification tournées
- Affectation véhicules/chauffeurs
- Suivi missions en cours
- Optimisation rotations
- Statistiques clients

**Tableaux de bord** : Missions, véhicules disponibles, performance

---

#### 🏪 Magasinier
**Rôle support** : Gestion du stock

**Responsabilités** :
- Inventaire pièces détachées
- Réception commandes
- Valorisation stock
- Gestion des pneus
- Demandes réapprovisionnement

**Tableaux de bord** : Stock, mouvements, alertes seuils

---

#### 🏢 Client
**Rôle consultation** : Suivi de ses missions

**Responsabilités** :
- Consultation missions en cours
- Historique livraisons
- Factures et paiements
- Statistiques personnalisées

**Tableaux de bord** : Mes missions, mes factures

---

## 5. Support & assistance

### 📞 Canaux de support

#### Support Niveau 1 - Utilisateur
**Auto-support** via la plateforme :
- 💡 Tutoriels intégrés (bulles d'aide)
- 📖 Guide utilisateur (ce document)
- 🎥 Vidéos de démonstration
- ❓ FAQ contextuelle

#### Support Niveau 2 - Technique
**Contact** équipe IT interne :
- 📧 Email : support.fleetos@yaroro.cm
- 📱 Téléphone : +237 XXX XXX XXX
- ⏰ Horaires : Lun-Ven 8h-18h
- 🕒 Délai réponse : < 4h ouvrées

#### Support Niveau 3 - Éditeur
**Escalade** pour bugs critiques :
- Via votre administrateur système
- Ticket Jira avec logs système
- Hotline urgence (incidents majeurs)

---

### 🐛 Signalement d'anomalie

#### Procédure standard

1. **Reproduire** le problème
2. **Capturer** écran (screenshot)
3. **Noter** les étapes exactes
4. **Contacter** le support avec :
   - Description précise
   - Capture d'écran
   - Module concerné
   - Rôle utilisateur
   - Date/heure incident

#### Niveaux de criticité

| Niveau | Impact | Exemple | Délai résolution |
|--------|--------|---------|------------------|
| **🔴 Critique** | Blocage activité | Connexion impossible | 2h |
| **🟠 Majeur** | Fonctionnalité KO | Export ne fonctionne pas | 8h |
| **🟡 Mineur** | Gêne utilisateur | Mise en page décalée | 48h |
| **🔵 Cosmétique** | Esthétique | Couleur bouton | Prochain sprint |

---

### 🎓 Formation continue

#### Webinaires mensuels
- **Nouveautés** : Présentation features récentes
- **Best practices** : Optimisation usage
- **Q&A** : Session questions/réponses
- **Replay** : Disponible 30 jours

#### Documentation mise à jour
- **Release notes** : À chaque déploiement
- **Changelog** : Historique modifications
- **Roadmap** : Évolutions prévues

---

### 📋 Bonnes pratiques

#### Performance optimale

✅ **À faire** :
- Utiliser les filtres pour limiter les résultats
- Fermer les onglets inutilisés
- Vider le cache navigateur mensuellement
- Utiliser Chrome/Edge dernière version
- Connexion internet stable (min 2 Mbps)

❌ **À éviter** :
- Ouvrir trop d'onglets simultanément
- Importer des fichiers Excel > 5 Mo
- Lancer plusieurs exports lourds en parallèle
- Utiliser Internet Explorer (non supporté)

#### Sécurité des données

🔐 **Recommandations** :
- Changer votre mot de passe tous les 3 mois
- Ne jamais partager vos identifiants
- Verrouiller votre session si absence prolongée
- Signaler tout comportement suspect
- Respecter la confidentialité des données

---

## 📄 Mentions légales

### Propriété intellectuelle

**Yaro FleetOS** est une solution propriétaire développée pour la **Société Transport ABOUBAKAR YARORO**.

- Copyright © 2024-2025 - Tous droits réservés
- Toute reproduction interdite sans autorisation
- Utilisation strictement réservée aux employés autorisés

### Protection des données

Conformité **RGPD** et réglementations locales :
- Données hébergées localement (Cameroun)
- Chiffrement des connexions (SSL/TLS)
- Sauvegarde quotidienne automatique
- Rétention selon politique interne

---

### Assistance & Contact

Pour toute question sur ce guide ou la plateforme :

**Service Support IT**  
Société Transport ABOUBAKAR YARORO  
📧 support.fleetos@yaroro.cm  
📱 +237 XXX XXX XXX

---

<div align="center">

**Document Version 1.0**  
*Dernière mise à jour : 29 Novembre 2024*

![Yaro FleetOS](https://img.shields.io/badge/Powered%20by-Yaro%20FleetOS-green.svg)

</div>
