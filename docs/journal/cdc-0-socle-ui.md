# Journal — CDC-0b socle client (`cdc-0-socle-ui`)

Worktree : `../fm-cdc-0-socle-ui`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-10-31T23:01:24+01:00 — CDC-0b — Socle client des écarts du cahier des charges

- **Agent** : fe (lot CDC-0b) · **Branche** : `lot/fe/CDC-0-socle-ui` · **Commit** : voir `git log`
- **Statut** : fait ; navigateur non joué (écrans vides derrière des drapeaux coupés)
- **Quoi** : pose une fois, côté client, les registres partagés du chantier CDC. 5 événements temps réel, 8 écrans déclarés (pages vides « Bientôt disponible »), 2 dépendances. Drapeaux coupés (défaut) : aucune entrée de menu, aucune route active, l'application est identique à `main`.
- **Comment** :
  - `shared/contracts/realtime-events.ts` + `client/src/hooks/useRealTimeSync.ts`, modifiés ensemble, un `case` littéral par événement : `part_sale_validated`, `part_sale_cancelled`, `part_sale_invoiced` (invalident `/api/part-sales`, `/api/parts`, `/api/warehouse`, `/api/kpi`), `vehicle_position_updated` (`/api/vehicle-positions`), `import_batch_applied` (`/api/vehicles`, `/api/work-orders`, `/api/kpi`, aucun toast). `/api/mission-advisories` s'ajoute à `incident_reported` (catalogue) et à `work_order_updated` (hook, événement réutilisé donc hors catalogue). Couche 3 seulement : aucun émetteur n'existe, les lots fonctionnels émettront. Portées déclarées par rôles (`PART_SALE_READ_ROLES`, `GPS_VIEW_ROLES`, `IMPORT_INTERVENTION_ROLES`).
  - `client/src/config/cdc-screens.ts` : 8 écrans (`part-scanner`, `part-labels`, `part-sales`, `fleet-map`, `telemetry-devices`, `kpi-reports`, `maintenance-report`, `excel-import`), chacun avec id, chemin, drapeau, rôles (constantes de `shared/constants/roles.ts`), API appelées et entrée de menu. Type `CdcScreen` = `LotScreen` avec drapeau et rôles obligatoires.
  - `client/src/config/cdc-screen-components.ts` : pages en `lazy`, une par écran (`client/src/pages/cdc/<id>.tsx`), toutes sur `CdcComingSoon` (`client/src/components/cdc/coming-soon.tsx`, tokens du design system).
  - `client/src/components/lot-routes.tsx` et `client/src/components/layout/sidebar.tsx` itèrent `[...LOT_SCREENS, ...CDC_SCREENS]`. `App.tsx` inchangé : `renderLotRoutes()` passe avant `/inventory/:id` et `/vehicles/:id`. Ajout d'une frontière `Suspense` autour du composant d'écran : le dépôt n'en avait aucune, un composant `lazy` (déjà utilisé par `scope`) faisait tomber l'arbre.
  - Dépendances, versions exactes, lock mis à jour par `npm install --package-lock-only` : `qrcode` 1.5.4 (MIT), `@types/qrcode` 1.5.6 (dev), `barcode-detector` 3.2.3 (MIT, tire `zxing-wasm` 3.1.6). `node_modules` non touché. Aucun import dans ce lot : ils servent au lot #3.
  - `tests/unit/client/cdc-screens.test.ts` : rôles de l'écran = rôles du montage serveur (table `tests/support/cdc-mounts.ts`), drapeau déclaré et repris par le montage, ids et chemins uniques face au lot recette et à `App.tsx`, page et entrée de composant présentes, contre-épreuve du comparateur de rôles.
  - Choix : Adopt (`qrcode`, `barcode-detector`, validés par l'architecte) ; Build pour le registre (pas d'équivalent).
- **Pourquoi** : les lots #3, #4, #6, #7, #8, #9 ne touchent ensuite que leur page et leurs fichiers ; ADR 0001 §1 et §6.
- **Comment tester (QA)** :
  - Prérequis : aucun (écrans vides).
  - Étapes : 1. Sans `FEATURE_FLAGS`, ouvrir l'application en administrateur : aucune entrée « Scanner une pièce », « Ventes de pièces », « Carte de la flotte », « Import Excel » dans le menu ; `/inventory/scan` affiche « Page introuvable ». 2. `FEATURE_FLAGS=part-qr=on`, magasinier : « Scanner une pièce » et « Étiquettes des pièces » sous Gestion de stock, page « Bientôt disponible ». 3. Même drapeau, comptable : aucune entrée, `/inventory/scan` introuvable.
  - Attendu : voir les étapes.
  - Preuve automatisée : `node node_modules/vitest/vitest.mjs run --reporter=dot` ; `node node_modules/typescript/bin/tsc --noEmit -p .`.
- **RAIDER** : couvert R (registre déclaratif, rôles et drapeaux importés), A (aucun nom de dépôt en dur), I (aucune écriture, rejouable), D (suites existantes vertes sans édition de test, drapeaux coupés = application inchangée), E (tokens, aucun `console.*`, imports sans doublon), failure memory (garde-fou rôles écran/API) ; sans objet : migration, sécurité serveur.
- **Reste / risques** :
  - `lot-routes.tsx` ne contient pas de `?next=` (la ligne 16 redirige vers `/login` seul) et `login` ne le lit pas : les liens QR vers `/inventory/scan` d'un utilisateur déconnecté atterrissent sur la connexion puis sur le tableau de bord. À traiter par le lot #3 (ou #10a), non inventé ici.
  - `part-labels` : aucune route d'étiquette n'est montée ; le test borne l'écran à `PART_LABEL_ROLES` (sous-ensemble de `PART_SCAN_ROLES`). Le lot #3 doit garder sa route par ce groupe.
  - `kpi-reports` : rôles `KPI_VIEWER_ROLES`, comparés à la garde `isManagementOrAdmin` de `server/middleware/auth.ts` ; le lot #7 (ajout du chef d'atelier) changera les deux ensemble.
  - `excel-import` : l'écran s'ouvre à `IMPORT_INTERVENTION_ROLES` (montage) ; les autres types d'import restent `IMPORT_ROLES` (administrateur), le lot #9 masque ces choix au chef d'atelier.

