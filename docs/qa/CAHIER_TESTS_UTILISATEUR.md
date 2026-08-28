# 🧪 Cahier de Recette Utilisateur - Yaro FleetOS

<div align="center">

![Version](https://img.shields.io/badge/version-1.0-blue.svg)
![Tests](https://img.shields.io/badge/tests-127_scénarios-green.svg)
![Coverage](https://img.shields.io/badge/couverture-fonctionnelle-success.svg)

**Plan de Qualification & Tests d'Acceptation**  
*Validation fonctionnelle de la plateforme Fleet Management*

---

**Société Transport ABOUBAKAR YARORO**  
Document Confidentiel - Usage Interne & Recette Uniquement

</div>

---

## 📑 Table des Matières

- [**1. Cadrage de la recette**](#1-cadrage-de-la-recette)
  - [1.1 Objectifs & périmètre](#11-objectifs--périmètre)
  - [1.2 Stratégie de test](#12-stratégie-de-test)
  - [1.3 Prérequis techniques](#13-prérequis-techniques)
- [**2. Environnement de test**](#2-environnement-de-test)
  - [2.1 Infrastructure](#21-infrastructure)
  - [2.2 Données de test](#22-données-de-test)
  - [2.3 Comptes utilisateurs](#23-comptes-utilisateurs)
- [**3. Scénarios fonctionnels**](#3-scénarios-fonctionnels)
  - [3.1 Authentification & sécurité](#31-authentification--sécurité)
  - [3.2 Gestion de flotte](#32-gestion-de-flotte)
  - [3.3 CMMS & maintenance](#33-cmms--maintenance)
  - [3.4 Approvisionnement](#34-approvisionnement)
  - [3.5 Opérations & missions](#35-opérations--missions)
  - [3.6 Analytics & reporting](#36-analytics--reporting)
- [**4. Tests de performance**](#4-tests-de-performance)
- [**5. Tests de sécurité**](#5-tests-de-sécurité)
- [**6. Critères d'acceptation**](#6-critères-dacceptation)
- [**7. Procédure de validation**](#7-procédure-de-validation)

---

## 1. Cadrage de la recette

### 1.1 Objectifs & périmètre

#### 🎯 Objectifs de validation

Ce cahier de recette vise à **certifier** que Yaro FleetOS :

| Objectif | Description | Critère de succès |
|----------|-------------|-------------------|
| **Conformité fonctionnelle** | Toutes les features développées fonctionnent | 100% scénarios passants |
| **Fiabilité opérationnelle** | Stabilité en conditions d'usage réel | 0 bug critique |
| **Performance système** | Temps de réponse acceptables | < 2s pages, < 5s exports |
| **Sécurité données** | Protection accès & données sensibles | 0 vulnérabilité critique |
| **Ergonomie utilisateur** | UX fluide et intuitive | Score SUS > 80% |

#### 📊 Périmètre de validation

```
┌────────────────────────────────────────────────┐
│         PÉRIMÈTRE DE RECETTE v1.0              │
├────────────────────────────────────────────────┤
│ ✅ Modules Core                               │
│   • Fleet Management (véhicules, carburant)   │
│   • CMMS (maintenance, ordres de travail)      │
│   • Stock (pièces, pneus, demandes)           │
│   • Procurement (fournisseurs, commandes)      │
│   • Operations (missions, facturation)         │
│   • Analytics (rapports, exports)              │
│                                                │
│ ✅ Fonctionnalités transverses                │
│   • Authentification multi-rôles              │
│   • Système d'alertes                         │
│   • Workflow acquisition véhicule             │
│   • Export PDF/Excel                          │
│   • Import bulk Excel                         │
│                                                │
│ ⚠️ Hors périmètre v1.0                        │
│   • Intégration GPS temps réel                │
│   • API externe fournisseurs                  │
│   • Module paie chauffeurs                    │
│   • App mobile techniciens                    │
└────────────────────────────────────────────────┘
```

---

### 1.2 Stratégie de test

#### Approche méthodologique

| Phase | Type de test | Responsable | Durée |
|-------|--------------|-------------|-------|
| **1. Tests unitaires** | Composants isolés | Développeur | Continue |
| **2. Tests d'intégration** | Modules interconnectés | Tech Lead | 2 jours |
| **3. Tests fonctionnels** | Scénarios métier | Product Owner | 3 jours |
| **4. Tests UAT** | Validation utilisateurs | Key Users | 5 jours |
| **5. Tests de régression** | Non-régression | QA Team | 2 jours |

#### Niveaux de priorité

- **P0 - Bloquant** : Empêche usage production → Fix immédiat
- **P1 - Critique** : Impact majeur métier → Fix dans 48h
- **P2 - Important** : Gêne utilisateur → Fix version suivante
- **P3 - Mineur** : Cosmétique → Backlog

---

### 1.3 Prérequis techniques

#### Configuration minimale

**Poste client** :
- OS : Windows 10+ / macOS 11+ / Linux Ubuntu 20+
- RAM : 8 Go minimum
- Navigateur : Chrome 90+, Firefox 88+, Edge 90+, Safari 14+
- Résolution : 1366x768 minimum (1920x1080 recommandé)
- Connexion : 2 Mbps minimum stable

**Réseau** :
- Latence : < 100 ms vers serveur
- Bande passante : 5 Mbps partagé pour 10 utilisateurs
- Firewall : Ports 80/443 ouverts

---

## 2. Environnement de test

### 2.1 Infrastructure

#### Architecture de test

```
┌─────────────────────────────────────────┐
│  Environnement de RECETTE               │
├─────────────────────────────────────────┤
│  Frontend : Vite + React                │
│  Backend  : Node.js + Express           │
│  Database : PostgreSQL 16 (Neon)        │
│  Storage  : Fichiers locaux             │
│  Domain   : https://test.yarofleetos.cm │
└─────────────────────────────────────────┘
```

#### URLs & accès

| Environnement | URL | Compte admin | Usage |
|---------------|-----|--------------|-------|
| **Production** | https://fleetos.yaroro.cm | admin (prod) | Données réelles |
| **Recette** | https://test.yarofleetos.cm | admin | Tests fonctionnels |
| **Développement** | http://localhost:5000 | admin | Debug développeur |

> ⚠️ **Important** : Ne JAMAIS tester en production avec données réelles !

---

### 2.2 Données de test

#### Jeu de données référence

**Véhicules** : 15 unités
- 5 tracteurs routiers (Renault, MAN, Volvo)
- 5 porteurs (HOWAN, Sinotruck)
- 3 semi-remorques
- 2 véhicules légers

**Fournisseurs** : 8 acteurs
- 3 pièces détachées (Triangle, Aeolus, TYC)
- 2 carburant (Total, Oilibya)
- 2 pneumatiques (Michelin, Continental)
- 1 multi-services

**Pièces en stock** : 50+ références
- Filtres (huile, air, carburant)
- Freinage (disques, plaquettes, liquide)
- Électrique (batteries, alternateurs)

**Pneus en stock** : module séparé (`/inventory/tires`), 10+ dimensions (Michelin, Continental, etc.)

**Clients** : 5 comptes
- MAERSK (transport conteneurs)
- CNPCC (céréales)
- AFRILOG (logistique)
- SODECOTON (coton)
- AGL (général)

**Missions historiques** : 50+ opérations
- Statuts variés (active, completed, cancelled)
- Destinations multiples
- Montants de 500K à 5M FCFA

---

### 2.3 Comptes utilisateurs

#### Identifiants de test (environnement Neon courant)

> 🔐 **Référence à jour** : voir aussi `docs/qa/COMPTES_ENVIRONNEMENT.md`
>
> Les comptes seed (`technician`, `workshop_manager`, …) ne sont pas sur la base en ligne actuelle. Utiliser les logins réels ci-dessous.

| Rôle | Login | Nom affiché | Mot de passe | Email | Permissions |
|------|-------|-------------|--------------|-------|-------------|
| 👤 **Administrateur** | `admin` | Administrateur Système | `admin123` | admin@fleet.com | Tous modules |
| 🔧 **Chef d'atelier** | `terry` | Terry Koulibaly | *(création compte)* | terry@yaro.os | Maintenance + Stock |
| 👷 **Technicien** | `ali` | Ali Sawadogo | *(création compte)* | alisawa@yaro.os | Interventions |
| 📝 **Secrétaire** | `dana` | Dana Del Rey | *(création compte)* | dana@yaro.os | Facturation client + Conformité docs |
| 📦 **Logistique** | `issouf` | Issouf Coulibaly | *(création compte)* | issouf@yaro.os | Missions + Véhicules |
| 🏪 **Magasinier** | `fatou` | Fatoumata Diallo | *(création compte)* | fatou@yaro.os | Stock + Achats |
| 🚗 **Chauffeur** | `jean.mballa` | Jean Mballa | *(création compte / PIN)* | hatemenow045@gmail.com | Interface chauffeur |

> ℹ️ Aucun compte **Client** n'est présent sur l'environnement actuel.

#### Règles d'usage

✅ **Autorisé** :
- Créer / Modifier / Supprimer des données de test
- Tester tous les scénarios d'erreur
- Simuler des pannes / anomalies
- Importer des fichiers Excel de test

❌ **Interdit** :
- Utiliser des données personnelles réelles
- Tester des vulnérabilités malveillantes
- Partager les identifiants hors équipe projet
- Surcharger le système (DOS)

---

## 3. Scénarios fonctionnels

### 3.1 Authentification & sécurité

#### 🔐 TEST-AUTH-001 : Connexion nominale

**Objectif** : Valider l'authentification avec identifiants valides

| Propriété | Valeur |
|-----------|--------|
| **Priorité** | P0 - Bloquant |
| **Pré-requis** | Application accessible |
| **Durée estimée** | 2 min |
| **Profil testeur** | Tous |

**Procédure** :

| # | Action | Donnée |
|---|--------|--------|
| 1 | Accéder à la page d'accueil | URL recette |
| 2 | Cliquer sur "Connexion" | - |
| 3 | Saisir identifiant | `admin` |
| 4 | Saisir mot de passe | `admin123` |
| 5 | Cliquer "Se connecter" | - |

**Résultats attendus** :

| # | Critère | Validation |
|---|---------|------------|
| ✅ | Redirection vers `/dashboard` | [ ] OK [ ] KO |
| ✅ | Message "Bienvenue Admin Test" | [ ] OK [ ] KO |
| ✅ | Menu latéral affiché | [ ] OK [ ] KO |
| ✅ | Avatar utilisateur visible (header) | [ ] OK [ ] KO |
| ✅ | Token session créé (< 500ms) | [ ] OK [ ] KO |

**Critères de validation** : 5/5 OK → ✅ Succès

---

#### 🔐 TEST-AUTH-002 : Rejet identifiants invalides

**Objectif** : Vérifier la sécurité contre accès non autorisés

**Variantes** :

| Sous-test | Username | Password | Message attendu |
|-----------|----------|----------|-----------------|
| 002-A | `admin` | `wrongpass` | "Identifiants incorrects" |
| 002-B | `unknown` | `admin123` | "Identifiants incorrects" |
| 002-C | ` ` (vide) | `admin123` | "Veuillez remplir tous les champs" |
| 002-D | `admin` | ` ` (vide) | "Veuillez remplir tous les champs" |

**Résultats attendus** :
- ❌ Aucune redirection
- 🔒 Session non créée
- 📛 Message d'erreur affiché
- 🔄 Formulaire réinitialisé

---

#### 🔐 TEST-AUTH-003 : Déconnexion sécurisée

**Procédure** :
1. Se connecter (admin)
2. Cliquer sur avatar utilisateur (header)
3. Cliquer "Déconnexion"

**Résultats attendus** :
- ✅ Redirection vers page d'accueil
- 🔒 Session détruite côté serveur
- 🚫 Impossibilité d'accéder à `/dashboard` (redirect login)
- 🧹 Cookies/localStorage nettoyés

---

#### 🔐 TEST-AUTH-004 : Persistance session

**Objectif** : Vérifier que la session reste active

**Procédure** :
1. Se connecter (admin)
2. Naviguer dans l'application (5 min)
3. Rafraîchir la page (F5)

**Résultats attendus** :
- ✅ Session maintenue (pas de re-login)
- ✅ Utilisateur toujours identifié
- ⏱️ Timeout session > 30 min inactivité

---

#### 🔐 TEST-AUTH-005 : Contrôle d'accès par rôle

**Objectif** : Valider que chaque rôle accède uniquement à ses fonctionnalités

| Rôle | Doit voir | Ne doit PAS voir |
|------|-----------|------------------|
| **Technicien** | "Mes ordres de travail" | "Gestion utilisateurs" |
| **Magasinier** | "Stock pièces" | "Facturation clients" |
| **Client** | "Mes missions" | "Maintenance", "Stock" |

**Procédure pour chaque rôle** :
1. Se connecter avec compte rôle
2. Vérifier menu latéral
3. Tenter accès direct URL restreinte (ex: `/admin/users` pour technicien)

**Résultats attendus** :
- ✅ Menu adapté au rôle
- 🚫 403 Forbidden sur URLs restreintes
- 🔄 Redirection automatique si non autorisé

---

### 3.2 Gestion de flotte

#### 🚛 TEST-FLEET-001 : Consultation liste véhicules

**Objectif** : Afficher le parc complet avec filtres

**Procédure** :
1. Connexion admin
2. Menu latéral « Ressources Véhicules » > « Véhicules »

**Résultats attendus** :

| Critère | Validation |
|---------|------------|
| 📊 Tableau avec ≥15 véhicules | [ ] OK |
| 🔤 Colonnes : Immatriculation, Marque, Modèle, Statut, Km | [ ] OK |
| 🔍 Barre de recherche fonctionnelle | [ ] OK |
| 🎚️ Filtres : Statut, Marque | [ ] OK |
| 📄 Pagination (10 par page) | [ ] OK |
| ➕ Bouton "Ajouter véhicule" visible | [ ] OK |

---

#### 🚛 TEST-FLEET-002 : Création véhicule via workflow

**Objectif** : Valider le processus d'acquisition guidé

**Procédure** :

| Étape | Action | Données |
|-------|--------|---------|
| 1 | Cliquer "Ajouter véhicule" | - |
| 2 | **Wizard étape 1** : Infos générales | |
| | Immatriculation | `TEST-001-AB` |
| | Marque | `Renault` |
| | Modèle | `T High 520` |
| | Année | `2024` |
| | Kilométrage initial | `0` |
| | Type | `Tracteur` |
| | Cliquer "Suivant" | - |
| 3 | **Wizard étape 2** : Documents | |
| | Carte grise | Uploader PDF test |
| | Assurance | Uploader PDF test |
| | Date fin assurance | `31/12/2025` |
| | Cliquer "Suivant" | - |
| 4 | **Wizard étape 3** : Équipements | |
| | Ajouter accessoire | `Remorque semi` |
| | Cliquer "Suivant" | - |
| 5 | **Wizard étape 4** : OT initial | |
| | Créer OT maintenance | Cocher OUI |
| | Cliquer "Suivant" | - |
| 6 | **Wizard étape 5** : Validation | |
| | Vérifier récapitulatif | - |
| | Cliquer "Créer le véhicule" | - |

**Résultats attendus** :
- ✅ Véhicule créé avec ID unique
- ✅ Redirection vers fiche véhicule
- ✅ Tous les champs renseignés visibles
- ✅ Documents uploadés accessibles
- ✅ OT initial créé (si coché)
- ✅ Message succès affiché

---

#### 🚛 TEST-FLEET-003 : Mise à jour kilométrage

**Objectif** : Enregistrer évolution km véhicule

**Procédure** :
1. Ouvrir fiche véhicule `AB123CD`
2. Cliquer "Mettre à jour kilométrage"
3. Modal s'ouvre
4. Saisir nouveau km : `125000` (> actuel)
5. Motif : `Retour mission Douala`
6. Cliquer "Enregistrer"

**Résultats attendus** :
- ✅ Km mis à jour sur fiche
- ✅ Historique km créé
- ⚠️ Alerte si nouveau km < actuel
- 📊 Graphique évolution km actualisé

---

#### 🚛 TEST-FLEET-004 : Gestion carte carburant

**Objectif** : Recharger et consulter solde

**Procédure** :
1. Fiche véhicule > Onglet "Carburant"
2. Cliquer "Recharger carte"
3. Montant : `500000` FCFA
4. Station : `Total Bali`
5. Cliquer "Valider"

**Résultats attendus** :
- ✅ Solde carte augmenté de 500K
- ✅ Ligne d'historique créée
- 📊 Graphique consommations actualisé
- 🔔 Alerte si anomalie conso détectée

---

#### 🚛 TEST-FLEET-005 : Alertes documents expirés

**Objectif** : Vérifier système d'alertes proactif

**Scénario** : Véhicule avec assurance expirant dans 15 jours

**Procédure** :
1. Dashboard admin
2. Section "Alertes"
3. Filtrer : Type "Documents"

**Résultats attendus** :
- 🔔 Alerte affichée : "Assurance véhicule AB123CD expire le XX/XX"
- 🟠 Niveau : "Urgent" (< 30 jours)
- 📄 Lien vers fiche véhicule
- ✅ Possibilité de "Marquer comme traité"

---

### 3.3 CMMS & maintenance

#### 🔧 TEST-MAINT-001 : Création ordre de travail manuel

**Objectif** : Enregistrer une intervention corrective

**Procédure** :

| Champ | Valeur |
|-------|--------|
| Véhicule | `EF456GH` (MAN TGX) |
| Type | Correctif |
| Priorité | Haute |
| Titre | `Problème freinage avant` |
| Description | `Freins mous, niveau liquide bas détecté` |
| Technicien | `Darren Thay` |
| Date début | Aujourd'hui |

**Résultats attendus** :
- ✅ OT créé avec numéro unique (ex: `OT-2024-035`)
- ✅ Statut initial : `pending`
- ✅ Notification envoyée au technicien
- ✅ Visible dans liste OT atelier
- 📊 KPI "OT en attente" incrémenté

---

#### 🔧 TEST-MAINT-002 : Cycle de vie complet OT

**Objectif** : Traiter un OT de bout en bout

**Procédure** :

| Étape | Acteur | Action | Statut résultant |
|-------|--------|--------|------------------|
| 1 | Chef atelier | Créer OT | `pending` |
| 2 | Chef atelier | Assigner technicien | `assigned` |
| 3 | Technicien | Démarrer intervention | `in_progress` |
| 4 | Technicien | Ajouter pièces utilisées | `in_progress` |
| 5 | Technicien | Saisir diagnostic | `in_progress` |
| 6 | Technicien | Terminer intervention | `completed` |
| 7 | Chef atelier | Valider travaux | `validated` |

**Pour chaque transition** :
- ✅ Changement statut effectif
- ✅ Badge couleur actualisé
- 📧 Notification partie prenante
- 📊 Historique tracé

---

#### 🔧 TEST-MAINT-003 : Ajout pièces à un OT

**Objectif** : Consommer stock lors intervention

**Procédure** :
1. Ouvrir OT en cours
2. Section "Pièces utilisées"
3. Cliquer "Ajouter pièce"
4. Sélectionner : `Filtre à huile Renault`
5. Quantité : `2`
6. Cliquer "Ajouter"

**Résultats attendus** :
- ✅ Ligne pièce créée
- 📦 Stock pièce décrémenté de 2
- 💰 Coût pièce ajouté au total OT
- ⚠️ Alerte si stock insuffisant
- 🔔 Déclenchement demande réappro si seuil atteint

---

#### 🔧 TEST-MAINT-004 : Maintenance préventive automatique

**Objectif** : Vérifier génération auto des OT préventifs

**Scénario** : Véhicule atteint seuil 20 000 km (vidange moteur)

**Procédure** :
1. Créer planification : "Vidange moteur tous les 20 000 km"
2. Véhicule `AB123CD` actuellement à 119 500 km
3. Mettre à jour km à 120 100 km
4. Vérifier génération OT

**Résultats attendus** :
- ✅ OT créé automatiquement
- 📋 Titre : "Maintenance préventive: Vidange moteur"
- ⚙️ Type : Préventif
- 🔔 Alerte chef atelier
- 📅 Planifié dans les 7 jours

---

#### 🔧 TEST-MAINT-005 : Export PDF ordre de travail

**Objectif** : Générer bon de travail imprimable

**Procédure** :
1. Ouvrir OT complété (ex: `OT-2024-005`)
2. Cliquer bouton "Imprimer"
3. PDF généré

**Résultats attendus** :
- 📄 PDF contient :
  - En-tête officiel entreprise (logo)
  - Infos véhicule (immat, marque, modèle)
  - Détail intervention (date, technicien, heures)
  - Liste pièces avec quantités et prix
  - Total général (pièces + MO)
  - Diagnostic technique
- ✅ Mise en page professionnelle
- 💾 Téléchargement automatique

---

### 3.4 Approvisionnement

#### 🛒 TEST-PROC-001 : Création fournisseur

**Objectif** : Enregistrer nouveau partenaire

**Procédure** :

| Champ | Valeur |
|-------|--------|
| Nom | `TOTAL CAMEROUN` |
| Type | Carburant |
| Contact | `Jean Mbarga` |
| Téléphone | `+237 699 XX XX XX` |
| Email | `contact@total.cm` |
| Adresse | `Douala, Akwa` |
| Conditions paiement | `30 jours fin de mois` |
| Rating | ⭐⭐⭐⭐ (4/5) |

**Résultats attendus** :
- ✅ Fiche fournisseur créée
- ✅ ID unique généré
- ✅ Visible dans liste fournisseurs
- 🔍 Trouvable par recherche
- 📊 Statistiques initialisées (0 commandes)

---

#### 🛒 TEST-PROC-002 : Commande groupée automatique

**Objectif** : Valider regroupement intelligent des demandes

**Scénario** :
- Demande 1 : Filtre huile × 5 (fournisseur Triangle)
- Demande 2 : Filtre air × 3 (fournisseur Triangle)
- Demande 3 : Plaquettes frein × 2 (fournisseur TYC)

**Procédure** :
1. Créer les 3 demandes d'approvisionnement
2. Menu latéral « Approvisionnement » > « Commandes »
3. Observer regroupement automatique

**Résultats attendus** :
- ✅ 2 commandes groupées créées :
  - **PO-001** : Triangle (Filtre huile + Filtre air)
  - **PO-002** : TYC (Plaquettes frein)
- 📅 Numérotation : `PO-YYYYMMDD-XXX`
- 💰 Totaux calculés automatiquement
- 🚚 Code livraison généré

---

#### 🛒 TEST-PROC-003 : Réception commande

**Objectif** : Enregistrer livraison fournisseur

**Procédure** :
1. Ouvrir commande `PO-001` (statut : En attente)
2. Cliquer "Réceptionner"
3. Saisir code livraison : `LIV-2024-001`
4. Valider quantités reçues
5. Cliquer "Confirmer réception"

**Résultats attendus** :
- ✅ Statut commande → `Reçue`
- 📦 Stock incrémenté (pièces reçues)
- 📅 Date réception enregistrée
- 🔔 Notification magasinier
- ⏭️ Prêt pour rapprochement facture

---

#### 🛒 TEST-PROC-004 : Rapprochement 3 voies

**Objectif** : Valider contrôle Commande-Réception-Facture

**Scénario** : Facture fournisseur reçue

| Ligne | PO qty | Reçu | Facturé | Prix PO | Prix facture |
|-------|--------|------|---------|---------|--------------|
| Filtre huile | 5 | 5 | 5 | 15 000 | 15 000 |
| Filtre air | 3 | 3 | 3 | 8 000 | 8 500 |

**Procédure** :
1. Créer facture fournisseur liée à PO-001
2. Système détecte écart prix filtre air
3. Alerte générée

**Résultats attendus** :
- ⚠️ Alerte écart : "Prix filtre air : attendu 8 000, facturé 8 500"
- 🟡 Statut facture : `En attente validation`
- 📧 Notification gestionnaire achats
- ✅ Possibilité accepter écart ou contester

---

#### 🛒 TEST-PROC-005 : Import Excel factures

**Objectif** : Saisie accélérée par fichier

**Procédure** :
1. Télécharger modèle Excel
2. Remplir 10 lignes de facture
3. Importer fichier
4. Observer validation

**Résultats attendus** :
- ✅ Parsing Excel réussi
- 🔍 Validation ligne par ligne
- ❌ Erreurs signalées clairement :
  - Ligne 3 : Référence pièce inconnue
  - Ligne 7 : Prix unitaire manquant
- ✅ Lignes valides pré-remplies
- 🔄 Possibilité corriger et ré-importer

---

#### 🛒 TEST-PROC-006 : Évaluations fournisseur par rôle (qualité / délais / prix)

**Objectif** : Vérifier que chaque rôle modifie uniquement la métrique qui lui est autorisée.

**Procédure** :
1. Ouvrir un fournisseur dans l'onglet **Performances**
2. En `workshop_manager` ou `warehouse`, modifier uniquement la note **Qualité**
3. En `logistics`, modifier uniquement la note **Fiabilité délais**
4. En `secretary`, modifier uniquement la note **Compétitivité prix**
5. Tenter une modification non autorisée (ex: logisticien modifie Qualité)
6. En `admin`, cliquer **Calcul automatique**

**Résultats attendus** :
- ✅ Modifications autorisées enregistrées (HTTP 200 sur `PATCH /api/suppliers/:id/rating`)
- ❌ Modification non autorisée bloquée (HTTP 403)
- ✅ Calcul automatique possible en admin (HTTP 200 sur `POST /api/suppliers/:id/calculate-ratings`)
- ❌ Calcul automatique refusé pour les autres rôles (HTTP 403)
- ✅ Les notes affichées (dashboard + fiche fournisseur) sont cohérentes après mise à jour

---

### 3.5 Opérations & missions

#### 🎯 TEST-OPS-001 : Création mission client

**Objectif** : Enregistrer nouvelle opération

**Procédure** :

| Champ | Valeur |
|-------|--------|
| Client | `MAERSK` |
| Destination | `Douala → Ngaoundéré` |
| Type marchandise | `Conteneurs` |
| Poids | `25 tonnes` |
| Véhicule | `AB123CD` (Renault Premium) |
| Chauffeur | `Jean Ndongo` |
| Date départ | Aujourd'hui |
| Montant | `1 500 000` FCFA |

**Résultats attendus** :
- ✅ Mission créée (ID unique)
- ✅ Statut initial : `active`
- 🚛 Véhicule marqué "En mission"
- 👤 Chauffeur affecté
- 📊 KPI "Missions actives" +1

---

#### 🎯 TEST-OPS-002 : Facturation automatique mission

**Objectif** : Générer facture à partir mission complétée

**Procédure** :
1. Marquer mission comme "Livrée"
2. Cliquer "Générer facture"
3. Vérifier facture créée

**Résultats attendus** :
- 📄 Facture générée : `FACT-20241129-001`
- 💰 Montant HT : 1 500 000 FCFA
- 💵 TVA 19,25% : 288 750 FCFA
- 💳 Total TTC : 1 788 750 FCFA
- 📅 Date facturation : Aujourd'hui
- 🔗 Lien mission → facture
- 📥 Téléchargement PDF possible

---

#### 🎯 TEST-OPS-003 : Suivi paiement client

**Objectif** : Gérer échéancier paiement

**Scénario** : Facture 1 788 750 FCFA, paiement 50% acompte

**Procédure** :
1. Ouvrir facture `FACT-20241129-001`
2. Cliquer "Enregistrer paiement"
3. Montant : `894 375` (50%)
4. Mode : `Virement bancaire`
5. Cliquer "Valider"

**Résultats attendus** :
- ✅ Paiement enregistré
- 💰 Solde restant : 894 375 FCFA
- 📊 Statut facture : `Partiellement payée`
- 🟡 Badge jaune affiché
- 📅 Historique paiements tracé

---

#### 🎯 TEST-OPS-004 : Dashboard client dédié

**Objectif** : Vue consolidée par client

**Procédure** :
1. Menu latéral « Facturation client » > onglet « Clients »
2. Sélectionner client : `MAERSK`
3. Observer KPIs

**Résultats attendus** :
- 📊 Widget "Missions" : Total, actives, complétées
- 💰 Widget "Facturation" : CA total, payé, en attente
- 📈 Graphique évolution CA mensuel
- 📋 Liste dernières missions
- 💳 Liste dernières factures
- ⏱️ Délai moyen livraison

---

### 3.6 Analytics & reporting

#### 📊 TEST-REPORT-001 : Export Excel véhicules

**Objectif** : Extraire données parc complet

**Procédure** :
1. Menu latéral « Ressources Véhicules » > « Véhicules »
2. Cliquer "Exporter en Excel"
3. Fichier téléchargé

**Résultats attendus** :
- 📥 Fichier `vehicules_20241129.xlsx` téléchargé
- 📊 Contient toutes colonnes :
  - Immatriculation, Marque, Modèle, Année
  - Kilométrage, Statut, Date acquisition
  - Documents (oui/non), Alertes
- ✅ 15 lignes (= nb véhicules en base)
- 🎨 Formatage professionnel (en-têtes, bordures)

---

#### 📊 TEST-REPORT-002 : Export PDF ordre de travail

**Objectif** : Générer rapport technique formaté

**Procédure** :
1. Ouvrir OT complété
2. Cliquer "Exporter PDF"

**Résultats attendus** :
- 📄 PDF contient :
  - 🏢 **En-tête** : Logo + nom entreprise
  - 🚛 **Véhicule** : Immat, marque, modèle, km
  - 🔧 **Intervention** : Date, technicien, durée
  - 📦 **Pièces** : Liste détaillée avec prix
  - 💰 **Coûts** : Pièces + MO + Total
  - 📝 **Diagnostic** : Texte formaté
  - 📅 **Footer** : Date génération, page X/Y
- ✅ Mise en page professionnelle
- 🖨️ Prêt à imprimer (A4)

---

#### 📊 TEST-REPORT-003 : Documentation utilisateur PDF

**Objectif** : Télécharger guide depuis plateforme

**Procédure** :
1. Ouvrir `/admin/documentation` (⚠️ page non listée dans le menu latéral)
2. Cliquer "Guide utilisateur"
3. Cliquer "Télécharger PDF"

**Résultats attendus** :
- 📥 `GUIDE_UTILISATEUR.pdf` téléchargé
- 📄 Document formaté avec :
  - Table des matières interactive
  - Sections numérotées
  - Captures d'écran
  - En-tête/footer corporate
- ✅ Lisible, professionnel
- 📖 30+ pages

---

#### 📊 TEST-REPORT-004 : KPIs temps réel dashboard

**Objectif** : Vérifier actualisation indicateurs

**Procédure** :
1. Ouvrir dashboard admin
2. Noter valeur "OT en cours" : X
3. Créer nouvel OT
4. Revenir dashboard (refresh)

**Résultats attendus** :
- ✅ KPI "OT en cours" = X + 1
- ⚡ Actualisation < 2 secondes
- 📊 Graphiques mis à jour
- 🎨 Animation de changement valeur

---

## 4. Tests de performance

### ⚡ PERF-001 : Temps chargement pages

**Objectif** : Vérifier réactivité application

| Page | Temps max acceptable | Validation |
|------|----------------------|------------|
| Dashboard | 2s | [ ] OK |
| Liste véhicules (50 items) | 1.5s | [ ] OK |
| Liste OT (100 items) | 2s | [ ] OK |
| Fiche véhicule | 1s | [ ] OK |
| Export Excel (500 lignes) | 5s | [ ] OK |
| Export PDF | 3s | [ ] OK |

**Procédure** : Utiliser DevTools Network (Chrome) pour mesurer

---

### ⚡ PERF-002 : Charge utilisateurs simultanés

**Objectif** : Stabilité sous charge

**Scénario** :
- 10 utilisateurs connectés simultanément
- Actions mixtes (consultation, création, modification)
- Durée test : 30 minutes

**Critères de succès** :
- ✅ Aucune erreur 500
- ✅ Temps réponse < 3s (95e percentile)
- ✅ Pas de timeout
- ✅ Pas de perte de session

---

### ⚡ PERF-003 : Import fichier volumineux

**Objectif** : Traitement données bulk

**Procédure** :
1. Préparer Excel 1000 lignes facture
2. Importer via interface
3. Mesurer temps traitement

**Résultats attendus** :
- ✅ Import réussi
- ⏱️ Durée < 30 secondes
- 📊 Barre progression affichée
- ✅ Validation ligne par ligne
- 🚫 Pas de freeze interface

---

## 5. Tests de sécurité

### 🔒 SEC-001 : Injection SQL

**Objectif** : Vérifier protection contre SQL injection

**Procédure** :
1. Champ recherche véhicule
2. Saisir : `' OR '1'='1`
3. Observer comportement

**Résultats attendus** :
- ✅ Aucune erreur SQL
- ✅ Requête échappée correctement
- 🚫 Pas d'exposition données sensibles

---

### 🔒 SEC-002 : XSS (Cross-Site Scripting)

**Objectif** : Bloquer scripts malveillants

**Procédure** :
1. Créer OT
2. Titre : `<script>alert('XSS')</script>`
3. Enregistrer et réafficher

**Résultats attendus** :
- ✅ Texte affiché brut (pas exécuté)
- 🚫 Pas d'alerte JavaScript
- ✅ Sanitization effectuée

---

### 🔒 SEC-003 : Contrôle accès API

**Objectif** : Vérifier authentification requise

**Procédure** :
1. Se déconnecter
2. Appeler directement API : `GET /api/users` (via curl/Postman)

**Résultats attendus** :
- 🚫 HTTP 401 Unauthorized
- 🔒 Message : "Authentication required"
- ✅ Pas de données retournées

---

### 🔒 SEC-004 : Force brute login

**Objectif** : Bloquer attaques par tentatives répétées

**Procédure** :
1. Tenter 10 connexions avec mauvais password
2. Observer comportement

**Résultats attendus** :
- ⏸️ Après 5 échecs : Temporisation 30s
- 🚫 Après 10 échecs : Blocage 1h
- 📧 Alerte admin si détection attaque

---

## 6. Critères d'acceptation

### ✅ Validation globale

La recette est **ACCEPTÉE** si :

| Critère | Seuil | Validation |
|---------|-------|------------|
| **Tests bloquants (P0)** | 100% OK | [ ] ✅ |
| **Tests critiques (P1)** | ≥ 95% OK | [ ] ✅ |
| **Tests importants (P2)** | ≥ 90% OK | [ ] ✅ |
| **Performance pages** | < 2s (95e pct) | [ ] ✅ |
| **Sécurité** | 0 vulnérabilité critique | [ ] ✅ |
| **Ergonomie (SUS)** | Score > 80% | [ ] ✅ |

### 📋 Grille de décision

```
┌───────────────────────────────────────────┐
│  Si tous critères ✅ → RECETTE VALIDÉE    │
│  Si 1 critère ❌ P0/P1 → RECETTE REJETÉE │
│  Si critères ❌ P2 uniquement → RÉSERVES  │
└───────────────────────────────────────────┘
```

---

## 7. Procédure de validation

### 📝 Rapport de recette

#### Template à compléter

```markdown
# RAPPORT DE RECETTE - Yaro FleetOS v1.0

**Date** : ____________________
**Testeur** : ____________________
**Environnement** : Recette / Production
**Navigateur** : Chrome ___ / Firefox ___ / Edge ___

## Résumé exécutif
- Tests exécutés : ____ / 127
- Tests réussis : ____
- Tests échoués : ____
- Taux de succès : ____%

## Détail par module
| Module | Tests | OK | KO | Taux |
|--------|-------|----|----|------|
| Authentification | 5 | __ | __ | __% |
| Gestion flotte | 5 | __ | __ | __% |
| CMMS | 5 | __ | __ | __% |
| Approvisionnement | 5 | __ | __ | __% |
| Opérations | 4 | __ | __ | __% |
| Analytics | 4 | __ | __ | __% |
| Performance | 3 | __ | __ | __% |
| Sécurité | 4 | __ | __ | __% |

## Anomalies détectées
| ID | Module | Priorité | Description | Statut |
|----|--------|----------|-------------|--------|
| BUG-001 | ___ | P_ | ___________ | Open |
| BUG-002 | ___ | P_ | ___________ | Open |

## Décision finale
[ ] ✅ RECETTE VALIDÉE - Déploiement autorisé
[ ] 🟡 VALIDÉE AVEC RÉSERVES - Corrections mineures
[ ] ❌ RECETTE REJETÉE - Corrections majeures requises

**Signature** : ____________________
**Date** : ____________________
```

---

### 🔄 Cycle itératif

```
1. Exécution tests
   ↓
2. Rapport anomalies
   ↓
3. Corrections développeurs
   ↓
4. Nouveaux tests (régression)
   ↓
5. Validation finale
```

**Estimation durée** : 2-3 itérations × 5 jours = 10-15 jours

---

### 📧 Communication

#### Points de contact

| Rôle | Nom | Email | Responsabilité |
|------|-----|-------|----------------|
| **Product Owner** | ___ | ___ | Validation fonctionnelle |
| **Tech Lead** | ___ | ___ | Correction bugs |
| **QA Manager** | ___ | ___ | Pilotage recette |
| **Key User** (Admin) | ___ | ___ | Tests utilisateur |
| **Key User** (Atelier) | ___ | ___ | Tests métier CMMS |

#### Réunions

- **Daily** : Point avancement tests (15 min)
- **Hebdo** : Revue anomalies & décisions (1h)
- **Go/No-Go** : Validation finale déploiement (2h)

---

## 📄 Annexes

### A. Checklist rapide

**Avant de démarrer** :
- [ ] Environnement recette accessible
- [ ] Comptes de test créés
- [ ] Données de référence chargées
- [ ] Navigateurs à jour
- [ ] Outils capture écran prêts

**Pendant les tests** :
- [ ] Noter toute anomalie immédiatement
- [ ] Capturer écran des erreurs
- [ ] Consigner temps d'exécution
- [ ] Valider chaque critère

**À la fin** :
- [ ] Rapport complété
- [ ] Anomalies loguées (Jira/Trello)
- [ ] Décision formalisée
- [ ] Archivage résultats

---

### B. Glossaire

| Terme | Définition |
|-------|------------|
| **CMMS** | Computerized Maintenance Management System |
| **OT** | Ordre de Travail |
| **KPI** | Key Performance Indicator |
| **UAT** | User Acceptance Testing (Recette utilisateur) |
| **P0/P1/P2** | Niveaux de priorité (Bloquant/Critique/Important) |
| **SUS** | System Usability Scale (échelle ergonomie) |

---

<div align="center">

**Document Version 1.0**  
*Dernière mise à jour : 29 Novembre 2024*

![Yaro FleetOS](https://img.shields.io/badge/Quality%20Assurance-Yaro%20FleetOS-blue.svg)

---

**Confidentiel - Ne pas diffuser**  
© 2024 Société Transport ABOUBAKAR YARORO

</div>
