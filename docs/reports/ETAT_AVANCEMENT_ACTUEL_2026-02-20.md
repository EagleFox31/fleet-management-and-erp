# ETAT D'AVANCEMENT ACTUEL - YARO FLEETOS

Date de reference: 20 fevrier 2026  
Source: audit du code present dans ce workspace + revue des documents de cadrage

## Addendum implementation - 17 aout 2026 (socle e2e)

Le point 2 du backlog priorise ("ajouter un socle e2e") est realise. Les matrices ci-dessous ont ete corrigees en consequence: les lignes qui declaraient les e2e `MANQUANT` etaient perimees.

Ce qui existe desormais:

- `playwright.config.ts` a la racine: Chromium seul, `baseURL` `http://127.0.0.1:5000`, `fullyParallel: false`, 1 worker par defaut, 2 retries si `CI`, `webServer` qui lance `npm run dev` automatiquement.
- 6 specs dans `e2e/`, une par parcours critique: auth, flotte, ordres de travail, procurement 3 voies, mission -> facture -> paiement, et synchronisation temps reel des OT entre deux sessions.
- Helper de connexion partage: `e2e/helpers/auth.ts`.
- Scripts `npm run test:e2e` et `npm run test:e2e:headed`.
- Documentation complete: `e2e/README.md` (parcours, config, variables, donnees, limites).

Limites a lever (ne pas lire ces tests comme une garantie de non-regression metier):