## 2026-10-31T23:23:18+01:00 — CDC-0b — Rebase de la base d'intégration sur la branche distante retenue

- **Agent** : fe (lot CDC-0b) · **Branche** : `lot/fe/CDC-0-socle-ui` · **Commit** : fusion b6818d4 puis ce commit
- **Statut** : fait
- **Quoi** : la branche distante `lot/int/CDC-0-base` (e7aa8f2 = schéma 53c8b89 + socle 73bf623 + `main` 76ff0f3) est la base retenue ; elle est fusionnée dans cette branche (`--no-ff`), sans conflit. Mon intégration locale (4820561) n'est plus utilisée.
- **Comment** : `git fetch origin` puis `git merge --no-ff origin/lot/int/CDC-0-base`. Aucun fichier du lot modifié.
- **Pourquoi** : le diff de la PR ne doit montrer que les fichiers du lot.
- **Comment tester (QA)** : `git diff --name-only origin/lot/int/CDC-0-base...HEAD` ne liste que les fichiers de l'entrée précédente ; `tsc --noEmit -p .` : 0 erreur ; `vitest run` : 72 fichiers, 922 tests verts.
- **RAIDER** : D (suites vertes après fusion) ; sans objet : les autres principes, aucun code changé.
- **Reste / risques** : aucun.

## 2026-10-31T23:58:00+01:00 — CDC-0b — Reprise de relecture : clés d'invalidation, portées, drapeau exports, Suspense, dépendances

- **Agent** : fe (lot CDC-0b) · **Branche** : `lot/fe/CDC-0-socle-ui` · **Commit** : celui qui porte cette entrée
- **Statut** : fait
- **Quoi** : (1) les invalidations `/api/warehouse` et `/api/kpi` des événements `part_sale_*` et `import_batch_applied`, ainsi que `["/api/kpi"]` sur `work_order_updated`, ne correspondaient à aucune `queryKey` : elles sont remplacées par les clés réelles (`KPI_QUERY_KEYS`, `WAREHOUSE_QUERY_KEYS`, `/api/parts/low-on-stock`, `/api/parts/statistics`) ; la ligne littérale `["/api/kpi"]` reste dans `useRealTimeSync.ts` (test gelé) et une boucle invalide les clés par indicateur. (2) `incident_reported` couvre aussi `MISSION_ADVISORY_ROLES` (logistique) et `import_batch_applied` couvre `STAFF_ROLES`, les deux dérivés de `shared/constants/roles.ts`. (3) l'écran `maintenance-report` exige `exports` en plus de `maintenance-report` (`alsoRequires`, `screenFeatures`), repris par `lot-routes.tsx` (un `FeatureGate` par drapeau) et le menu. (4) commentaire du type `CdcScreen` corrigé : les rôles sont ceux du montage serveur, pas ceux du premier appel en lecture. (5) test de la frontière `Suspense`. (6) dépendances : jonction `node_modules` du worktree retirée (celle du dépôt principal intacte), `npm ci --ignore-scripts` local.
- **Comment** : `tests/unit/client/realtime-invalidation-keys.test.ts` balaie les `queryKey` littérales du client et les constantes `*_PATH` des contrats, et refuse toute clé d'invalidation qui n'est le premier élément d'aucune ; quatre clés dont l'écran n'existe pas encore (`/api/kpi/failures`, `/api/kpi/maintenance-costs`, `/api/part-sales`, `/api/vehicle-positions`) sont listées explicitement et figées. `cdc-screens.test.ts` exige désormais, pour un montage propre à l'écran, l'égalité entre les drapeaux de l'écran et ceux du montage. `lot-routes-suspense.test.ts` lit `lot-routes.tsx`.
- **Pourquoi** : `["/api/kpi"]` ne correspond qu'à la clé exacte (TanStack compare élément par élément) : les tuiles ne se rafraîchissaient pas ; un écran visible alors que l'API répond 404 (drapeau `exports` coupé) ; une portée trop étroite privait la logistique et le personnel de l'atelier de l'information ; les pages chargées par `lazy()` plantent sans `Suspense`.
- **Comment tester (QA)** : `node node_modules/vitest/vitest.mjs run` : 74 fichiers, 998 tests verts ; `tsc --noEmit -p .` : 0 erreur ; `node -e "require.resolve('qrcode')"` résout dans le `node_modules` du worktree ; `vite build` : 15 s, sans erreur. Limite : les pages CDC sont encore vides, aucune n'importe `qrcode` ni `barcode-detector`, donc le build ne prouve que la résolution, pas l'empaquetage de ces bibliothèques (à prouver au lot #3).
- **RAIDER** : R (listes de clés et de rôles dérivées des sources) ; D (suites vertes, tests gelés non modifiés) ; I (rejouer `npm ci` ne change rien) ; failure memory : le test de clés fige la cause de l'incident. Sans objet : A.
- **Reste / risques** : retirer les quatre entrées de `AWAITING_SCREEN` quand les lots CDC-4, CDC-6 et CDC-7 posent leurs clés. Worktree `fm-cdc-0-int` et branche locale `int-cdc-0-base` non supprimés (à l'arbitrage de l'orchestrateur).
