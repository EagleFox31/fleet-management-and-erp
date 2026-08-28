# 🚀 SPRINT 5 - PLANIFICATION DETAILLEE
## Lot 2.3 - Tresorerie & Comptabilite (MVP)

**Date:** 20 fevrier 2026  
**Sprint:** Phase 2 - Sprint 5 (demarrage module Tresorerie)  
**Duree:** 10 jours ouvrables (2 semaines)  
**Reference cadrage:** `PLANIFICATION_MVP_COMPLETE.md` (Etape 2.3)

---

## 🎯 OBJECTIFS DU SPRINT 5

### Vision globale
Demarrer le **module Tresorerie/Comptabilite** en version MVP avec:
- Journal des encaissements/decaissements
- Suivi des soldes par compte (banque/caisse)
- Dashboard financier de base
- API et UI exploitables en production interne

### Resultats attendus
- ✅ Tables `bank_accounts` et `treasury_transactions` operationnelles
- ✅ Service backend `TreasuryService` avec regles de mise a jour de solde
- ✅ Routes API `/api/treasury/*` (CRUD + synthese)
- ✅ Pages front `/treasury/*` (dashboard, journal, saisie, comptes)
- ✅ Tests API critiques + 1 parcours E2E smoke

---

## 🧱 PERIMETRE LOT 2.3 (RAPPEL CADRAGE)

| Sous-etape Lot 2.3 | Cible lot | Couverte Sprint 5 | Statut Sprint 5 |
|---|---|---|---|
| 2.3.1 Gestion encaissements/decaissements | Journal + categories + transactions | Oui (complet MVP) | 🎯 Priorite haute |
| 2.3.2 Soldes bancaires multi-comptes | Comptes + soldes temps reel | Oui (base solide) | 🎯 Priorite haute |
| 2.3.3 Previsions tresorerie | Forecast 3/6/12 mois | Non (post-MVP) | 📌 Sprint suivant |
| 2.3.4 Integration comptabilite | Exports comptables avances | Partiel (export simple) | 📌 Extension |
| 2.3.5 Dashboard direction | KPIs direction | Partiel (MVP KPI) | 📌 Extension |
| 2.3.6 Tests & deploiement | qualification complete | Partiel (socle tests) | 📌 Extension |

---

## 🏗️ ARCHITECTURE CIBLE SPRINT 5

### Backend
```text
shared/
  schema.ts                         # + bank_accounts + treasury_transactions

server/
  services/
    treasury-service.ts             # nouveau service metier
  api/
    treasury.routes.ts              # nouvelles routes REST
    index.ts                        # montage /treasury
```

### Frontend
```text
client/src/
  pages/
    treasury/
      dashboard.tsx                 # KPI + soldes
      journal.tsx                   # liste transactions + filtres
      transaction-new.tsx           # saisie encaissement/decaissement
      accounts.tsx                  # liste/edition comptes
  services/
    treasuryService.ts              # appels API typed
  App.tsx                           # routes /treasury/*
  components/layout/sidebar.tsx     # entree menu Tresorerie
```

---

## 🧩 STRATEGIE DE MODULARISATION (VALIDEE)

Objectif: livrer le MVP compta vite, sans aggraver la dette technique.

### A faire pendant Sprint 5 (obligatoire)
1. Ecrire tout le nouveau code tresorerie en mode modulaire:
   - `server/api/treasury.routes.ts`
   - `server/services/treasury-service.ts`
   - repository tresorerie dedie (pas de logique nouvelle dans `server/storage.ts`)
2. `server/routes.ts`:
   - limiter les changements au strict branchement/montage des routes.

### A faire juste apres le MVP (Sprint 6 - chantier de durcissement)
1. Migrer le reste de `server/routes.ts` par domaines (`vehicles.routes.ts`, `fuel.routes.ts`, etc.).
2. Decouper `server/storage.ts` via pattern Repository (users, vehicles, parts, ...).
3. Refactor `client/src/pages/inventory/tires/index.tsx` en sous-composants + hooks (`TireList`, `TireForm`, `TireFilters`).

### Benefices attendus
1. Maintenabilite plus forte
2. Tests unitaires facilites
3. Reutilisation des composants
4. Travail d'equipe en parallele

---

## 📋 PLAN D'ACTION DETAILLE (10 JOURS)

### J1-J2 - Data model & migration
1. Ajouter table `bank_accounts`:
   - `id`, `name`, `accountType` (`bank` | `cash`), `currency`, `currentBalance`, `isActive`, `createdAt`, `updatedAt`
2. Ajouter table `treasury_transactions`:
   - `id`, `transactionDate`, `type` (`encaissement` | `decaissement`), `category`, `description`
   - `reference`, `counterparty`, `amount`, `bankAccountId`, `sourceType`, `sourceId`, `createdBy`, `createdAt`
3. Ajouter relations Drizzle + schemas Zod d'insertion
4. Creer migration DB et seed initial:
   - `CAISSE PRINCIPALE`
   - `COMPTE BANQUE SGC`

