# Journal — CDC-7 KPI du cahier (serveur)

Agent : api (lot CDC #7) · Branche : `lot/api/CDC-7-kpi` · Base : `lot/int/CDC-0-base`

## 2026-10-31T23:25:00+01:00 — CDC-7 — Les 3 KPI du cahier corrigés, taux horaires, rapports mensuel et trimestriel

- **Agent** : api · **Branche** : `lot/api/CDC-7-kpi` · **Commit** : voir `git log`
- **Statut** : fait côté serveur ; tests d'intégration et de contrat écrits, non joués (base non isolée)
- **Quoi** :
  - Pannes : un indicateur `GET /api/kpi/failures` (déclarations + OT correctifs non déclarés, jamais comptés deux fois, mois à zéro compris, moyenne = total / nombre de mois, détail par véhicule). `incidents-per-month` sert la même série.
  - Préventif réalisé à temps : calculé sur l'échéance (`due_date`, à défaut la date de début), période arrêtée à la veille (Africa/Douala), planifications échues sans OT comptées, annulé = non réalisé, retards exposés (`late`), tolérance configurable (`KPI_PREVENTIVE_TOLERANCE_DAYS`, 0 par défaut).
  - Coût d'une intervention close : main-d'oeuvre (heures réelles x taux horaire daté, sinon coût saisi) + pièces ; `laborValued` dit si un taux existe ; ventilation `GET /api/kpi/maintenance-costs?groupBy=type|vehicle`. Pneus exclus.
  - Le chef d'atelier lit les indicateurs (`KPI_VIEWER_ROLES` = admin, management, workshop_manager).
  - Taux horaires : `GET` et `POST /api/workshop-labor-rates` (administrateur, drapeau `maintenance-report`) ; une date d'effet déjà prise répond 409 en français.
  - Rapports : `GET /api/exports/kpi-report?period=month|quarter&from&to&format=xlsx|pdf` (drapeaux `exports` + `kpi-reports`, rôles des indicateurs).
  - Les OT préventifs générés posent leur échéance (`due_date`, `due_mileage`) : assurance, contrôle technique, planification, rotation de pneus.
- **Comment** :
  - Règles pures sans entrée-sortie : `server/lib/kpi-rules.ts` (fuseau, mois à zéro, échéance, classement, taux en vigueur, coût d'un OT, période de rapport). Lecture SQL : `server/services/kpi-service.ts` (réécrit). Routes : `server/api/kpi.routes.ts` (`authorize([...KPI_VIEWER_ROLES])`).
  - Export réutilisable : `server/lib/report-export.ts` (sections à colonnes déclarées -> xlsx via SheetJS, pdf via jsPDF + autoTable, déjà dépendances) ; mise en forme du rapport KPI dans `server/lib/kpi-report-definition.ts` (pure), chargement dans `server/services/kpi-report-service.ts`.
  - Échéance : `server/lib/preventive-due.ts` (`stampPreventiveDue`) pose les colonnes par la table compagnon `workOrderPlanning` après l'INSERT, avec `fleetos.suppress_side_effects` pour ne pas émettre un second `work_order_updated`. Appelé par `preventive-maintenance-service.ts` (4 sites + génération depuis planification) et `tires-service-simplified.ts` (rotation). Les `console.*` de `preventive-maintenance-service.ts` sont migrés vers `moduleLogger("preventive-maintenance")`, aucun log supprimé. Un échec de pose est journalisé, l'OT est conservé (repli sur la date de début).
  - Taux horaires : `server/services/workshop-labor-rates-service.ts` + `server/api/workshop-labor-rates.routes.ts` (le stub à `PUT /:id` est remplacé : un taux se crée, ne se corrige pas). 23505 sur `workshop_labor_rates_effective_from_key` -> `AppError(409)`, 23514 -> 400.
  - Contrats : `shared/contracts/kpi.ts` (champs optionnels ajoutés seulement + 2 chemins), `shared/contracts/workshop-labor-rates.ts` (nouveau), `shared/contracts/exports.ts` (`kpi-report`).
  - Reuse-first : SheetJS et jsPDF déjà présents (Adopt) ; calcul de l'export générique Build (aucun module d'export tabulaire n'existait).
  - Doublons de routes : recherche dans `server/routes.ts` et `server/api/*.routes.ts` de `/kpi/*`, `labor-rates`, `exports/kpi` : aucune déclaration double.
- **Pourquoi** : écarts du cahier des charges ETS YARORO §6 (3 KPI vérifiés et corrigés, rapports exportables) ; défauts relevés dans l'ancien `kpi-service` (échéance non portée, planifications sans OT ignorées, mois sans panne absents, coût sur `start_date`, heures non valorisées).
- **Choix d'interprétation à valider** :
  1. Si un taux est en vigueur et que des heures réelles sont saisies, heures x taux REMPLACE le coût saisi (jamais les deux : `cost` est déjà la main-d'oeuvre). Sans taux ou sans heures, le coût saisi reste.
  2. « Coût non saisi » = main-d'oeuvre nulle (`missingCostCount`).
  3. Un OT `completed` sans `end_date` n'entre plus dans le coût (période de clôture).
  4. Les pneus sont exclus du coût : décision de l'utilisateur en attente, documentée dans la note du rapport.
  5. Planification sans OT : seules celles sans aucun OT préventif sont comptées (il n'existe pas de générateur de récurrence).
  6. Période par défaut des pannes : 12 mois calendaires dont le mois en cours. Rapport sans date : dernier mois (ou trimestre) terminé.
  7. `alert-service.ts` ne génère pas d'OT : rien à y poser (écart avec le brief).
  8. La route des taux est derrière le drapeau `maintenance-report` (défaut coupé) et `isAdmin`, par le montage de `server/api/index.ts`, non modifiable ici.
  9. Mise à zéro des mois faite en TypeScript (`fillMonthSeries`), pas par `generate_series`.
- **Constat temps réel (lecture seule)** : (a) l'invalidation « satellite KPI » du client vise `["/api/kpi"]` alors que les clés réelles sont `["/api/kpi/...", params]` : elle ne correspond jamais (inerte) ; (b) `work_order_created` et `work_order_deleted` n'invalident aucun KPI ; (c) `incident_reported` n'invalide que `/api/kpi/incidents-per-month`, pas `failures` ni le coût. À traiter côté client (CDC-0b / écran #7).
- **Comment tester (QA)** :
  - Prérequis : base de recette, compte admin ; pour l'API des taux `FEATURE_FLAGS=maintenance-report=on` ; pour les rapports `FEATURE_FLAGS=exports=on,kpi-reports=on`.
  - Étapes : 1. `GET /api/kpi/failures?from=2026-01-01&to=2026-10-31` en chef d'atelier : 10 mois, zéros compris. 2. `POST /api/workshop-labor-rates {effectiveFrom, hourlyRateHt}` en admin, puis le même jour : 409. 3. `GET /api/kpi/maintenance-costs?groupBy=vehicle` : `laborValued: true`. 4. `GET /api/exports/kpi-report?period=month&format=pdf`.
  - Attendu : 200 avec les formes du contrat ; 403 en technicien et client ; fichier xlsx à cinq feuilles ou PDF lisible.
  - Preuve automatisée : unitaires `node node_modules/vitest/vitest.mjs run --reporter=dot` (33 tests ajoutés dans `tests/unit/server/kpi-rules-cdc.test.ts`). Intégration `tests/integration/kpi-service-cdc.test.ts` et contrat `tests/contract/kpi-cdc.contract.test.ts` : écrits, compilent, NON JOUÉS (base non isolée, ils écrivent).
- **Tests existants devenus rouges (amendements attendus, aucun modifié ici)** :
  - `tests/unit/server/cdc-flags.test.ts:68` et `tests/unit/client/pending-invoices-kpi-roles.test.ts:18` : `KPI_VIEWER_ROLES` contient désormais `workshop_manager` (attendu `["admin","management","workshop_manager"]` ; au second, `canViewKpi` vaut vrai aussi pour `workshop_manager`, ligne 20).
  - `tests/unit/server/cdc-mounts.test.ts:100` (cas `workshop-labor-rates` de `tests/support/cdc-mounts.ts`) : ce n'est plus un squelette 501. Retirer le cas de `MOUNT_CASES` ou le déplacer vers un test dédié (200 avec base, 404 drapeau coupé, 403 hors admin).
  - Non joués mais à prévoir : `tests/contract/cdc-mounts.contract.test.ts` (même cas 501 -> 200) ; `tests/contract/lot-exports-roles.contract.test.ts:70-86` (nouveau chemin `kpi-report` sous le drapeau `kpi-reports` coupé : 404, ajouter le drapeau ou exclure le chemin) ; `tests/integration/kpi-service.test.ts` (~61, ~82, ~87-91 : série à zéros, champs optionnels `laborValued`, etc., coût sur `end_date`) ; `tests/contract/kpi.contract.test.ts` reste valide.
- **RAIDER** : couvert R (export générique par colonnes déclarées, règles séparées du SQL), A (fuseau lu en Africa/Douala, jamais celui du serveur), I (second `stampPreventiveDue` rejouable, un taux par date), D (contrats : champs optionnels ajoutés seulement, ancien test de contrat des 3 KPI inchangé), failure memory (cloisonnement du temps réel signalé ci-dessus), E (erreurs `AppError`, logs `moduleLogger`, moindre privilège), R rétroactif (OT existants sans `due_date` retombent sur la date de début, aucune reprise de données). Sans objet : migration (colonnes déjà posées par CDC-0 schéma).
- **Pour fleet-db** : (1) un déclencheur qui pose `due_date` à l'insertion d'un OT préventif, ou une vue des occurrences préventives (échéance, jour de clôture, état à temps / en retard) ; (2) une vue ou fonction pour les pannes dédoublonnées et pour le coût par OT (heures, pièces, taux en vigueur) afin de retirer cette agrégation du TypeScript ; (3) un générateur de récurrence des planifications.
- **Reste / risques** : tolérance globale par variable d'environnement (pas par type de véhicule) ; un taux horaire de test inséré dans une base partagée modifie brièvement le coût des OT postérieurs.

## 2026-10-31T23:30:00+01:00 — CDC-7 — Tests du chantier alignés sur la route des taux horaires

- **Agent** : api · **Branche** : `lot/api/CDC-7-kpi` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : les tests du chantier CDC redevenus rouges sont amendés ; il reste un rouge attendu, gelé (session de tests).
- **Comment** :
  - `tests/unit/server/cdc-flags.test.ts:68` : `KPI_VIEWER_ROLES` = `["admin","management","workshop_manager"]`.
  - `tests/support/cdc-mounts.ts` : le cas `workshop-labor-rates` quitte `MOUNT_CASES` (ce n'est plus un squelette 501). Le jumeau `tests/contract/cdc-mounts.contract.test.ts` lit la même table : aligné sans autre modification.
  - `tests/unit/server/cdc-mounts.test.ts` : bloc dédié (service des taux simulé, sans base) : drapeau coupé 404, sans session 401, tout rôle hors admin 403, admin 200. Le contrat avec base (201, 409, 400, `created_by`) est dans `tests/contract/kpi-cdc.contract.test.ts` (non joué, base non isolée).
- **Rouges attendus restants, à confier à la session de tests** (fichiers gelés ou non joués) :
  - `tests/unit/client/pending-invoices-kpi-roles.test.ts:18` : attendre `["admin","management","workshop_manager"]` ; ligne 20, `canViewKpi` vaut vrai aussi pour `workshop_manager`.
  - `tests/integration/kpi-service.test.ts` (~61, ~82, ~87-91) : série à zéros, champs optionnels, coût sur `end_date`.
  - `tests/contract/lot-exports-roles.contract.test.ts:70-86` : `kpi-report` répond 404 tant que `kpi-reports` est coupé ; ajouter le drapeau ou exclure le chemin.
- **Hors périmètre** : le défaut d'invalidation temps réel des KPI (clé `["/api/kpi"]`, événements de création et suppression d'OT) va à l'écran #7 ; `useRealTimeSync.ts` n'est pas touché.

## 2026-11-02T12:14:51+01:00 — CDC-7 — Période des KPI bornée (PR #91)

- **Agent** : api · **Branche** : `lot/api/CDC-7-kpi-period` · **Commit** : voir `git log`
- **Statut** : fait, contrats joués
- **Quoi** : une période KPI démesurée (`to=9999-12-30`) ou une date hors calendrier (`2026-02-31`) faisait boucler `monthKeysBetween` pendant plusieurs secondes avant une 500. Elle est désormais refusée en 400 avant tout calcul.
- **Comment** : `shared/contracts/kpi-period.ts` (date réelle, années 2000-2100, 36 mois civils au plus), appliqué à `kpiQuerySchema`, `maintenanceCostsQuerySchema` et `kpiReportQuerySchema`. Le travail venait de la branche orpheline `wip/kpi-period` (31/10), reprise sur décision de l'utilisateur.
- **Pourquoi** : une entrée utilisateur ne doit pas pouvoir coûter des secondes de CPU ni produire une 500.
- **Rupture de contrat d'entrée** : volontaire. Une période de plus de 36 mois ou hors 2000-2100 passe de 200 (ou 500) à 400. Aucun écran n'envoie de période (`<KpiTiles />` sans props) ; seuls `kpi-cdc` et `kpi.contract` appellent ces routes.
- **Limite** : une seule borne n'est pas soumise aux 36 mois (la borne manquante est complétée par le serveur) ; le pire cas est d'environ 1 200 mois, sans blocage.
- **Preuves** : tsc 0 ; unitaires `tests/unit/shared/kpi-period.test.ts` + `kpi-rules-cdc` 47/47 ; contrats `kpi-cdc` + `kpi` + `lot-exports-roles` 209/209 (session de tests).