1. **Aucun jeu de donnees dedie**: les specs tournent sur la base pointee par `DATABASE_URL`, sans seed ni nettoyage. Les specs 05 et 06 ecrivent reellement (un paiement, un OT `E2E-RT-<timestamp>`).
2. **Specs tolerantes a une base vide**: 04 et 05 se declarent `skipped` si aucun ecart / aucune facture n'existe (corrige le 17 aout 2026: elles sortaient auparavant en succes, ce qui masquait l'absence de couverture). Surveiller les `skipped` dans le rapport: ils signalent un chemin metier non exerce.
3. **Parcours role-based encore marginal**: seule la spec 06 joue deux profils distincts (chef d'atelier -> magasinier, corrige le 17 aout 2026). Les specs 01 a 05 tournent sur un compte unique (`E2E_USERNAME`, `admin` par defaut) et ne valident aucune regle RBAC, alors que le metier repose sur 9 roles.
4. **Chemin metier complet non automatise**: panne -> OT -> demande de piece -> commande fournisseur -> reception -> facture -> reglement reste un protocole manuel (`docs/qa/E2E PANNE-OT-REAPPRO-FACTURE`).
5. **Pas de workflow CI** dans le repo.

## Addendum implementation - 22 fevrier 2026

Mise a jour effective realisee le 22 fevrier 2026 sur le module fournisseurs:

- UI complete de saisie des notes fournisseurs dans `client/src/pages/procurement/suppliers/[id].tsx`:
  - `qualityRating`, `reliabilityRating`, `priceCompetitiveness`
  - bouton de calcul automatique
  - affichage de la date de derniere mise a jour
- Durcissement backend dans `server/api/suppliers.routes.ts`:
  - droits par metrique (pas seulement par endpoint)
  - refus 403 si un role tente de modifier une metrique non autorisee
  - calcul automatique reserve a `admin`
- Mise a jour documentaire:
  - `PROFILS_ACCES.md`
  - `QA-CRUD.md`

## Reponse directe a ta question

Oui. Le cahier de recette, les plans de sprint, les lots et les plans MVP/Phase 2 ont ete lus et croises au code reel.

## Sources relues (cadrage)

- `CAHIER_TESTS_UTILISATEUR.md:229`
- `SPRINT3_PLAN_DETAILLE.md:67`
- `SPRINT4_PLAN_DETAILLE.md:62`
- `PLANIFICATION_PHASE2_YARO_FLEETOS.md:63`
- `PLANIFICATION_MVP_COMPLETE.md:80`
- `ETAT_AVANCEMENT_LOT1_YARO_FLEETOS_29_09_2025.md:26`
- `CORRESPONDANCE_LOT1_EXISTANT_EXCEL_29_09_2025.md:20`

## Matrice 1 - Cahier de recette utilisateur

Legende: `FAIT` = implemente dans le code, `PARTIEL` = present mais incomplet, `MANQUANT` = non present.

| Bloc cahier | Statut | Preuves code | Ecart principal |
|---|---|---|---|
| Authentification et roles (TEST-AUTH) | FAIT | `server/routes.ts:77`, `server/routes.ts:186`, `server/routes.ts:212`, `server/middleware/auth.ts:7`, `shared/schema.ts:13` | Durcissement securite (anti brute-force) non explicite |
| Gestion flotte (TEST-FLEET) | FAIT | `server/routes.ts:559`, `server/routes.ts:678`, `server/routes.ts:885`, `server/routes.ts:924`, `server/api/vehicles.routes.ts:52`, `client/src/pages/vehicles/index.tsx:12` | Dette technique dans `server/routes.ts` (routes dupliquees) |
| CMMS / maintenance (TEST-MAINT) | FAIT | `server/routes.ts:1131`, `server/routes.ts:1243`, `server/routes.ts:1476`, `server/routes.ts:1620`, `server/routes.ts:2050`, `server/services/preventive-maintenance-service.ts:97`, `client/src/pages/maintenance/work-orders/[id].tsx:421` | Consolidation API encore necessaire |
| Approvisionnement (TEST-PROC) | FAIT | `server/api/suppliers.routes.ts:237`, `server/api/purchase-orders.routes.ts:111`, `server/api/supplier-invoices.routes.ts:279`, `server/api/supplier-invoices.routes.ts:405`, `server/services/three-way-matching-service.ts:35`, `client/src/pages/procurement/invoices/index.tsx:51` | Renforcer tests auto du flux complet 3-voies |
| Operations et missions (TEST-OPS) | FAIT | `server/api/operations.routes.ts:23`, `server/api/operations.routes.ts:53`, `server/api/billing.routes.ts:75`, `server/api/billing.routes.ts:158`, `client/src/pages/operations/dashboard.tsx:12`, `client/src/pages/operations/invoices/index.tsx:81` | Scenario e2e mission -> facture -> paiement ajoute (`e2e/05-mission-billing-payment.spec.ts`), a etendre a la creation de mission |
| Analytics et reporting (TEST-REPORT) | PARTIEL | `server/api/exports.routes.ts:47`, `server/api/exports.routes.ts:167`, `server/services/excel-export-service.ts:26`, `server/services/export-service.ts:11`, `server/api/billing.routes.ts:211` | KPIs "temps reel" et validation perf non qualifies |
| Tests performance (PERF-001..003) | MANQUANT | `package.json:6` | Pas de campagne/perf tests formalisee |
| Tests securite (SEC-001..004) | PARTIEL | `server/middleware/auth.ts:7`, `server/api/billing.routes.ts:12` | Pas de suite de tests securite automatisee (SQLi/XSS/force brute) |

## Matrice 2 - Sprints 3 et 4

| Sprint / lot attendu | Statut | Preuves code | Ecart principal |
|---|---|---|---|
| Sprint 3 - Service vehicules/documentation | FAIT | `server/api/vehicles.routes.ts:19`, `server/routes.ts:885`, `server/routes.ts:924` | Nettoyage techniques a faire |
| Sprint 3 - Service CPC + UI | FAIT | `server/api/drivers.routes.ts:36`, `server/services/cpc-training-service.ts:48`, `client/src/pages/drivers/index.tsx:35` | Couverture de tests CPC dedies limitee |
| Sprint 3 - Dashboards enrichis par role | FAIT | `client/src/pages/secretary/dashboard.tsx:17`, `client/src/pages/logistics/dashboard.tsx:13`, `client/src/pages/warehouse/dashboard.tsx:12`, `client/src/pages/workshop-manager/dashboard.tsx:13` | Toujours pas de validation e2e role-based: la suite ne joue qu'un seul compte (`E2E_USERNAME`, `admin` par defaut) |
| Sprint 3 - Tests e2e complets | PARTIEL | `playwright.config.ts:8`, `package.json:18`, `e2e/01-auth-login.spec.ts:4`, `e2e/README.md:1` | Socle Playwright en place (6 specs), mais aucun parcours role-based multi-profils |
| Sprint 4 - Service operations/missions | FAIT | `server/services/operations-service.ts:30`, `server/api/operations.routes.ts:23` | Harmonisation typage restante |
| Sprint 4 - Facturation clients + paiements + PDF | FAIT | `server/services/client-billing-service.ts:58`, `server/api/billing.routes.ts:75`, `server/api/billing.routes.ts:211`, `server/services/pdf-generation-service.ts:1` | Scenarios de non-regression a industrialiser |
| Sprint 4 - Exports Excel operations/facturation | FAIT | `server/services/excel-export-service.ts:165`, `server/api/exports.routes.ts:107`, `client/src/pages/exports/reports.tsx:13` | Alignement colonnes/labels a standardiser |
| Sprint 4 - Tests end-to-end sprint final | PARTIEL | `e2e/05-mission-billing-payment.spec.ts:4`, `e2e/06-realtime-work-orders.spec.ts:4` | Parcours mission -> facture -> paiement couvert en lecture; specs tolerantes a une base vide |

## Matrice 3 - Lots et planification MVP

| Exigence lot/plan | Statut | Preuves code | Ecart principal |
|---|---|---|---|
| LOT 1 - Flotte et documents | FAIT | `server/routes.ts:559`, `server/routes.ts:885`, `shared/schema.ts:55`, `shared/schema.ts:138` | Refactor routes legacy |
| LOT 1 - Maintenance et stock | FAIT | `server/routes.ts:1476`, `server/routes.ts:1904`, `server/routes.ts:2504`, `server/services/stock-alerts-service.ts:20` | Automatisation/ordonnancement a fiabiliser |
| LOT 1 - Personnel/habilitations | PARTIEL | `shared/schema.ts:740`, `server/api/drivers.routes.ts:20`, `server/api/drivers.routes.ts:36`, `shared/schema.ts:835` | QHSE/permis/conges/time-tracking peu exposes en APIs/UI metier |
| LOT 1 - Gestion carburant | FAIT | `server/routes.ts:2689`, `server/routes.ts:3142`, `server/services/fuel-card-service.ts:21`, `client/src/pages/fuel/index.tsx:15` | Couverture e2e toujours absente (aucune spec carburant/carte rechargeable) |
| LOT 1 - Fournisseurs/achats | FAIT | `server/api/suppliers.routes.ts:120`, `server/api/suppliers.routes.ts:371`, `server/api/suppliers.routes.ts:336`, `server/api/purchase-orders.routes.ts:63`, `server/api/supplier-invoices.routes.ts:89`, `client/src/pages/procurement/suppliers/[id].tsx:648` | Dette de typage encore presente |
| Plan Phase 2 - Services prioritaires 1 a 6 | FAIT | `server/api/index.ts:33`, `server/api/index.ts:44`, `server/services/vat-billing-service.ts:15`, `server/services/stock-alerts-service.ts:14`, `server/services/fuel-card-service.ts:15`, `server/services/operations-service.ts:24` | Stabilisation qualite/tests |
| Plan MVP - Module Tresorerie/Comptabilite (Etape 2.3) | MANQUANT | `PLANIFICATION_MVP_COMPLETE.md:798`, `server/api/index.ts:33`, `server/api/index.ts:44` | Aucun module API/UI dedie tresorerie |
| Plan MVP - Carburant avance / besoins logistiques / BI avancee | PARTIEL | `PLANIFICATION_MVP_COMPLETE.md:944`, `server/services/fuel-card-service.ts:303`, `client/src/pages/logistics/dashboard.tsx:13` | Fonctions avancees prevues non completes |

## Etat des fichiers markdown (a jour ou historique)

- `ETAT_AVANCEMENT_ACTUEL_2026-02-20.md`: document de reference a jour (ce fichier).
- `ETAT_AVANCEMENT_LOT1_YARO_FLEETOS_29_09_2025.md`: historique (snapshot 2025).
- `RAPPORT_AVANCEMENT_YARO_FLEETOS_29_09_2025.md`: historique (snapshot 2025).
- `RAPPORT_AVANCEMENT_PHASE1_FINALE_29_09_2025.md`: historique (snapshot 2025).
- `FONCTIONNALITES_PAR_PROFIL.md`: historique/obsolescent (chiffres et constats techniques non alignes avec l'etat du code 2026).
- `PLANIFICATION_*.md`, `SPRINT*_PLAN_DETAILLE.md`: documents de planification (objectif), pas preuve de realisation.

## Etat qualite verifie pendant cet audit

- TypeScript: `npm run check` execute le 20 fevrier 2026 -> OK.
- Tests: execution `vitest` bloquee par dependance manquante `@rollup/rollup-linux-x64-gnu` (environnement local), donc non qualifiee ici.
- E2E: **present depuis l'addendum du 17 aout 2026**. Playwright installe (`@playwright/test`), `playwright.config.ts` a la racine, 6 specs dans `e2e/`, scripts `test:e2e` et `test:e2e:headed`. Voir `e2e/README.md`.
- Dette de typage: `219` occurrences de `any` dans `server/api`, `server/services`, `server/routes.ts`, `shared`.

## Backlog priorise (ce qu'il faut faire ensuite)

1. Reparer l'environnement de tests et activer l'execution CI (`vitest` + script `test`). Aucun workflow CI n'existe encore dans le repo, alors que `playwright.config.ts` prevoit deja le cas `CI` (2 retries).
2. ~~Ajouter un socle e2e (login, vehicule, OT, procurement 3-voies, mission->facture->paiement).~~ **Fait le 17 aout 2026.** Suite: fiabiliser ce socle (jeu de donnees dedie, parcours multi-profils, chemin metier complet - voir addendum).
3. Demarrer le module `Tresorerie/Comptabilite` (API + UI minimum viable).
4. Reduire la dette `any` en priorite sur `server/api/*`, `server/services/procurement-service.ts`, `server/services/client-billing-service.ts`, `server/routes.ts`.
5. Consolider les routes legacy dans `server/routes.ts` pour limiter les doublons.