### J3-J4 - Service metier Tresorerie
1. Creer `TreasuryService`:
   - `createTransaction()`
   - `listTransactions(filters)`
   - `getSummary(period, accountId?)`
   - `getAccounts()`, `createAccount()`, `updateAccount()`
2. Regles metier:
   - Encaissement => `currentBalance += amount`
   - Decaissement => `currentBalance -= amount`
   - Controle anti-montant negatif
   - Verrou transactionnel DB (atomicite ecriture + solde)
3. Categories MVP:
   - `vente`, `achat`, `salaire`, `charge`, `investissement`, `autre`

### J5 - API Routes
1. `GET /api/treasury/accounts`
2. `POST /api/treasury/accounts`
3. `PATCH /api/treasury/accounts/:id`
4. `GET /api/treasury/transactions`
5. `POST /api/treasury/transactions`
6. `GET /api/treasury/summary`
7. Montage du routeur dans `server/api/index.ts`
8. Auth/roles: lecture `admin|secretary|workshop_manager`, ecriture `admin|secretary`

### J6-J7 - UI MVP
1. Page `/treasury/dashboard`
   - KPIs: total entrees, total sorties, net, solde global
   - Cartes soldes par compte
2. Page `/treasury/journal`
   - Table transactions
   - Filtres: date, type, categorie, compte
3. Page `/treasury/transactions/new`
   - Formulaire saisie transaction
4. Page `/treasury/accounts`
   - Liste comptes + creation/edition simple
5. Ajouter menu "Tresorerie" dans sidebar

### J8 - Integration metier minimale
1. Lier les paiements existants comme `sourceType` optionnel:
   - `client_payment`
   - `supplier_payment`
2. Ajouter endpoint de creation transaction depuis paiement (optionnel MVP+)
3. Verifier coherence avec modules `billing` et `supplier-invoices`

### J9 - Tests
1. Tests API:
   - creation encaissement met a jour solde
   - creation decaissement met a jour solde
   - filtres journal
   - synthese periode
2. Test d'integration:
   - sequence multi-transactions et solde final exact
3. E2E smoke:
   - login -> nouvelle transaction -> verification dashboard

### J10 - Stabilisation & doc
1. Correction bugs et nettoyage typage
2. Documentation utilisateur MVP
3. Mise a jour etat avancement (`ETAT_AVANCEMENT_ACTUEL_2026-02-20.md`)

---

## 🔄 ALIGNEMENT LOGIQUE EXCEL (SOURCES METIER)

Ce sprint aligne le MVP sur les fichiers:
- `attached_assets/EXEMPLAIRE SUIVI TRESORERIE_1759168900037.xlsx` (onglets `BANK`, `CAISSE`, `FSSUERS`)
- `attached_assets/SUIVI DES TRAITES ET CHEQUES DECAISSEMENTS_1759168900038.xlsx`
- `attached_assets/RELEVE DE COMPTE CNPCC_1759168900038.xlsx`

### Mapping MVP
- `MOIS`, `DATE`, `LIBELLE`, `REF. PIECE`, `CLIENT/F.SSEUR`, `ENTREE`, `SORTIE`, `SOLDE`
  -> `treasury_transactions` + recalcul solde sur `bank_accounts`

---

## ✅ DEFINITION OF DONE (SPRINT 5)

1. Les routes `/api/treasury/*` sont disponibles et testees.
2. Les pages `/treasury/*` sont accessibles depuis la navigation.
3. Toute transaction impacte correctement le solde du compte associe.
4. Le dashboard affiche des KPI coherents avec le journal.
5. Les tests critiques passent (`unit/integration` + `1 e2e smoke`).
6. Le module est documente (usage et limites MVP).

---

## ⚠️ RISQUES & PARADES

1. **Risque:** incoherence des soldes en cas de concurrence ecriture  
   **Parade:** transactions SQL atomiques + verrous au niveau service.

2. **Risque:** divergence entre pratiques Excel et categories MVP  
   **Parade:** dictionnaire de categories extensible + champ `autre`.

3. **Risque:** dette typage (`any`) dans modules legacy  
   **Parade:** typer strictement le nouveau module tresorerie des Sprint 5.

---

## ➡️ SUITE PREVUE (SPRINT 6+)

1. Previsions tresorerie 3/6/12 mois (2.3.3)
2. Reconciliation bancaire avancee (2.3.2 extension)
3. Exports comptables avances (2.3.4)
4. Dashboard direction enrichi (2.3.5)

---

## Note de tracabilite (hors perimetre Sprint 5)

Mise a jour transversale realisee le **22 fevrier 2026** sur le module fournisseurs (Lot 1):

1. Saisie des ratings fournisseurs par metrique depuis l'onglet Performance.
2. Permissions backend renforcees par metrique (`quality`, `reliability`, `price`).
3. Calcul automatique des ratings reserve au role `admin`.

Cette livraison ne modifie pas les objectifs du Sprint 5 (Tresorerie MVP), elle est tracee ici pour coherence planning globale.
